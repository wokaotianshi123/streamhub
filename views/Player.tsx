import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ViewState, Movie, PlayerProps, Source } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl, searchVideos } from '../utils/api';
import { getMovieProgress, updateHistoryProgress, addToHistory, isFavorite, toggleFavorite, getAccelerationConfig, getSkipConfig, setSkipConfig, SkipConfig } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    Artplayer: any;
  }
}

const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    startBufferLength: 30, 
    maxBufferLength: 300, 
    maxMaxBufferLength: 1200,
    maxBufferSize: 512 * 1024 * 1024,
    backBufferLength: 120,
    fragLoadingTimeOut: 30000,
    fragLoadingMaxRetry: 10,
    levelLoadingTimeOut: 30000,
    manifestLoadingTimeOut: 30000,
    maxLoadingDelay: 5,
    maxBufferHole: 1.0,
    highBufferWatchdogPeriod: 3,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 10,
};

const EPISODES_PER_SECTION = 30;

const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
};

const waitForGlobal = async (key: 'Artplayer' | 'Hls', timeout = 3000): Promise<boolean> => {
    if (window[key]) return true;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        await new Promise(r => setTimeout(r, 100));
        if (window[key]) return true;
    }
    return false;
};

const fetchAndCleanM3u8 = async (url: string, depth = 0): Promise<{ content: string; removedCount: number; log: string }> => {
    if (depth > 3) throw new Error("Redirect loop detected");
    const toAbsolute = (p: string, b: string) => { try { return new URL(p, b).href; } catch(e) { return p; } };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const originalContent = await response.text();
    const lines = originalContent.split(/\r?\n/);

    if (originalContent.includes('#EXT-X-STREAM-INF')) {
        let bestUrl = null;
        let maxBandwidth = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('#EXT-X-STREAM-INF')) {
                const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = lines[j].trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        if (bandwidth > maxBandwidth) { maxBandwidth = bandwidth; bestUrl = nextLine; } 
                        else if (!bestUrl) { bestUrl = nextLine; }
                        break;
                    }
                    j++;
                }
            }
        }
        if (bestUrl) return fetchAndCleanM3u8(toAbsolute(bestUrl, url), depth + 1);
    }

    const segments: { idx: number; fp: string }[] = [];
    const fingerprintCounts: Record<string, number> = {};
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if(!trimmed || trimmed.startsWith('#')) return;
        const absUrl = toAbsolute(trimmed, url);
        let u; try { u = new URL(absUrl); } catch(e) { return; }
        const pathParts = u.pathname.split('/'); pathParts.pop(); 
        const fp = `${u.hostname}|${pathParts.join('/')}`;
        if(!fingerprintCounts[fp]) fingerprintCounts[fp] = 0;
        fingerprintCounts[fp]++;
        segments.push({ idx, fp });
    });
    
    let dominantFp = '', maxC = 0;
    for(const [fp, c] of Object.entries(fingerprintCounts)) { if(c > maxC) { maxC = c; dominantFp = fp; } }
    if(segments.length === 0 || (maxC / segments.length) < 0.4) return { content: originalContent, removedCount: 0, log: '未清洗' };

    const linesToRemove = new Set<number>();
    segments.forEach(seg => {
        if(seg.fp !== dominantFp) {
            linesToRemove.add(seg.idx);
            let j = seg.idx - 1;
            while(j >= 0) {
                const l = lines[j].trim();
                if(l.startsWith('#EXTINF') || l.startsWith('#EXT-X-BYTERANGE') || l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-DISCONTINUITY')) { linesToRemove.add(j); j--; } 
                else if (!l.startsWith('#EXT') && l.startsWith('#')) j--; 
                else if (l === '') j--; else break;
            }
        }
    });

    const newLines: string[] = [];
    lines.forEach((line, idx) => {
        if(linesToRemove.has(idx)) return;
        let content = line.trim();
        if(!content) return;
        if(content.startsWith('#')) {
            if(content.startsWith('#EXT-X-KEY') && content.includes('URI="')) {
                content = content.replace(/URI="([^"]+)"/, (m, p1) => `URI="${toAbsolute(p1, url)}"`);
            }
            newLines.push(content);
        } else newLines.push(toAbsolute(content, url));
    });
    return { content: newLines.join('\n'), removedCount: segments.length - maxC, log: `已移除 ${segments.length - maxC} 分片` };
};

const getButtonHtml = (label: string, time: number, isActive: boolean, color: string) => {
    const bg = isActive ? `rgba(${color}, 0.8)` : 'rgba(0,0,0,0.5)';
    const border = isActive ? `rgba(${color}, 1)` : 'rgba(255,255,255,0.2)';
    const text = isActive ? `${label} ${Math.floor(time)}s` : label;
    return `<span style="font-size: 11px; padding: 2px 10px; cursor: pointer; background: ${bg}; border-radius: 4px; border: 1px solid ${border}; color: white; display: inline-block; min-width: 45px; text-align: center; transition: all 0.2s;">${text}</span>`;
};

interface AltSource {
    source: Source;
    latency: number | null;
    movie: Movie | null;
    searching: boolean;
}

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource, sources, onSelectMovie }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  const [playerRatio, setPlayerRatio] = useState<number>(56.25);
  const [isFavorited, setIsFavorited] = useState(false);
  const accConfig = useMemo(() => getAccelerationConfig(), []);
  const [isTempAccelerationEnabled, setIsTempAccelerationEnabled] = useState(false);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [altSources, setAltSources] = useState<AltSource[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const hasAppliedHistorySeek = useRef<boolean>(false);
  const blobUrlRef = useRef<string | null>(null);
  const isFullscreenRef = useRef<boolean>(false);
  const isWebFullscreenRef = useRef<boolean>(false);
  const playbackRateRef = useRef<number>(1);
  
  const playListRef = useRef<{name: string, url: string}[]>([]);
  const currentUrlRef = useRef<string>('');
  const skipConfigRef = useRef<SkipConfig>({ intro: 0, outroOffset: 0 });

  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  const episodeSections = useMemo(() => {
    if (playList.length <= EPISODES_PER_SECTION) return [];
    const sections = [];
    for (let i = 0; i < playList.length; i += EPISODES_PER_SECTION) {
        const start = i + 1;
        const end = Math.min(i + EPISODES_PER_SECTION, playList.length);
        sections.push({ label: `${start}-${end}`, startIdx: i, endIdx: end });
    }
    return sections;
  }, [playList]);

  const effectiveAccEnabled = useMemo(() => accConfig.enabled || isTempAccelerationEnabled, [accConfig.enabled, isTempAccelerationEnabled]);

  useEffect(() => {
    if (playList.length > EPISODES_PER_SECTION && currentUrl) {
        const idx = playList.findIndex(ep => ep.url === currentUrl);
        if (idx !== -1) setCurrentSectionIndex(Math.floor(idx / EPISODES_PER_SECTION));
    }
  }, [currentUrl, playList]);

  const safeShowNotice = (msg: string) => {
    if (artRef.current?.notice) {
        try { artRef.current.notice.show = msg; } catch (e) {}
    }
  };

  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      setPlayerRatio(56.25);
      hasAppliedHistorySeek.current = false; 
      setIsFavorited(isFavorite(movieId));
      skipConfigRef.current = getSkipConfig(movieId);

      const historyItem = getMovieProgress(movieId);
      historyTimeRef.current = (historyItem?.currentTime && historyItem.currentTime > 5) ? historyItem.currentTime : 0;

      const data = await fetchVideoDetails(currentSource.api, movieId);
      if (data) {
        setDetails(data);
        const parsedEpisodes = parsePlayUrl(data.vod_play_url || '');
        setPlayList(parsedEpisodes);
        
        if (historyItem?.currentEpisodeUrl) {
            const found = parsedEpisodes.find(ep => ep.url === historyItem.currentEpisodeUrl);
            if (found) setCurrentUrl(found.url);
            else if (parsedEpisodes.length > 0) {
                setCurrentUrl(parsedEpisodes[0].url);
                historyTimeRef.current = 0; 
            }
        } else if (parsedEpisodes.length > 0) {
            setCurrentUrl(parsedEpisodes[0].url);
        }
        detectAltSources(data.title);
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api]);

  const detectAltSources = async (title: string) => {
    const others = sources.filter(s => s.api !== currentSource.api);
    setAltSources(others.map(s => ({ source: s, latency: null, movie: null, searching: true })));
    others.forEach(async (source) => {
        const startTime = Date.now();
        try {
            const results = await searchVideos(source.api, title);
            const latency = Date.now() - startTime;
            const matchedMovie = results.find(m => m.title === title) || results.find(m => m.title.includes(title)) || null;
            setAltSources(prev => prev.map(item => item.source.api === source.api ? { ...item, latency, movie: matchedMovie, searching: false } : item));
        } catch (e) {
            setAltSources(prev => prev.map(item => item.source.api === source.api ? { ...item, searching: false, movie: null, latency: 9999 } : item));
        }
    });
  };

  const sortedAltSources = useMemo(() => {
    return altSources.filter(alt => alt.movie || alt.searching).sort((a, b) => {
        if (a.searching && !b.searching) return 1;
        if (!a.searching && b.searching) return -1;
        return (a.latency || 0) - (b.latency || 0);
    });
  }, [altSources]);

  const handleAltSourceClick = (alt: AltSource) => {
    if (alt.movie) {
        const movieWithSource = { ...alt.movie, sourceApi: alt.source.api, sourceName: alt.source.name };
        addToHistory(movieWithSource);
        onSelectMovie(movieWithSource);
    }
  };

  const handleFavoriteToggle = () => {
    if (details) {
        const res = toggleFavorite({ ...details, sourceApi: currentSource.api, sourceName: currentSource.name });
        setIsFavorited(res);
        safeShowNotice(res ? '✅ 已添加到收藏夹' : '⚠️ 已从收藏夹移除');
    }
  };

  const toggleTempAcceleration = () => {
      if (accConfig.enabled) { safeShowNotice('全局加速已开启'); return; }
      setIsTempAccelerationEnabled(!isTempAccelerationEnabled);
      safeShowNotice(!isTempAccelerationEnabled ? '已临时开启加速播放' : '已关闭临时加速');
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      safeShowNotice('播放链接已复制');
    } catch (err) {}
  };

  const playNextEpisode = () => {
    const list = playListRef.current;
    const current = currentUrlRef.current;
    const currentIndex = list.findIndex(ep => ep.url === current);
    if (currentIndex !== -1 && currentIndex < list.length - 1) {
        const nextEp = list[currentIndex + 1];
        safeShowNotice(`即将播放: ${nextEp.name}`);
        setTimeout(() => { 
            historyTimeRef.current = 0; 
            hasAppliedHistorySeek.current = true; 
            setCurrentUrl(nextEp.url); 
        }, 1500);
    }
  };

  const handleVideoReady = (art: any) => {
    if (historyTimeRef.current > 5 && !hasAppliedHistorySeek.current) {
        art.currentTime = historyTimeRef.current;
        hasAppliedHistorySeek.current = true;
        if (art.notice) art.notice.show = `已自动恢复播放进度`;
    } else {
        const config = skipConfigRef.current;
        if (config.intro > 1) {
            art.currentTime = config.intro;
            if (art.notice) art.notice.show = `已自动跳过片头`;
        }
    }
    if (isWebFullscreenRef.current) art.fullscreenWeb = true;
    if (isFullscreenRef.current) art.fullscreen = true;
  };

  useEffect(() => {
    return () => {
        if (artRef.current) {
            artRef.current.destroy(false);
            artRef.current = null;
        }
    };
  }, [movieId]);

  useEffect(() => {
    if (!currentUrl || !containerRef.current) return;
    let cleanTimeoutId: any = null;
    let isMounted = true;

    const playVideo = async () => {
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        setCleanStatus('');
        
        let finalUrl = currentUrl;
        if (effectiveAccEnabled && accConfig.url) {
            const prefix = accConfig.url.endsWith('/') ? accConfig.url.slice(0, -1) : accConfig.url;
            finalUrl = `${prefix}/${currentUrl}`;
        }

        if (currentUrl.includes('.m3u8')) {
            try {
                setCleanStatus('流处理中...');
                const result = await fetchAndCleanM3u8(finalUrl);
                if (isMounted && result.removedCount > 0) {
                    const blob = new Blob([result.content], { type: 'application/vnd.apple.mpegurl' });
                    finalUrl = URL.createObjectURL(blob);
                    blobUrlRef.current = finalUrl;
                    setCleanStatus(`✅ 已去除广告`);
                    cleanTimeoutId = setTimeout(() => { if (isMounted) setCleanStatus(''); }, 5000);
                } else if (isMounted) setCleanStatus('');
            } catch (e) { if (isMounted) setCleanStatus(''); }
        }

        if (!isMounted) return;

        try {
            let artReady = await waitForGlobal('Artplayer', 3000);
            let hlsReady = await waitForGlobal('Hls', 3000);
            if (!artReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/artplayer/5.3.0/artplayer.js"); artReady = await waitForGlobal('Artplayer', 5000); }
            if (!hlsReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js"); hlsReady = await waitForGlobal('Hls', 5000); }

            if (!isMounted) return;

            if (artRef.current) {
                await artRef.current.switchUrl(finalUrl);
                handleVideoReady(artRef.current);
            } else {
                const ArtplayerConstructor = window.Artplayer;
                const art = new ArtplayerConstructor({
                    container: containerRef.current,
                    url: finalUrl,
                    type: 'm3u8',
                    volume: 0.7,
                    autoplay: true,
                    theme: '#2196F3',
                    lang: 'zh-cn',
                    lock: true,
                    fastForward: true,
                    screenshot: false,
                    playbackRate: true,
                    aspectRatio: true,
                    fullscreen: true,
                    fullscreenWeb: true,
                    miniProgressBar: true,
                    mutex: true,
                    backdrop: true,
                    playsInline: true,
                    autoSize: false,
                    autoMini: false,
                    setting: true,
                    pip: false,
                    airplay: false,
                    customType: {
                        m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
                            if (window.Hls.isSupported()) {
                                const hls = new window.Hls(HLS_CONFIG);
                                hls.loadSource(url);
                                hls.attachMedia(video);
                                artInstance.hls = hls;
                                hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                                    if (playbackRateRef.current !== 1) artInstance.playbackRate = playbackRateRef.current;
                                    artInstance.play().catch(() => {});
                                });
                            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                video.src = url;
                            }
                        }
                    },
                    controls: [
                        {
                            name: 'skip-intro',
                            position: 'right',
                            html: getButtonHtml('片头', skipConfigRef.current.intro, skipConfigRef.current.intro > 0, '33, 150, 243'),
                            tooltip: '设置当前位置为片头跳过点',
                            click: function (item: any, event: Event) {
                                // Correct context: 'this' is art instance
                                const art = this as any;
                                const time = art.currentTime;
                                const config = { ...skipConfigRef.current, intro: time };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                
                                art.controls.update({
                                    name: 'skip-intro',
                                    html: getButtonHtml('片头', time, true, '33, 150, 243')
                                });
                                
                                if (art.notice) art.notice.show = `片头跳过点已设为: ${Math.floor(time)}s`;
                            },
                        },
                        {
                            name: 'skip-outro',
                            position: 'right',
                            html: getButtonHtml('片尾', skipConfigRef.current.outroOffset, skipConfigRef.current.outroOffset > 0, '255, 152, 0'),
                            tooltip: '设置当前位置为片尾跳过点',
                            click: function (item: any, event: Event) {
                                const art = this as any;
                                const time = art.currentTime;
                                const duration = art.duration || 0;
                                if (duration <= 0) return;
                                const offset = duration - time;
                                const config = { ...skipConfigRef.current, outroOffset: offset };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                
                                art.controls.update({
                                    name: 'skip-outro',
                                    html: getButtonHtml('片尾', offset, true, '255, 152, 0')
                                });

                                if (art.notice) art.notice.show = `片尾跳过点已设为距结尾: ${Math.floor(offset)}s`;
                            },
                        },
                    ],
                });
                artRef.current = art;

                art.on('ready', () => handleVideoReady(art));
                art.on('fullscreen', (state: boolean) => { isFullscreenRef.current = state; });
                art.on('fullscreenWeb', (state: boolean) => { isWebFullscreenRef.current = state; });
                art.on('video:ratechange', () => { playbackRateRef.current = art.playbackRate; });

                art.on('video:timeupdate', () => {
                    const time = art.currentTime;
                    const duration = art.duration;
                    if (time > 5) {
                        const url = currentUrlRef.current;
                        const ep = playListRef.current.find(item => item.url === url);
                        updateHistoryProgress(movieId, time, url, ep?.name);
                    }
                    const config = skipConfigRef.current;
                    if (config.outroOffset > 0 && duration > 0 && (duration - time) <= config.outroOffset) {
                        if (Math.abs(duration - time) > 1.5) {
                             art.currentTime = duration;
                             if (art.notice) art.notice.show = `自动跳过片尾`;
                        }
                    }
                });

                art.on('video:ended', () => { playNextEpisode(); });
            }
        } catch (e) { setCleanStatus('播放器加载失败'); }
    };

    playVideo();

    return () => {
        isMounted = false;
        if (cleanTimeoutId) clearTimeout(cleanTimeoutId);
    };
  }, [currentUrl, movieId, effectiveAccEnabled]);

  if (loading) return <div className="flex justify-center items-center h-[80vh]"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500"></div></div>;
  if (!details) return <div className="text-center py-20 text-red-500 font-bold">内容加载失败</div>;

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn relative">
      {showShareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2"><Icon name="share" className="text-blue-500" />分享播放链接</h3>
            <div className="bg-gray-100 dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 break-all text-xs font-mono select-all">{currentUrl}</div>
            <button onClick={() => copyToClipboard(currentUrl)} className={`w-full mt-6 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold transition-all ${isCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                <Icon name={isCopied ? "check_circle" : "content_copy"} />{isCopied ? '已复制' : '复制链接'}
            </button>
          </div>
        </div>
      )}

      <section className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black" style={{ paddingBottom: `${playerRatio}%` }}>
         <div ref={containerRef} className="absolute inset-0 w-full h-full"></div>
         {cleanStatus && <div className="absolute top-4 left-4 z-50 pointer-events-none"><div className="bg-black/70 text-green-400 px-3 py-1.5 rounded-lg text-[10px] backdrop-blur-md flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>{cleanStatus}</div></div>}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 items-center">
                        <span className="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">{details.genre}</span>
                        <span>{details.year}</span><span>{details.badge}</span>
                        <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">当前源: {currentSource.name}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowShareModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent font-medium"><Icon name="share" className="text-lg" />分享</button>
                    <button onClick={handleFavoriteToggle} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-all border font-bold shadow-sm ${isFavorited ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 border-pink-200 dark:border-pink-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-transparent hover:bg-gray-200 dark:hover:bg-slate-700'}`}>
                        <Icon name={isFavorited ? "bookmark" : "bookmark_border"} className="text-lg" />
                        {isFavorited ? '已收藏' : '收藏'}
                    </button>
                </div>
             </div>
             
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Icon name="description" className="text-blue-500 text-lg" /> 剧情简介</h3>
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-6">{details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}</p>
             </div>

             <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Icon name="swap_horiz" className="text-blue-500 text-lg" /> 全网切源检测</h3>
                <div className="max-h-72 overflow-y-auto pr-1 custom-scrollbar space-y-2.5">
                    {sortedAltSources.map((alt, idx) => (
                        <button key={idx} onClick={() => handleAltSourceClick(alt)} disabled={alt.searching} className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all ${alt.source.api === currentSource.api ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-blue-400'}`}>
                            <div className="flex items-center gap-3 text-left">
                                <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center text-gray-500"><Icon name="dns" className="text-lg" /></div>
                                <div><div className="text-sm font-bold dark:text-white">{alt.source.name}</div><div className="text-[10px] text-gray-400">{alt.searching ? '检索中...' : (alt.movie ? `匹配成功` : '无结果')}</div></div>
                            </div>
                            {alt.latency && <div className="text-[10px] font-mono font-bold text-gray-400">{alt.latency}ms</div>}
                        </button>
                    ))}
                </div>
             </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 h-fit flex flex-col shadow-sm max-h-[600px]">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    <Icon name="playlist_play" className="text-blue-500 text-lg" /> 选集列表
                </h3>
                <button onClick={toggleTempAcceleration} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black transition-all border ${effectiveAccEnabled ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 border-gray-200 dark:border-gray-600'}`}>
                    <Icon name="bolt" className="text-xs" />
                    {effectiveAccEnabled ? '加速已开启' : '点击加速'}
                </button>
            </div>
            <p className="text-[9px] text-gray-400 mb-4">{playList.length} 个视频内容</p>
            {episodeSections.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-3 mb-3 hide-scrollbar">
                    {episodeSections.map((sec, idx) => (
                        <button key={idx} onClick={() => setCurrentSectionIndex(idx)} className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border ${currentSectionIndex === idx ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}>{sec.label}</button>
                    ))}
                </div>
            )}
            <div className="overflow-y-auto pr-1 custom-scrollbar grid grid-cols-2 lg:grid-cols-3 gap-2">
                {playList.slice(episodeSections.length > 0 ? episodeSections[currentSectionIndex].startIdx : 0, episodeSections.length > 0 ? episodeSections[currentSectionIndex].endIdx : playList.length).map((ep, index) => (
                    <button key={index} onClick={() => { if (currentUrl === ep.url) return; historyTimeRef.current = 0; hasAppliedHistorySeek.current = true; setCurrentUrl(ep.url); }} className={`text-[11px] py-2 rounded-lg transition-all truncate border font-medium ${currentUrl === ep.url ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 dark:bg-slate-700/50 text-gray-500 border-gray-200 dark:border-gray-600'}`}>{ep.name}</button>
                ))}
            </div>
        </div>
      </section>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }
        .art-control-volume { display: none !important; }
      `}</style>
    </main>
  );
};

export default Player;
