import React, { useEffect, useState, useRef } from 'react';
import { ViewState, Movie, PlayerProps } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl } from '../utils/api';
import { getMovieHistory, updateHistoryProgress } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
    DPlayer: any;
  }
}

// --- HLS Configuration from Pro Version ---
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

// --- Helper: Fetch and Clean M3U8 (Ad Removal) ---
const fetchAndCleanM3u8 = async (url: string, depth = 0): Promise<{ content: string; removedCount: number; log: string }> => {
    if (depth > 3) throw new Error("Redirect loop detected in M3U8 playlist");
    const toAbsolute = (p: string, b: string) => { try { return new URL(p, b).href; } catch(e) { return p; } };
    
    // 1. Fetch content
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const originalContent = await response.text();

    const lines = originalContent.split(/\r?\n/);

    // 2. Handle Master Playlist (Recursive fetch for highest bandwidth)
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

    // 3. Analyze Segments for Fingerprinting
    const segments: { idx: number; fp: string }[] = [];
    const fingerprintCounts: Record<string, number> = {};
    
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if(!trimmed || trimmed.startsWith('#')) return;
        const absUrl = toAbsolute(trimmed, url);
        let u; try { u = new URL(absUrl); } catch(e) { return; }
        // Fingerprint: Hostname + Path without filename
        const pathParts = u.pathname.split('/'); pathParts.pop(); 
        const fp = `${u.hostname}|${pathParts.join('/')}`;
        if(!fingerprintCounts[fp]) fingerprintCounts[fp] = 0;
        fingerprintCounts[fp]++;
        segments.push({ idx, fp });
    });
    
    // Find dominant fingerprint (The content)
    let dominantFp = '', maxC = 0;
    for(const [fp, c] of Object.entries(fingerprintCounts)) { if(c > maxC) { maxC = c; dominantFp = fp; } }
    
    // If homogeneity is too low, it might be already clean or mixed content we shouldn't touch
    if(segments.length === 0 || (maxC / segments.length) < 0.4) {
        return { content: originalContent, removedCount: 0, log: '未清洗 (特征不明显)' };
    }

    // 4. Mark lines to remove
    const linesToRemove = new Set<number>();
    segments.forEach(seg => {
        if(seg.fp !== dominantFp) {
            linesToRemove.add(seg.idx);
            // Trace back to remove associated metadata (EXTINF, etc)
            let j = seg.idx - 1;
            while(j >= 0) {
                const l = lines[j].trim();
                if(l.startsWith('#EXTINF') || l.startsWith('#EXT-X-BYTERANGE') || l.startsWith('#EXT-X-KEY') || l.startsWith('#EXT-X-DISCONTINUITY')) { linesToRemove.add(j); j--; } 
                else if (!l.startsWith('#EXT') && l.startsWith('#')) { j--; } 
                else if (l === '') { j--; } else { break; }
            }
        }
    });

    // 5. Reconstruct M3U8
    const newLines: string[] = [];
    lines.forEach((line, idx) => {
        if(linesToRemove.has(idx)) return;
        let content = line.trim();
        if(!content) return;
        if(content.startsWith('#')) {
            // Fix relative keys
            if(content.startsWith('#EXT-X-KEY') && content.includes('URI="')) {
                content = content.replace(/URI="([^"]+)"/, (m, p1) => `URI="${toAbsolute(p1, url)}"`);
            }
            newLines.push(content);
        } else {
            newLines.push(toAbsolute(content, url));
        }
    });
    
    const removedCount = segments.length - maxC;
    return { content: newLines.join('\n'), removedCount: depth > 0 ? (removedCount + 1) : removedCount, log: `已移除 ${removedCount} 个广告分片` };
};

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const dpRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const blobUrlRef = useRef<string | null>(null);

  // 1. Fetch Movie Details
  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      
      const historyItem = getMovieHistory(movieId);
      if (historyItem && historyItem.currentTime) {
        historyTimeRef.current = historyItem.currentTime;
      }

      const data = await fetchVideoDetails(currentSource.api, movieId);
      if (data) {
        setDetails(data);
        const parsedEpisodes = parsePlayUrl(data.vod_play_url || '');
        setPlayList(parsedEpisodes);
        if (parsedEpisodes.length > 0) {
            setCurrentUrl(parsedEpisodes[0].url);
        }
      }
      setLoading(false);
    };
    if (movieId) {
      loadDetails();
    }
  }, [movieId, currentSource]);

  // 2. Initialize Player when URL changes
  useEffect(() => {
    if (!currentUrl || !containerRef.current) return;

    const initPlayer = async () => {
        // Cleanup previous
        if (dpRef.current) {
            dpRef.current.destroy();
            dpRef.current = null;
        }
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
        setCleanStatus('');

        let finalUrl = currentUrl;
        
        // Try M3U8 Cleaning
        if (currentUrl.includes('.m3u8')) {
            try {
                setCleanStatus('正在智能分析媒体流...');
                const result = await fetchAndCleanM3u8(currentUrl);
                if (result.removedCount > 0) {
                    const blob = new Blob([result.content], { type: 'application/vnd.apple.mpegurl' });
                    finalUrl = URL.createObjectURL(blob);
                    blobUrlRef.current = finalUrl;
                    setCleanStatus(`✅ 净化成功: ${result.log}`);
                } else {
                    setCleanStatus('');
                }
            } catch (e) {
                console.warn('Cleaning skipped:', e);
                setCleanStatus('');
            }
        }

        // Init DPlayer
        const dp = new window.DPlayer({
            container: containerRef.current,
            theme: '#00ccff',
            lang: 'zh-cn',
            screenshot: true,
            video: {
                url: finalUrl,
                type: 'customHls',
                customType: {
                    customHls: function(video: HTMLVideoElement, player: any) {
                        if (window.Hls.isSupported()) {
                            const hls = new window.Hls(HLS_CONFIG);
                            hls.loadSource(video.src);
                            hls.attachMedia(video);
                            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                                if (historyTimeRef.current > 0) {
                                    video.currentTime = historyTimeRef.current;
                                }
                            });
                        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                             video.src = video.src;
                             if (historyTimeRef.current > 0) {
                                 video.currentTime = historyTimeRef.current;
                             }
                        }
                    }
                }
            }
        });

        dpRef.current = dp;

        // Events
        dp.on('timeupdate', () => {
            if (dp.video.currentTime > 5) {
                updateHistoryProgress(movieId, dp.video.currentTime);
            }
        });
        
        dp.on('canplay', () => {
            // Ensure history is applied if missed by HLS event
             if (Math.abs(dp.video.currentTime - historyTimeRef.current) > 5 && historyTimeRef.current > 0) {
                 dp.seek(historyTimeRef.current);
             }
        });
    };

    initPlayer();

    return () => {
        if (dpRef.current) {
            dpRef.current.destroy();
        }
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
        }
    };
  }, [currentUrl, movieId]);

  if (loading) {
      return (
        <div className="flex justify-center items-center h-[80vh]">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      );
  }

  if (!details) {
      return (
          <div className="text-center py-20 text-red-500">无法加载视频详情</div>
      );
  }

  return (
    <main className="container mx-auto px-4 py-6 space-y-8 animate-fadeIn">
      {/* Player Section */}
      <section className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black aspect-video sm:aspect-[16/9] lg:aspect-[21/9] ring-1 ring-gray-800">
         {currentUrl ? (
             <>
                <div ref={containerRef} className="w-full h-full"></div>
                
                {/* Status Overlay */}
                {cleanStatus && (
                    <div className="absolute top-4 left-4 z-50 pointer-events-none">
                        <div className="bg-black/70 text-green-400 border border-green-500/30 px-3 py-1.5 rounded-lg text-xs backdrop-blur-md shadow-lg animate-fadeIn flex items-center gap-2">
                             <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                             {cleanStatus}
                        </div>
                    </div>
                )}
             </>
         ) : (
             <div className="w-full h-full flex items-center justify-center text-white bg-gray-900">
                 <div className="text-center">
                    <Icon name="error_outline" className="text-5xl text-gray-600 mb-2" />
                    <p className="text-gray-400">暂无播放资源</p>
                 </div>
             </div>
         )}
      </section>

      {/* Info Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
             <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400 items-center">
                    <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs font-bold shadow-sm shadow-blue-500/30">{details.genre}</span>
                    <span className="flex items-center gap-1"><Icon name="calendar_today" className="text-xs" /> {details.year}</span>
                    <span className="flex items-center gap-1"><Icon name="high_quality" className="text-xs" /> {details.badge}</span>
                </div>
             </div>
             
             {/* Content */}
             <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Icon name="description" className="text-blue-500" /> 剧情简介
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 text-justify">
                    {details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无简介'}
                </p>
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <p className="flex gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white min-w-[3rem]">导演:</span> 
                        <span className="text-gray-600 dark:text-gray-400">{details.vod_director}</span>
                    </p>
                    <p className="flex gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white min-w-[3rem]">主演:</span> 
                        <span className="text-gray-600 dark:text-gray-400 line-clamp-2">{details.vod_actor}</span>
                    </p>
                </div>
             </div>
        </div>

        {/* Playlist Section */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 h-fit max-h-[600px] flex flex-col shadow-sm">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white flex items-center justify-between">
                <span className="flex items-center gap-2"><Icon name="playlist_play" className="text-blue-500" /> 选集</span>
                <span className="text-xs font-normal bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-full text-gray-500 dark:text-gray-400">{playList.length} 集</span>
            </h3>
            <div className="overflow-y-auto pr-1 hide-scrollbar">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {playList.map((ep, index) => (
                        <button 
                            key={index}
                            onClick={() => {
                                setCurrentUrl(ep.url);
                                historyTimeRef.current = 0; // Reset history for new episode
                            }}
                            className={`text-xs py-2.5 px-2 rounded-lg transition-all truncate border font-medium ${
                                currentUrl === ep.url 
                                ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20' 
                                : 'bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-600'
                            }`}
                            title={ep.name}
                        >
                            {ep.name}
                        </button>
                    ))}
                </div>
                {playList.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                        <Icon name="broken_image" className="text-4xl mb-2 opacity-50" />
                        <p className="text-xs">暂无播放源</p>
                    </div>
                )}
            </div>
        </div>
      </section>
    </main>
  );
};

export default Player;