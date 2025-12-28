
import React, { useEffect, useState, useRef } from 'react';
import { ViewState, Movie, PlayerProps } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl } from '../utils/api';
import { getMovieHistory, updateHistoryProgress } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    Artplayer: any;
  }
}

const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    startBufferLength: 20,
    maxBufferLength: 120,
    maxMaxBufferLength: 600,
    maxBufferSize: 200 * 1024 * 1024,
    backBufferLength: 90,
    fragLoadingTimeOut: 20000,
    fragLoadingMaxRetry: 6,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    maxLoadingDelay: 4, 
    minAutoBitrate: 0, 
    capLevelToPlayerSize: false, 
    autoStartLoad: true,
    maxBufferHole: 0.5,
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

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  const [playerRatio, setPlayerRatio] = useState<number>(56.25);
  
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

  // 1. 加载详情及历史进度
  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      setPlayerRatio(56.25);
      hasAppliedHistorySeek.current = false; 
      isPlayerReadyRef.current = false;
      
      const historyItem = getMovieHistory(movieId);
      // 精准提取历史进度 (只有在超过5秒时才尝试恢复)
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
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api]);

  // 2. 初始化播放器
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
        
        // 核心：鲁棒的进度跳转函数
        const performSeek = (artInstance: any) => {
            if (historyTimeRef.current <= 0 || hasAppliedHistorySeek.current) {
                isPlayerReadyRef.current = true;
                return;
            }

            const targetTime = historyTimeRef.current;
            
            const doSeek = () => {
                if (hasAppliedHistorySeek.current) return;
                
                // 设置进度
                artInstance.currentTime = targetTime;
                
                // 验证跳转是否成功 (500ms后检查)
                setTimeout(() => {
                    if (!artInstance || !artInstance.video) return;
                    
                    const actualTime = artInstance.currentTime;
                    // 如果当前时间非常接近目标时间，认为跳转成功
                    if (Math.abs(actualTime - targetTime) < 2) {
                        hasAppliedHistorySeek.current = true;
                        isPlayerReadyRef.current = true;
                        const mins = Math.floor(targetTime / 60);
                        const secs = Math.floor(targetTime % 60);
                        artInstance.notice.show = `已自动为您恢复播放进度: ${mins}分${secs}秒`;
                    } else {
                        // 补偿逻辑：如果还没到目标点，再试一次
                        artInstance.currentTime = targetTime;
                        hasAppliedHistorySeek.current = true;
                        isPlayerReadyRef.current = true;
                    }
                }, 500);
            };

            // 必须在视频有足够数据时跳转
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
                            artInstance.play().catch(() => {
                                // 忽略自动播放受限错误
                            });
                            // HLS 解析完后尝试首次跳转
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

        // 多种就绪事件监听，确保万无一失
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
            // 严谨判断：只有跳转完成且当前时间有效时才保存
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
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn">
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
                        {currentSource.name && <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-xs border border-blue-200 dark:border-blue-800">源: {currentSource.name}</span>}
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600 font-medium">
                        <Icon name="share" className="text-lg" />
                        分享
                    </button>
                    <button className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600 font-medium">
                        <Icon name="bookmark_border" className="text-lg" />
                        收藏
                    </button>
                </div>
             </div>
             
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2"><Icon name="description" className="text-blue-500" /> 剧情简介</h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 line-clamp-6">{details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}</p>
             </div>

             {(details.vod_actor || details.vod_director) && (
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     {details.vod_director && (
                         <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                             <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">导演</span>
                             <span className="text-sm font-medium dark:text-white">{details.vod_director}</span>
                         </div>
                     )}
                     {details.vod_actor && (
                         <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
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
            <div className="overflow-y-auto pr-1 hide-scrollbar">
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
    </main>
  );
};

export default Player;
