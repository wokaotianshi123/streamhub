import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ViewState, Movie, PlayerProps, Source } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl, searchVideos } from '../utils/api';
import { getMovieHistory, updateHistoryProgress, addToHistory } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    Artplayer: any;
  }
}

// 经过优化的 HLS 缓存配置
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
  
  // 分享功能状态
  const [showShareModal, setShowShareModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // 其他源状态
  const [altSources, setAltSources] = useState<AltSource[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const hasAppliedHistorySeek = useRef<boolean>(false);
  const blobUrlRef = useRef<string | null>(null);
  const playbackRateRef = useRef<number>(1);
  const playListRef = useRef<{name: string, url: string}[]>([]);
  const isPlayerReadyRef = useRef<boolean>(false);

  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  useEffect(() => {
    if (cleanStatus) {
        const timer = setTimeout(() => setCleanStatus(''), 5000);
        return () => clearTimeout(timer);
    }
  }, [cleanStatus]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      setPlayerRatio(56.25);
      hasAppliedHistorySeek.current = false; 
      isPlayerReadyRef.current = false;
      
      const historyItem = getMovieHistory(movieId);
      historyTimeRef.current = (historyItem && historyItem.currentTime && historyItem.currentTime > 5) ? historyItem.currentTime : 0;

      const data = await fetchVideoDetails(currentSource.api, movieId);
      if (data) {
        setDetails(data);
        const parsedEpisodes = parsePlayUrl(data.vod_play_url || '');
        setPlayList(parsedEpisodes);
        
        if (historyItem?.currentEpisodeUrl) {
            const found = parsedEpisodes.find(ep => ep.url === historyItem.currentEpisodeUrl);
            if (found) {
                setCurrentUrl(found.url);
            } else if (parsedEpisodes.length > 0) {
                setCurrentUrl(parsedEpisodes[0].url);
                historyTimeRef.current = 0; 
            }
        } else if (parsedEpisodes.length > 0) {
            setCurrentUrl(parsedEpisodes[0].url);
        }

        // 开始检测其他源
        detectAltSources(data.title);
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api]);

  // 全网切源检测逻辑
  const detectAltSources = async (title: string) => {
    const others = sources.filter(s => s.api !== currentSource.api);
    setAltSources(others.map(s => ({ source: s, latency: null, movie: null, searching: true })));

    others.forEach(async (source) => {
        const startTime = Date.now();
        try {
            const results = await searchVideos(source.api, title);
            const latency = Date.now() - startTime;
            
            // 精确标题匹配或模糊包含
            const matchedMovie = results.find(m => m.title === title) || 
                               results.find(m => m.title.includes(title)) ||
                               null;
            
            setAltSources(prev => prev.map(item => 
                item.source.api === source.api 
                ? { ...item, latency, movie: matchedMovie, searching: false } 
                : item
            ));
        } catch (e) {
            setAltSources(prev => prev.map(item => 
                item.source.api === source.api 
                ? { ...item, searching: false, movie: null, latency: 9999 } 
                : item
            ));
        }
    });
  };

  // 对切源列表进行过滤和排序：仅显示匹配到的资源，并按延迟升序排列
  const sortedAltSources = useMemo(() => {
    return altSources
        .filter(alt => alt.movie || alt.searching) // 过滤掉搜索完成但未找到资源的
        .sort((a, b) => {
            // 搜索中的排在后面，已完成的按延迟排序
            if (a.searching && !b.searching) return 1;
            if (!a.searching && b.searching) return -1;
            return (a.latency || 0) - (b.latency || 0);
        });
  }, [altSources]);

  const handleAltSourceClick = (alt: AltSource) => {
    if (alt.movie) {
        const movieWithSource = {
            ...alt.movie,
            sourceApi: alt.source.api,
            sourceName: alt.source.name
        };
        addToHistory(movieWithSource);
        onSelectMovie(movieWithSource);
    }
  };

  const handleShare = () => {
    setShowShareModal(true);
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      if (artRef.current && artRef.current.notice) {
        artRef.current.notice.show = '播放链接已复制到剪贴板';
      }
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  useEffect(() => {
    if (!currentUrl || !containerRef.current) return;
    let isMounted = true;

    const initPlayer = async () => {
        if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
        setCleanStatus('');
        isPlayerReadyRef.current = false;

        try {
            let artReady = await waitForGlobal('Artplayer', 3000);
            let hlsReady = await waitForGlobal('Hls', 3000);
            if (!artReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/artplayer/5.2.1/artplayer.js"); artReady = await waitForGlobal('Artplayer', 5000); }
            if (!hlsReady) { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js"); hlsReady = await waitForGlobal('Hls', 5000); }
            if (!artReady || !hlsReady) { setCleanStatus('播放库加载失败'); return; }
        } catch (e) { setCleanStatus('系统初始化异常'); return; }

        if (!isMounted) return;

        let finalUrl = currentUrl;
        if (currentUrl.includes('.m3u8')) {
            try {
                setCleanStatus('解析安全流中...');
                const result = await fetchAndCleanM3u8(currentUrl);
                if (isMounted) {
                    if (result.removedCount > 0) {
                        const blob = new Blob([result.content], { type: 'application/vnd.apple.mpegurl' });
                        finalUrl = URL.createObjectURL(blob);
                        blobUrlRef.current = finalUrl;
                        setCleanStatus(`✅ 净化引擎就绪`);
                    } else setCleanStatus('');
                }
            } catch (e) { if (isMounted) setCleanStatus(''); }
        }

        if (!isMounted) return;
        if (artRef.current) artRef.current.destroy(false);

        const ArtplayerConstructor = window.Artplayer;
        
        const performSeek = (artInstance: any) => {
            if (historyTimeRef.current <= 0 || hasAppliedHistorySeek.current) {
                isPlayerReadyRef.current = true;
                return;
            }

            const targetTime = historyTimeRef.current;
            
            const doSeek = () => {
                if (hasAppliedHistorySeek.current) return;
                artInstance.currentTime = targetTime;
                setTimeout(() => {
                    if (!artInstance || !artInstance.video) return;
                    const actualTime = artInstance.currentTime;
                    if (Math.abs(actualTime - targetTime) < 2) {
                        hasAppliedHistorySeek.current = true;
                        isPlayerReadyRef.current = true;
                        const mins = Math.floor(targetTime / 60);
                        const secs = Math.floor(targetTime % 60);
                        artInstance.notice.show = `已自动为您恢复播放进度: ${mins}分${secs}秒`;
                    } else {
                        artInstance.currentTime = targetTime;
                        hasAppliedHistorySeek.current = true;
                        isPlayerReadyRef.current = true;
                    }
                }, 500);
            };

            if (artInstance.video.readyState >= 2) {
                doSeek();
            } else {
                artInstance.once('video:canplay', doSeek);
            }
        };

        const art = new ArtplayerConstructor({
            container: containerRef.current,
            url: finalUrl,
            type: 'm3u8',
            volume: 0.7,
            autoplay: true,
            autoPlayback: false, 
            theme: '#2196F3',
            lang: 'zh-cn',
            lock: true,
            fastForward: true,
            autoSize: false,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            subtitleOffset: true,
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: true,
            moreVideoAttr: { 
                crossOrigin: 'anonymous', 
                playsInline: true, 
                'webkit-playsinline': 'true',
                'x5-playsinline': 'true'
            },
            customType: {
                m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
                    if (window.Hls.isSupported()) {
                        if (artInstance.hls) artInstance.hls.destroy();
                        const hls = new window.Hls(HLS_CONFIG);
                        hls.loadSource(url);
                        hls.attachMedia(video);
                        artInstance.hls = hls;
                        
                        hls.once(window.Hls.Events.MANIFEST_PARSED, () => {
                            if (playbackRateRef.current !== 1) artInstance.playbackRate = playbackRateRef.current;
                            artInstance.play().catch(() => {});
                            performSeek(artInstance);
                        });
                        artInstance.on('destroy', () => hls.destroy());
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                        video.addEventListener('loadedmetadata', () => performSeek(artInstance));
                    }
                }
            },
        });

        artRef.current = art;
        art.on('video:canplay', () => performSeek(art));
        art.on('ready', () => performSeek(art));
        art.on('video:loadedmetadata', () => {
            const v = art.video;
            if (v && v.videoWidth && v.videoHeight) {
                let ratio = (v.videoHeight / v.videoWidth) * 100;
                setPlayerRatio(Math.min(Math.max(ratio, 30), 100));
            }
        });
        art.on('video:ratechange', () => { playbackRateRef.current = art.playbackRate; });
        art.on('video:timeupdate', () => {
            if (isPlayerReadyRef.current && art.currentTime > 5) {
                const ep = playListRef.current.find(item => item.url === currentUrl);
                updateHistoryProgress(movieId, art.currentTime, currentUrl, ep?.name);
            }
        });
        art.on('video:ended', () => {
            const list = playListRef.current;
            const currentIndex = list.findIndex(ep => ep.url === currentUrl);
            if (currentIndex !== -1 && currentIndex < list.length - 1) {
                const nextEp = list[currentIndex + 1];
                art.notice.show = `即将播放下一集: ${nextEp.name}`;
                setTimeout(() => {
                    historyTimeRef.current = 0;
                    hasAppliedHistorySeek.current = true; 
                    isPlayerReadyRef.current = false;
                    setCurrentUrl(nextEp.url);
                }, 1500);
            }
        });
    };

    initPlayer();
    return () => {
        isMounted = false;
        if (artRef.current && artRef.current.destroy) {
            playbackRateRef.current = artRef.current.playbackRate;
            artRef.current.destroy(false);
            artRef.current = null;
        }
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [currentUrl, movieId]);

  if (loading) return <div className="flex justify-center items-center h-[80vh]"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div></div>;
  if (!details) return <div className="text-center py-20 text-red-500 font-bold">内容加载失败，请尝试刷新页面或切换来源</div>;

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn relative">
      {/* 分享模态框 */}
      {showShareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <Icon name="share" className="text-blue-500" />
              分享播放链接
            </h3>
            <div className="space-y-4">
              <div className="bg-gray-100 dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 break-all text-sm text-gray-600 dark:text-gray-300 font-mono select-all">
                {currentUrl}
              </div>
              <div className="flex gap-3 mt-8">
                <button 
                  onClick={() => copyToClipboard(currentUrl)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold transition-all shadow-lg active:scale-95 ${isCopied ? 'bg-green-600 text-white shadow-green-500/30' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/20'}`}
                >
                  <Icon name={isCopied ? "check_circle" : "content_copy"} />
                  {isCopied ? '已复制到剪贴板' : '一键复制播放链接'}
                </button>
              </div>
              <button 
                onClick={() => setShowShareModal(false)}
                className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black ring-1 ring-gray-800 transition-all duration-700" style={{ paddingBottom: `${playerRatio}%` }}>
         {currentUrl ? (
             <><div ref={containerRef} className="absolute inset-0 w-full h-full"></div>
                {cleanStatus && <div className="absolute top-4 left-4 z-50 pointer-events-none"><div className="bg-black/70 text-green-400 border border-green-500/30 px-3 py-1.5 rounded-lg text-xs backdrop-blur-md flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>{cleanStatus}</div></div>}
             </>
         ) : <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">资源链接无效</div>}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex-1">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                    <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400 items-center">
                        <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold">{details.genre}</span>
                        <span>{details.year}</span><span>{details.badge}</span>
                        {currentSource.name && <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-xs border border-blue-200 dark:border-blue-800 flex items-center gap-1"><Icon name="radio_button_checked" className="text-[10px]" />当前源: {currentSource.name}</span>}
                    </div>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={handleShare}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600 font-medium cursor-pointer"
                    >
                        <Icon name="share" className="text-lg" />
                        分享
                    </button>
                    <button className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600 font-medium">
                        <Icon name="bookmark_border" className="text-lg" />
                        收藏
                    </button>
                </div>
             </div>
             
             {/* 剧情简介 */}
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Icon name="description" className="text-blue-500" /> 剧情简介</h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 line-clamp-6">{details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}</p>
             </div>

             {/* 全网切源展示盒 */}
             <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Icon name="swap_horiz" className="text-blue-500" /> 
                        全网切源检测
                    </h3>
                    <span className="text-[10px] text-gray-400 font-normal">已按响应延迟自动排序</span>
                </div>
                
                <div className="max-h-72 overflow-y-auto pr-1 custom-scrollbar space-y-2.5">
                    {/* 当前线路固化展示 */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/50 ring-1 ring-blue-500/10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/20">
                                <Icon name="play_arrow" />
                            </div>
                            <div>
                                <div className="text-sm font-bold text-blue-700 dark:text-blue-300">{currentSource.name}</div>
                                <div className="text-[10px] text-blue-500/70">正在播放此线路内容</div>
                            </div>
                        </div>
                        <span className="text-[10px] px-2.5 py-1 bg-blue-600 text-white rounded-full font-bold shadow-sm">当前线路</span>
                    </div>

                    {/* 排序后的其他线路 */}
                    {sortedAltSources.map((alt, idx) => (
                        <button 
                            key={idx}
                            onClick={() => handleAltSourceClick(alt)}
                            disabled={alt.searching}
                            className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all relative group ${
                                alt.searching 
                                ? 'bg-gray-50/50 dark:bg-slate-800/30 border-gray-100 dark:border-gray-800 cursor-default' 
                                : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-blue-400 hover:shadow-lg dark:hover:bg-slate-800/80 active:scale-[0.98]'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                                    alt.searching 
                                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-400' 
                                    : (alt.latency && alt.latency < 500 ? 'bg-green-50 dark:bg-green-900/20 text-green-600' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600')
                                }`}>
                                    <Icon name="dns" className="text-lg" />
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-bold text-gray-800 dark:text-gray-200 group-hover:text-blue-500 transition-colors">{alt.source.name}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5 max-w-[180px] truncate">
                                        {alt.searching ? '正在深度检索资源...' : (alt.movie ? `匹配资源: ${alt.movie.title}` : '此线路暂无结果')}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-col items-end gap-1.5">
                                {alt.searching ? (
                                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        <div className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                                            alt.latency && alt.latency < 500 
                                            ? 'text-green-600 bg-green-100/50 dark:bg-green-900/40' 
                                            : 'text-amber-600 bg-amber-100/50 dark:bg-amber-900/40'
                                        }`}>
                                            {alt.latency}ms
                                        </div>
                                        <Icon name="arrow_forward_ios" className="text-[10px] text-gray-300 group-hover:text-blue-400 transition-colors" />
                                    </>
                                )}
                            </div>
                        </button>
                    ))}

                    {!loading && sortedAltSources.length === 0 && (
                        <div className="text-center py-10 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
                            <Icon name="sentiment_dissatisfied" className="text-3xl text-gray-300 mb-2" />
                            <p className="text-xs text-gray-400 italic">全网检索完毕，暂无其他可切换的匹配线路</p>
                        </div>
                    )}
                </div>
             </div>

             {(details.vod_actor || details.vod_director) && (
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     {details.vod_director && (
                         <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                             <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">导演</span>
                             <span className="text-sm font-medium dark:text-white">{details.vod_director}</span>
                         </div>
                     )}
                     {details.vod_actor && (
                         <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                             <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">主演</span>
                             <span className="text-sm font-medium dark:text-white truncate block">{details.vod_actor}</span>
                         </div>
                     )}
                 </div>
             )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 h-fit max-h-[600px] flex flex-col shadow-sm">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white flex items-center justify-between">
                <span className="flex items-center gap-2"><Icon name="playlist_play" className="text-blue-500" /> 选集列表</span>
                <span className="text-xs font-normal text-gray-400">{playList.length} 个视频</span>
            </h3>
            <div className="overflow-y-auto pr-1 custom-scrollbar">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {playList.map((ep, index) => (
                        <button 
                            key={index} 
                            onClick={() => { 
                                if (currentUrl === ep.url) return;
                                historyTimeRef.current = 0; 
                                hasAppliedHistorySeek.current = true; 
                                isPlayerReadyRef.current = false;
                                setCurrentUrl(ep.url); 
                            }} 
                            className={`text-xs py-2.5 px-2 rounded-lg transition-all truncate border font-medium ${currentUrl === ep.url ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-[1.02]' : 'bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-600'}`} 
                            title={ep.name}
                        >
                            {ep.name}
                        </button>
                    ))}
                </div>
                {playList.length === 0 && (
                    <div className="text-center py-10 text-gray-500 text-sm italic">暂无可选播放线路</div>
                )}
            </div>
        </div>
      </section>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #334155;
        }
      `}</style>
    </main>
  );
};

export default Player;