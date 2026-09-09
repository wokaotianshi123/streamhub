
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

const EPISODES_PER_SECTION = 20;

const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
};

const waitForGlobal = async (key: 'Artplayer' | 'Hls', timeout = 10000): Promise<boolean> => {
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
    try {
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
    } catch(e) {
        clearTimeout(timeoutId);
        throw e;
    }
};

const getButtonHtml = (label: string, time: number, isActive: boolean, color: string) => {
    const bg = isActive ? `rgba(${color}, 0.8)` : 'rgba(0,0,0,0.5)';
    const border = isActive ? `rgba(${color}, 1)` : 'rgba(255,255,255,0.2)';
    const text = isActive ? `${label} ${Math.floor(time)}s` : label;
    return `<span style="font-size: 11px; padding: 2px 10px; cursor: pointer; background: ${bg}; border-radius: 4px; border: 1px solid ${border}; color: white; display: inline-block; min-width: 45px; text-align: center; transition: all 0.2s;">${text}</span>`;
};

const generateEpisodeLayerHtml = (list: {name: string, url: string}[], current: string, sectionIndex: number) => {
    if (!list || list.length === 0) return '<div style="color:#aaa;text-align:center;padding:20px;">暂无选集</div>';
    
    const totalSections = Math.ceil(list.length / EPISODES_PER_SECTION);
    const safeSectionIndex = Math.max(0, Math.min(sectionIndex, totalSections - 1));
    const startIdx = safeSectionIndex * EPISODES_PER_SECTION;
    const endIdx = Math.min((safeSectionIndex + 1) * EPISODES_PER_SECTION, list.length);
    const currentList = list.slice(startIdx, endIdx);

    let tabsHtml = '';
    if (totalSections > 1) {
         tabsHtml = `<div class="art-ep-tabs custom-scrollbar">
            ${Array.from({length: totalSections}).map((_, idx) => {
                const isActive = idx === safeSectionIndex;
                const start = idx * EPISODES_PER_SECTION + 1;
                const end = Math.min((idx + 1) * EPISODES_PER_SECTION, list.length);
                return `<div class="art-ep-tab ${isActive ? 'active' : ''}" data-index="${idx}">${start}-${end}</div>`;
            }).join('')}
        </div>`;
    }

    return `
        ${tabsHtml}
        <div class="art-ep-list custom-scrollbar">
            ${currentList.map(ep => `
                <div class="art-ep-item ${ep.url === current ? 'active' : ''}" data-url="${ep.url}" title="${ep.name}">
                    ${ep.name}
                </div>
            `).join('')}
        </div>
    `;
};

interface AltSourceStatus {
    source: Source;
    status: 'idle' | 'searching' | 'success' | 'empty' | 'error';
    latency?: number;
    movie?: Movie;
}

const ControlButton: React.FC<{ 
    icon: string; 
    text: string; 
    onClick: () => void; 
    active?: boolean; 
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    buttonRef?: (el: HTMLButtonElement | null) => void;
}> = ({ icon, text, onClick, active, className = '', onKeyDown, buttonRef }) => (
    <button 
        ref={buttonRef}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={`flex flex-col items-center justify-center p-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all border focus:ring-2 focus:ring-blue-400 focus:outline-none w-full h-full ${active ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-600'} ${className}`}
        tabIndex={0}
    >
        <Icon name={icon} className="text-xl sm:text-base mb-0.5" />
        <span className="whitespace-nowrap scale-[0.85] sm:scale-100 origin-center">{text}</span>
    </button>
);

type UpscaleLevel = 'off' | 'low';

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource, sources, onSelectMovie, initialMovie }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [cleanStatus, setCleanStatus] = useState<string>('');
  const [isFavorited, setIsFavorited] = useState(false);
  const accConfig = useMemo(() => getAccelerationConfig(), []);
  const [isTempAccelerationEnabled, setIsTempAccelerationEnabled] = useState(false);
  
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [altSources, setAltSources] = useState<AltSourceStatus[]>([]);
  const [hasStartedSearch, setHasStartedSearch] = useState(false);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [enableAdBlock, setEnableAdBlock] = useState(true);
  const [upscaleLevel, setUpscaleLevel] = useState<UpscaleLevel>('off');
  const [showCastModal, setShowCastModal] = useState(false);
  const [castSearching, setCastSearching] = useState(false);
  const [showWVCInstallModal, setShowWVCInstallModal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const historyTimeRef = useRef<number>(0);
  const hasAppliedHistorySeek = useRef<boolean>(false);
  const blobUrlRef = useRef<string | null>(null);
  const isFullscreenRef = useRef<boolean>(false);
  const isWebFullscreenRef = useRef<boolean>(false);
  const playbackRateRef = useRef<number>(1);
  const brightnessRef = useRef<number>(1);
  const swipeRef = useRef({
      startX: 0,
      startY: 0,
      startVal: 0,
      type: null as 'brightness' | 'volume' | null
  });
  
  const playListRef = useRef<{name: string, url: string}[]>([]);
  const currentUrlRef = useRef<string>('');
  const skipConfigRef = useRef<SkipConfig>({ intro: 0, outroOffset: 0 });
  const episodeLayerRef = useRef<HTMLElement | null>(null);

  const controlButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const favoriteButtonRef = useRef<HTMLButtonElement>(null);
  const accButtonRef = useRef<HTMLButtonElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    playListRef.current = playList;
  }, [playList]);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    const updateLayer = () => {
         const html = generateEpisodeLayerHtml(playList, currentUrl, currentSectionIndex);
         if (episodeLayerRef.current) {
             episodeLayerRef.current.innerHTML = html;
         } else if (artRef.current && artRef.current.template) {
             const el = artRef.current.template.$container.querySelector('.art-ep-layer-box');
             if (el) el.innerHTML = html;
         }
    };
    updateLayer();
  }, [playList, currentUrl, currentSectionIndex]);

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
        if (idx !== -1) {
            const section = Math.floor(idx / EPISODES_PER_SECTION);
            setCurrentSectionIndex(section);
        }
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
      hasAppliedHistorySeek.current = false; 
      setIsFavorited(isFavorite(movieId));
      skipConfigRef.current = getSkipConfig(movieId);
      setAltSources([]);
      setHasStartedSearch(false);
      setUpscaleLevel('off'); // 重置画质增强为关闭

      const historyItem = getMovieProgress(movieId);
      historyTimeRef.current = (historyItem?.currentTime && historyItem.currentTime > 5) ? historyItem.currentTime : 0;

      const data = await fetchVideoDetails(currentSource.api, movieId);
      const effective = data || (initialMovie && initialMovie.id === movieId ? initialMovie : null);
      if (effective) {
        setDetails(effective);
        const parsedEpisodes = parsePlayUrl(effective.vod_play_url || '');
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
      }
      setLoading(false);
    };
    if (movieId) loadDetails();
  }, [movieId, currentSource.api, initialMovie]);

  const startAltSearch = () => {
      if (!details) return;
      setHasStartedSearch(true);
      const others = sources.filter(s => s.api !== currentSource.api);
      setAltSources(others.map(s => ({ source: s, status: 'searching' })));

      others.forEach(async (source) => {
        const start = Date.now();
        try {
            const res = await searchVideos(source.api, details.title);
            const latency = Date.now() - start;
            const match = res.find(m => m.title === details.title) || res.find(m => m.title.includes(details.title));
            
            setAltSources(prev => prev.map(item => {
                if (item.source.api === source.api) {
                    return {
                        ...item,
                        status: match ? 'success' : 'empty',
                        latency,
                        movie: match ? { ...match, sourceApi: source.api, sourceName: source.name } : undefined
                    };
                }
                return item;
            }));
        } catch (e) {
             setAltSources(prev => prev.map(item => {
                if (item.source.api === source.api) {
                    return { ...item, status: 'error', latency: Date.now() - start };
                }
                return item;
            }));
        }
    });
  };

  const handleCheckSources = () => {
      setShowSourceSelector(true);
      startAltSearch();
  };

  const sortedAltSources = useMemo(() => {
    const filtered = altSources.filter(s => s.status !== 'empty');
    return [...filtered].sort((a, b) => {
        if (a.status === 'success' && b.status !== 'success') return -1;
        if (a.status !== 'success' && b.status === 'success') return 1;
        if (a.status === 'searching' && b.status !== 'searching') return -1;
        if (a.status !== 'searching' && b.status === 'searching') return 1;
        if (a.status === 'success' && b.status === 'success') {
            return (a.latency || 0) - (b.latency || 0);
        }
        return 0;
    });
  }, [altSources]);

  const handleAltSourceClick = (alt: AltSourceStatus) => {
    if (alt.movie) {
        const movieWithSource = { ...alt.movie, sourceApi: alt.source.api, sourceName: alt.source.name };
        addToHistory(movieWithSource);
        onSelectMovie(movieWithSource);
        setShowSourceSelector(false);
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

  const handleShare = () => {
      setShowShareModal(true);
      setIsCopied(false);
  };

  const getShareText = () => {
      if (!details) return currentUrl;
      return `正在观看《${details.title}》\n播放链接：${currentUrl}\n(分享自 StreamHub Vision)`;
  };

  const copyShareText = async () => {
    const text = getShareText();
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
      safeShowNotice('分享内容已复制');
    } catch (err) {}
  };

  const handleNextEpisode = () => {
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
        }, 500);
    } else {
        safeShowNotice('已是最后一集');
    }
  };

  const handlePrevEpisode = () => {
    const list = playListRef.current;
    const current = currentUrlRef.current;
    const currentIndex = list.findIndex(ep => ep.url === current);
    if (currentIndex > 0) {
        const prevEp = list[currentIndex - 1];
        safeShowNotice(`即将播放: ${prevEp.name}`);
        setTimeout(() => { 
            historyTimeRef.current = 0; 
            hasAppliedHistorySeek.current = true; 
            setCurrentUrl(prevEp.url); 
        }, 500);
    } else {
        safeShowNotice('已是第一集');
    }
  };

  const toggleAdBlock = () => {
      const newState = !enableAdBlock;
      setEnableAdBlock(newState);
      safeShowNotice(newState ? '已开启去广告 (尝试重载)' : '已关闭去广告 (加载原画)');
  };

  const handleSetIntro = () => {
      if(!artRef.current) return;
      const time = artRef.current.currentTime;
      const currentIntro = skipConfigRef.current.intro;
      const newIntro = currentIntro > 0 ? 0 : time;
      const config = { ...skipConfigRef.current, intro: newIntro };
      skipConfigRef.current = config;
      setSkipConfig(movieId, config);
      artRef.current.controls.update({
          name: 'skip-intro',
          html: getButtonHtml('片头', newIntro, newIntro > 0, '33, 150, 243')
      });
      safeShowNotice(newIntro > 0 ? `片头跳过点: ${Math.floor(newIntro)}s` : `已取消片头跳过`);
  };

  const handleSetOutro = () => {
      if(!artRef.current) return;
      const time = artRef.current.currentTime;
      const duration = artRef.current.duration || 0;
      if (duration <= 0) return;
      const offset = duration - time;
      const currentOutro = skipConfigRef.current.outroOffset;
      const newOutro = currentOutro > 0 ? 0 : offset;
      const config = { ...skipConfigRef.current, outroOffset: newOutro };
      skipConfigRef.current = config;
      setSkipConfig(movieId, config);
      artRef.current.controls.update({
          name: 'skip-outro',
          html: getButtonHtml('片尾', newOutro, newOutro > 0, '255, 152, 0')
      });
      safeShowNotice(newOutro > 0 ? `片尾跳过点已设为距结尾: ${Math.floor(newOutro)}s` : `已取消片尾跳过`);
  };

  const handleCycleSpeed = () => {
      if(!artRef.current) return;
      const rates = [1.0, 1.25, 1.5, 2.0];
      const current = artRef.current.playbackRate;
      const nextIdx = rates.findIndex(r => r > current);
      const next = nextIdx === -1 ? rates[0] : rates[nextIdx];
      artRef.current.playbackRate = next;
      safeShowNotice(`倍速: ${next}x`);
  };

  const handleToggleFullscreen = () => {
      if(!artRef.current) return;
      artRef.current.fullscreen = !artRef.current.fullscreen;
  };
  
  const cycleUpscale = () => {
      const nextLevel = upscaleLevel === 'off' ? 'low' : 'off';
      setUpscaleLevel(nextLevel);

      if (artRef.current && artRef.current.video) {
          // 清除所有可能存在的等级类名
          artRef.current.video.classList.remove('anime4k-low', 'anime4k-medium', 'anime4k-high');
          
          if (nextLevel === 'low') {
              artRef.current.video.classList.add('anime4k-low');
          }
          
          safeShowNotice(nextLevel === 'low' ? '画质增强' : '关闭');
      }
  };

  const getUpscaleLabel = () => {
      return upscaleLevel === 'low' ? '画质增强' : '画质';
  };

  const handleCast = () => {
      setShowCastModal(true);
      setCastSearching(true);
      // 模拟搜索延迟
      setTimeout(() => setCastSearching(false), 1500);
  };

  const handleAirPlay = () => {
      if (artRef.current && artRef.current.video && artRef.current.video.webkitShowPlaybackTargetPicker) {
          artRef.current.video.webkitShowPlaybackTargetPicker();
      } else {
          safeShowNotice('您的设备不支持原生 AirPlay，请尝试 Web Video Caster');
      }
      setShowCastModal(false);
  };

  const launchWVC = () => {
      if (!currentUrl) return;
      const title = details?.title || '视频';
      const poster = details?.image || '';
      // Web Video Caster URL Scheme
      const wvcUrl = `wvc-x-callback://open?url=${encodeURIComponent(currentUrl)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(poster)}&secure_uri=true`;
      
      // 尝试唤起
      const start = Date.now();
      window.location.href = wvcUrl;
      
      // 检测是否唤起成功 (仅针对 Android/PC，iOS 通常会弹窗提示)
      // 如果 2秒内页面没有隐藏 (即没有跳转到 APP)，则认为唤起失败
      setTimeout(() => {
          // @ts-ignore
          if (document.hidden || document.webkitHidden) return;
          
          // 唤起失败，显示下载提示模态框
          setShowWVCInstallModal(true);
      }, 2000);

      safeShowNotice('正在唤起 Web Video Caster...');
      setShowCastModal(false);
  };

  const handleCopyWVCUrl = async () => {
      const downloadUrl = 'https://chenhua.lanzouu.com/izfyF3ixvlhe';
      try {
          if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(downloadUrl);
          } else {
              const textArea = document.createElement("textarea");
              textArea.value = downloadUrl;
              textArea.style.position = "fixed";
              textArea.style.left = "-9999px";
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              document.execCommand('copy');
              textArea.remove();
          }
          safeShowNotice('已复制链接，请在浏览器里粘贴使用。');
          setShowWVCInstallModal(false);
      } catch (err) {
          console.error('Copy failed', err);
          safeShowNotice('复制失败，请手动复制');
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
    
    // 应用当前画质增强状态
    art.video.classList.remove('anime4k-low', 'anime4k-medium', 'anime4k-high');
    if (upscaleLevel !== 'off') {
        art.video.classList.add(`anime4k-${upscaleLevel}`);
    }

    art.events.proxy(art.template.$container, 'touchstart', (e: TouchEvent) => {
        if (!art.fullscreen && !art.fullscreenWeb) return;
        if (e.touches.length !== 1) return;
        
        const { clientX, clientY } = e.touches[0];
        const { width, height } = art.template.$container.getBoundingClientRect();
        
        const EDGE_MARGIN = 50; 
        if (clientY > height - EDGE_MARGIN) return; 
        if (clientY < EDGE_MARGIN) return;

        swipeRef.current.startX = clientX;
        swipeRef.current.startY = clientY;
        
        if (clientX < width / 2) {
            swipeRef.current.type = 'brightness';
            swipeRef.current.startVal = brightnessRef.current;
        } else {
            swipeRef.current.type = 'volume';
            swipeRef.current.startVal = art.volume;
        }
    });

    art.events.proxy(art.template.$container, 'touchmove', (e: TouchEvent) => {
        if (!swipeRef.current.type) return;
        if (!art.fullscreen && !art.fullscreenWeb) return;
        
        e.preventDefault(); 
        
        const { clientY } = e.touches[0];
        const deltaY = swipeRef.current.startY - clientY;
        const { height } = art.template.$container.getBoundingClientRect();
        
        const percent = deltaY / (height / 2);
        
        let newVal = swipeRef.current.startVal + percent;
        newVal = Math.min(Math.max(newVal, 0), 1);
        
        if (swipeRef.current.type === 'brightness') {
            brightnessRef.current = newVal;
            art.video.style.filter = `brightness(${newVal})`;
            art.notice.show = `亮度: ${Math.round(newVal * 100)}%`;
        } else {
            art.volume = newVal;
            art.notice.show = `音量: ${Math.round(newVal * 100)}%`;
        }
    });

    art.events.proxy(art.template.$container, 'touchend', () => {
        swipeRef.current.type = null;
    });
  };

  const handleControlKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let handled = false;
    switch(e.key) {
        case 'ArrowRight':
            if (index % 5 < 4) {
                controlButtonsRef.current[index + 1]?.focus();
                handled = true;
            } else {
                const activeEp = document.querySelector('.art-ep-item.active') as HTMLElement;
                const firstEp = document.querySelector('.art-ep-item') as HTMLElement;
                if (activeEp || firstEp) {
                    (activeEp || firstEp).focus();
                    handled = true;
                }
            }
            break;
        case 'ArrowLeft':
            if (index % 5 > 0) {
                 controlButtonsRef.current[index - 1]?.focus();
                 handled = true;
            }
            break;
        case 'ArrowDown':
            if (index < 5) {
                controlButtonsRef.current[index + 5]?.focus();
                handled = true;
            } else {
                const shareBtn = shareButtonRef.current;
                if(shareBtn) shareBtn.focus();
                handled = true;
            }
            break;
        case 'ArrowUp':
            if (index >= 5) {
                controlButtonsRef.current[index - 5]?.focus();
                handled = true;
            } else {
                 const backBtn = document.querySelector('header button[title="返回上一页"]') as HTMLElement || 
                                 document.querySelector('header .group') as HTMLElement; 
                 if (backBtn) {
                     backBtn.focus();
                     handled = true;
                 }
            }
            break;
    }

    if (handled) {
        e.preventDefault();
        e.stopPropagation();
    }
  };

  const handleShareKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        controlButtonsRef.current[5]?.focus(); 
    } else if (e.key === 'ArrowRight') {
         e.preventDefault();
         favoriteButtonRef.current?.focus();
    }
  };

  const handleFavoriteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
         e.preventDefault();
         controlButtonsRef.current[6]?.focus(); 
    } else if (e.key === 'ArrowLeft') {
         e.preventDefault();
         shareButtonRef.current?.focus();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const activeEp = document.querySelector('.art-ep-item.active') as HTMLElement;
        const firstEp = document.querySelector('.art-ep-item') as HTMLElement;
        (activeEp || firstEp)?.focus();
    }
  };

  const handleAccButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstSection = document.querySelector('.bg-white .flex.space-x-2 button') as HTMLElement;
        if (firstSection) {
            firstSection.focus();
            return;
        }
        const firstEp = document.querySelector('.bg-white .art-ep-list .art-ep-item') as HTMLElement;
        if (firstEp) firstEp.focus();
    } else if (e.key === 'ArrowLeft') {
         e.preventDefault();
         const backBtn = document.querySelector('header button[title="返回上一页"]') as HTMLElement;
         if (backBtn) backBtn.focus();
    }
  };

  const handleSectionTabKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
          e.preventDefault();
          accButtonRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const firstEp = document.querySelector('.bg-white .art-ep-list .art-ep-item') as HTMLElement;
          if (firstEp) firstEp.focus();
      }
  };

  const handleEpisodeItemKeyDown = (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'ArrowUp') {
          if (index < 5) {
               e.preventDefault();
               if (episodeSections.length > 0) {
                   const activeSection = document.querySelector('.bg-white .flex.space-x-2 button.bg-blue-600') as HTMLElement;
                   const firstSection = document.querySelector('.bg-white .flex.space-x-2 button') as HTMLElement;
                   (activeSection || firstSection)?.focus();
               } else {
                   accButtonRef.current?.focus();
               }
          }
      }
  };

  useEffect(() => {
    if (showSourceSelector && sortedAltSources.length > 0) {
        const active = document.activeElement;
        if (sourceListRef.current && !sourceListRef.current.contains(active)) {
             setTimeout(() => {
                 const firstBtn = sourceListRef.current?.querySelector('button:not([disabled])') as HTMLElement;
                 if (firstBtn) firstBtn.focus();
                 else {
                     const closeBtn = document.querySelector('.fixed .p-4 button') as HTMLElement;
                     if (closeBtn) closeBtn.focus();
                 }
             }, 100);
        }
    }
  }, [showSourceSelector, sortedAltSources]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (!artRef.current) return;
        
        const isFullscreen = artRef.current.fullscreen || artRef.current.fullscreenWeb;
        
        if (e.key === 'Enter') {
             if (isFullscreen) {
                 const isControlsVisible = artRef.current.template.$player.classList.contains('art-hover');
                 
                 if (!isControlsVisible) {
                     e.preventDefault();
                     e.stopPropagation();
                     artRef.current.template.$player.classList.add('art-hover');
                     artRef.current.emit('mousemove');
                     return;
                 }
                 
                 const tagName = document.activeElement?.tagName?.toLowerCase();
                 if (tagName !== 'button' && tagName !== 'input' && tagName !== 'textarea') {
                     e.preventDefault();
                     artRef.current.toggle();
                 }
             }
             return;
        }

        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'button') return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            artRef.current.currentTime = Math.min(artRef.current.currentTime + 10, artRef.current.duration);
            safeShowNotice(`快进: ${Math.floor(artRef.current.currentTime)}s`);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            artRef.current.currentTime = Math.max(artRef.current.currentTime - 10, 0);
            safeShowNotice(`快退: ${Math.floor(artRef.current.currentTime)}s`);
        } else if (e.key === ' ') {
            e.preventDefault();
            artRef.current.toggle();
        }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  useEffect(() => {
    return () => {
        if (artRef.current) {
            artRef.current.destroy(false);
            artRef.current = null;
        }
    };
  }, [movieId]);

  useEffect(() => {
    if (!loading && details) {
        const timer = setTimeout(() => {
             if (document.activeElement && document.activeElement !== document.body) return;
             
             const fullscreenBtn = controlButtonsRef.current[4];
             if (fullscreenBtn) {
                 fullscreenBtn.focus();
             }
        }, 100);
        return () => clearTimeout(timer);
    }
  }, [loading, details]);

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

        if (enableAdBlock && currentUrl.includes('.m3u8')) {
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
            let artReady = await waitForGlobal('Artplayer', 5000);
            let hlsReady = await waitForGlobal('Hls', 5000);
            if (!artReady) { await loadScript("/js/artplayer.js"); artReady = await waitForGlobal('Artplayer', 10000); }
            if (!hlsReady) { await loadScript("/js/hls.min.js"); hlsReady = await waitForGlobal('Hls', 10000); }

            if (!isMounted) return;
            if (!window.Artplayer) throw new Error("Artplayer load failed");

            if (artRef.current) {
                await artRef.current.switchUrl(finalUrl);
                if (episodeLayerRef.current) {
                    episodeLayerRef.current.innerHTML = generateEpisodeLayerHtml(playListRef.current, currentUrl, currentSectionIndex);
                }
                handleVideoReady(artRef.current);
            } else {
                const ArtplayerConstructor = window.Artplayer;
                const art = new ArtplayerConstructor({
                    container: containerRef.current,
                    url: finalUrl,
                    type: 'm3u8',
                    volume: 0.7,
                    poster: details?.image, 
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
                    icons: {
                        loading: `<div class="art-buffering-animation"><div class="ring-glow"></div><div class="ring-outer"></div><div class="ring-inner"></div><div class="icon-center"><i class="material-icons-round" style="font-size: 26px; color: #3b82f6;">smart_display</i></div></div>`,
                    },
                    customType: {
                        m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
                            if (window.Hls && window.Hls.isSupported()) {
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
                    layers: [
                        {
                            name: 'episode-layer',
                            html: generateEpisodeLayerHtml(playListRef.current, currentUrl, currentSectionIndex),
                            class: 'art-ep-layer-box',
                            style: {
                                display: 'none',
                                position: 'absolute',
                                top: '0',
                                right: '0',
                                bottom: '60px', 
                                width: '300px',
                                maxWidth: '80%',
                                backgroundColor: 'rgba(20, 20, 20, 0.95)',
                                backdropFilter: 'blur(10px)',
                                zIndex: 200, 
                                flexDirection: 'column',
                                padding: '20px',
                                overflow: 'hidden',
                                transform: 'translateX(0)',
                                borderLeft: '1px solid rgba(255,255,255,0.1)'
                            },
                            mounted: function($el: HTMLElement) {
                                episodeLayerRef.current = $el;
                                $el.addEventListener('click', (e) => {
                                    const target = e.target as HTMLElement;
                                    const item = target.closest('.art-ep-item');
                                    const tab = target.closest('.art-ep-tab');
                                    if (target === $el) {
                                         $el.style.display = 'none';
                                         return;
                                    }
                                    if (tab) {
                                        const idx = Number((tab as HTMLElement).dataset.index);
                                        if (!isNaN(idx)) setCurrentSectionIndex(idx);
                                        return;
                                    }
                                    if (item) {
                                         const url = (item as HTMLElement).dataset.url;
                                         if (url && url !== currentUrlRef.current) {
                                              historyTimeRef.current = 0;
                                              hasAppliedHistorySeek.current = true;
                                              setCurrentUrl(url);
                                              $el.style.display = 'none';
                                         }
                                    }
                                });
                            }
                        }
                    ],
                    controls: [
                        {
                            name: 'skip-intro',
                            position: 'right',
                            html: getButtonHtml('片头', skipConfigRef.current.intro, skipConfigRef.current.intro > 0, '33, 150, 243'),
                            tooltip: '设置/取消 片头跳过点',
                            click: function () {
                                const art = artRef.current;
                                if (!art) return;
                                const time = art.currentTime;
                                const currentIntro = skipConfigRef.current.intro;
                                const newIntro = currentIntro > 0 ? 0 : time;
                                const config = { ...skipConfigRef.current, intro: newIntro };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                art.controls.update({
                                    name: 'skip-intro',
                                    html: getButtonHtml('片头', newIntro, newIntro > 0, '33, 150, 243')
                                });
                                if (art.notice) art.notice.show = newIntro > 0 ? `片头跳过点已设为: ${Math.floor(newIntro)}s` : `已取消片头跳过`;
                            },
                        },
                        {
                            name: 'skip-outro',
                            position: 'right',
                            html: getButtonHtml('片尾', skipConfigRef.current.outroOffset, skipConfigRef.current.outroOffset > 0, '255, 152, 0'),
                            tooltip: '设置/取消 片尾跳过点',
                            click: function () {
                                const art = artRef.current;
                                if (!art) return;
                                const time = art.currentTime;
                                const duration = art.duration || 0;
                                if (duration <= 0) return;
                                const offset = duration - time;
                                const currentOutro = skipConfigRef.current.outroOffset;
                                const newOutro = currentOutro > 0 ? 0 : offset;
                                const config = { ...skipConfigRef.current, outroOffset: newOutro };
                                skipConfigRef.current = config;
                                setSkipConfig(movieId, config);
                                art.controls.update({
                                    name: 'skip-outro',
                                    html: getButtonHtml('片尾', newOutro, newOutro > 0, '255, 152, 0')
                                });
                                if (art.notice) art.notice.show = newOutro > 0 ? `片尾跳过点已设为距结尾: ${Math.floor(newOutro)}s` : `已取消片尾跳过`;
                            },
                        },
                        {
                            name: 'show-episodes',
                            position: 'right',
                            html: `<div style="display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;padding:4px 8px;border-radius:4px;background:rgba(255,255,255,0.15);color:white;transition:all 0.2s;">选集</div>`,
                            tooltip: '选集列表',
                            click: function () {
                                const art = artRef.current;
                                let layer = episodeLayerRef.current;
                                if (!layer && art && art.template) layer = art.template.$container.querySelector('.art-ep-layer-box');
                                if (layer) layer.style.display = (layer.style.display === 'none' || !layer.style.display) ? 'flex' : 'none';
                            }
                        }
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
                art.on('video:ended', () => handleNextEpisode());
            }
        } catch (e) { 
            console.error(e);
            setCleanStatus('播放器加载失败'); 
        }
    };
    playVideo();
    return () => {
        isMounted = false;
        if (cleanTimeoutId) clearTimeout(cleanTimeoutId);
    };
  }, [currentUrl, movieId, effectiveAccEnabled, enableAdBlock]);

  if (loading) {
      return (
        <div className="flex flex-col justify-center items-center h-[60vh] sm:h-[70vh] animate-fadeIn space-y-2">
            <div className="text-gray-400 text-sm animate-pulse flex items-center space-x-2">
                <Icon name="sync" className="animate-spin text-base" />
                正在加载资源...
            </div>
        </div>
      );
  }
  
  if (!details) return <div className="text-center py-20 text-red-500 font-bold">内容加载失败</div>;

  return (
    <div className="animate-fadeIn w-full flex flex-col">
       {/* 注入多级 SVG 滤镜定义 */}
       <svg width="0" height="0" style={{position: 'absolute', pointerEvents: 'none', opacity: 0}}>
         <defs>
           {/* 弱：平衡去噪 + 适度锐化 */}
           <filter id="anime4k-low" x="-20%" y="-20%" width="140%" height="140%">
             <feGaussianBlur in="SourceGraphic" stdDeviation="0.4" result="denoised"/>
             <feGaussianBlur in="denoised" stdDeviation="1.5" result="unsharp_mask"/>
             <feComposite in="denoised" in2="unsharp_mask" operator="arithmetic" k2="2.0" k3="-1.0" result="sharpened"/>
           </filter>
           
           {/* 中：强力去噪 + 明显锐化 */}
           <filter id="anime4k-medium" x="-20%" y="-20%" width="140%" height="140%">
             <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="denoised"/>
             <feGaussianBlur in="denoised" stdDeviation="2.5" result="unsharp_mask"/>
             <feComposite in="denoised" in2="unsharp_mask" operator="arithmetic" k2="2.8" k3="-1.8" result="sharpened"/>
           </filter>
           
           {/* 强：深度去噪 + 激进锐化 */}
           <filter id="anime4k-high" x="-20%" y="-20%" width="140%" height="140%">
             <feGaussianBlur in="SourceGraphic" stdDeviation="1.0" result="denoised"/>
             <feGaussianBlur in="denoised" stdDeviation="4.0" result="unsharp_mask"/>
             <feComposite in="denoised" in2="unsharp_mask" operator="arithmetic" k2="3.8" k3="-2.8" result="sharpened"/>
           </filter>
         </defs>
       </svg>

       <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 4px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); }
        
        .art-control-volume { display: none !important; }

        /* Anime4K 多级滤镜效果 */
        .anime4k-low {
            filter: url(#anime4k-low) !important;
            transition: filter 0.3s ease;
        }
        .anime4k-medium {
            filter: url(#anime4k-medium) !important;
            transition: filter 0.3s ease;
        }
        .anime4k-high {
            filter: url(#anime4k-high) !important;
            transition: filter 0.3s ease;
        }

        .art-loading-custom, .art-buffering-animation {
            position: relative;
            width: 80px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        /* ... existing styles ... */
        .ring-glow {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(59, 130, 246, 0.2);
            border-radius: 50%;
            filter: blur(12px);
            animation: ring-pulse 2s ease-in-out infinite;
        }
        .ring-outer {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            border: 2px solid transparent;
            border-top-color: rgba(59, 130, 246, 0.3);
            border-bottom-color: rgba(59, 130, 246, 0.3);
            border-radius: 50%;
            animation: art-spin 3s linear infinite;
        }
        .ring-inner {
            position: absolute;
            top: 8px; left: 8px; right: 8px; bottom: 8px;
            border: 2px solid transparent;
            border-left-color: #3b82f6;
            border-radius: 50%;
            animation: art-spin 1s ease-in-out infinite;
        }
        .icon-center {
            position: relative;
            z-index: 10;
            width: 44px;
            height: 44px;
            background-color: rgba(15, 23, 42, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        @keyframes art-spin { to { transform: rotate(360deg); } }
        @keyframes ring-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.1); } }
        
        .art-ep-layer-box { display: flex !important; flex-direction: column; }
        .art-ep-tabs { display: flex; overflow-x: auto; padding-bottom: 6px; margin-bottom: 8px; flex-shrink: 0; white-space: nowrap; scroll-behavior: smooth; }
        .art-ep-tab { cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: rgba(255,255,255,0.1); color: #aaa; transition: all 0.2s; margin-right: 6px; }
        .art-ep-tab.active { background: #2196F3; color: white; }
        .art-ep-list { display: flex; flex-wrap: wrap; overflow-y: auto; flex: 1; min-height: 0; padding-right: 4px; align-content: start; }
        
        .art-ep-item { 
            cursor: pointer; 
            padding: 8px 2px; 
            background: #f1f5f9; 
            color: #334155; 
            border-radius: 6px; 
            text-align: center; 
            font-size: 12px; 
            transition: all 0.2s; 
            width: calc(20% - 5px); 
            margin-bottom: 5px; 
            margin-right: 5px; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            white-space: nowrap;
            border: 1px solid #e2e8f0;
        }
        
        .dark .art-ep-item, .art-ep-layer-box .art-ep-item {
            background: rgba(255,255,255,0.1); 
            color: #e2e8f0; 
            border: 1px solid transparent;
        }

        .art-ep-item.active, .dark .art-ep-item.active { 
            background: #2563eb; 
            color: white; 
            border-color: #2563eb;
        }

        @media (max-width: 640px) { 
            .art-ep-item { 
                width: calc(25% - 5px); 
            } 
        }
        
        @media (max-width: 500px) { 
            .art-ep-layer-box { width: 60% !important; padding: 10px !important; } 
        }
      `}</style>

      {/* 分享弹窗 */}
      {showShareModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowShareModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center space-x-2"><Icon name="share" className="text-blue-500" /><span>分享内容</span></h3>
            <textarea 
                readOnly 
                className="w-full h-32 bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                value={getShareText()}
            />
            <button onClick={copyShareText} className={`w-full flex items-center justify-center space-x-2 py-3 rounded-xl font-bold transition-all ${isCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                <Icon name={isCopied ? "check_circle" : "content_copy"} /><span>{isCopied ? '已复制到剪贴板' : '一键复制'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 投屏模态框 */}
      {showCastModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:px-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCastModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl border-t sm:border border-gray-200 dark:border-gray-700 animate-fadeIn">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                    <Icon name="cast" className="text-blue-500" /><span>选择投屏设备</span>
                </h3>
                <button onClick={() => setShowCastModal(false)} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                    <Icon name="close" className="text-gray-500" />
                </button>
            </div>
            
            <div className="space-y-4 min-h-[200px]">
                {castSearching ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-4">
                        <div className="relative">
                            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                            <Icon name="radar" className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blue-500 text-lg" />
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">正在搜索局域网设备 (DLNA/AirPlay)...</p>
                    </div>
                ) : (
                    <div className="space-y-3 animate-fadeIn">
                        <div className="text-xs text-gray-400 px-1">选择投屏方式</div>
                        
                        {/* Web Video Caster - DLNA/Chromecast 神器 */}
                        <button 
                            onClick={launchWVC}
                            className="w-full flex items-center justify-between p-4 rounded-xl bg-orange-50 dark:bg-orange-900/10 hover:bg-orange-100 dark:hover:bg-orange-900/20 border border-orange-100 dark:border-orange-800/30 transition-all group"
                        >
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                                    <Icon name="rss_feed" />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-gray-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400">Web Video Caster</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">推荐 - 完美支持 DLNA / TV / 盒子</div>
                                </div>
                            </div>
                            <Icon name="chevron_right" className="text-gray-400 group-hover:text-orange-500" />
                        </button>

                        {/* AirPlay - Apple 专用 */}
                        <button 
                            onClick={handleAirPlay}
                            className="w-full flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 transition-all group"
                        >
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300">
                                    <Icon name="airplay" />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">AirPlay 投屏</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">适用于 iPhone / iPad / Mac / Apple TV</div>
                                </div>
                            </div>
                            <Icon name="chevron_right" className="text-gray-400 group-hover:text-blue-500" />
                        </button>
                        
                        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30">
                            <h4 className="text-[10px] font-bold text-blue-700 dark:text-blue-400 mb-1 flex items-center">
                                <Icon name="info" className="text-xs mr-1" /> 投屏指南
                            </h4>
                            <p className="text-[10px] text-blue-600/80 dark:text-blue-400/80 leading-relaxed">
                                1. 投屏前请确保手机和电视连接同一 WiFi。<br/>
                                2. 安卓设备请优先使用 Web Video Caster。<br/>
                                3. 苹果设备请使用 AirPlay 选项。
                            </p>
                        </div>
                    </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* WVC 安装提示模态框 */}
      {showWVCInstallModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWVCInstallModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
            <div className="text-center space-y-4">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto text-orange-600 dark:text-orange-400">
                    <Icon name="priority_high" className="text-2xl" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">未检测到 Web Video Caster</h3>
                <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
                    <p>手机浏览器请使用电脑UA模式下载。</p>
                    <p className="font-mono text-xs bg-gray-100 dark:bg-slate-900 p-2 rounded break-all select-all">
                        https://chenhua.lanzouu.com/izfyF3ixvlhe
                    </p>
                </div>
                <div className="flex space-x-3 pt-2">
                    <button 
                        onClick={() => setShowWVCInstallModal(false)}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                    >
                        取消
                    </button>
                    <button 
                        onClick={handleCopyWVCUrl}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30"
                    >
                        复制链接
                    </button>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* 首屏容器：包含播放器和控制栏，铺满屏幕剩余高度 */}
      <div className="flex flex-col h-[calc(100vh-4rem)] w-full bg-black relative">
          
          {/* 视频容器 (自适应高度) */}
          <div className="flex-1 relative w-full overflow-hidden">
             <div ref={containerRef} className="absolute inset-0 w-full h-full"></div>
             {cleanStatus && <div className="absolute top-4 left-4 z-50 pointer-events-none"><div className="bg-black/70 text-green-400 px-3 py-1.5 rounded-lg text-[10px] backdrop-blur-md flex items-center space-x-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span><span>{cleanStatus}</span></div></div>}
          </div>

          {/* 播放控制栏 (固定在底部) */}
          <div className="flex-shrink-0 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 z-10 relative">
              <div className="max-w-7xl mx-auto px-2 py-2 sm:px-4 sm:py-3 w-full">
                  <div className="grid grid-cols-5 gap-2 sm:gap-3">
                    <ControlButton icon="skip_previous" text="上一集" onClick={handlePrevEpisode} buttonRef={(el) => controlButtonsRef.current[0] = el} onKeyDown={(e) => handleControlKeyDown(e, 0)} />
                    <ControlButton icon="skip_next" text="下一集" onClick={handleNextEpisode} buttonRef={(el) => controlButtonsRef.current[1] = el} onKeyDown={(e) => handleControlKeyDown(e, 1)} />
                    <ControlButton icon="wifi_tethering" text="切源" onClick={handleCheckSources} buttonRef={(el) => controlButtonsRef.current[2] = el} onKeyDown={(e) => handleControlKeyDown(e, 2)} />
                    <ControlButton icon="speed" text="倍速" onClick={handleCycleSpeed} buttonRef={(el) => controlButtonsRef.current[3] = el} onKeyDown={(e) => handleControlKeyDown(e, 3)} />
                    <ControlButton icon="fullscreen" text="全屏" onClick={handleToggleFullscreen} buttonRef={(el) => controlButtonsRef.current[4] = el} onKeyDown={(e) => handleControlKeyDown(e, 4)} />
                    
                    <ControlButton icon="start" text="片头" onClick={handleSetIntro} buttonRef={(el) => controlButtonsRef.current[5] = el} onKeyDown={(e) => handleControlKeyDown(e, 5)} />
                    <ControlButton icon="last_page" text="片尾" onClick={handleSetOutro} buttonRef={(el) => controlButtonsRef.current[6] = el} onKeyDown={(e) => handleControlKeyDown(e, 6)} />
                    
                    {/* 支持三级调节的画质增强按钮 */}
                    <ControlButton 
                        icon="auto_fix_high" 
                        text={getUpscaleLabel()} 
                        onClick={cycleUpscale} 
                        active={upscaleLevel !== 'off'}
                        buttonRef={(el) => controlButtonsRef.current[7] = el} 
                        onKeyDown={(e) => handleControlKeyDown(e, 7)} 
                    />
                    <ControlButton 
                        icon="cast" 
                        text="投屏" 
                        onClick={handleCast} 
                        buttonRef={(el) => controlButtonsRef.current[8] = el} 
                        onKeyDown={(e) => handleControlKeyDown(e, 8)} 
                    />
                    
                    <ControlButton icon="cleaning_services" text="去广告" onClick={toggleAdBlock} active={enableAdBlock} buttonRef={(el) => controlButtonsRef.current[9] = el} onKeyDown={(e) => handleControlKeyDown(e, 9)} />
                  </div>
              </div>
          </div>
      </div>

      {/* 下方滚动内容区域 */}
      <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* 选集列表 (Moved to top) */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 flex flex-col shadow-sm h-[500px] max-h-[80vh]">
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center space-x-2">
                        <Icon name="playlist_play" className="text-blue-500 text-lg" /> <span>选集列表</span>
                    </h3>
                    <button 
                        ref={accButtonRef}
                        onKeyDown={handleAccButtonKeyDown}
                        onClick={toggleTempAcceleration} 
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-black transition-all border outline-none focus:ring-2 focus:ring-blue-400 ${effectiveAccEnabled ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 border-gray-200 dark:border-gray-600'}`}
                    >
                        <Icon name="bolt" className="text-xs" />
                        <span>{effectiveAccEnabled ? '加速已开启' : '点击加速'}</span>
                    </button>
                </div>
                <p className="text-[9px] text-gray-400 mb-4 flex-shrink-0">{playList.length} 个视频内容</p>
                {episodeSections.length > 0 && (
                    <div className="flex space-x-2 overflow-x-auto pb-3 mb-3 hide-scrollbar flex-shrink-0">
                        {episodeSections.map((sec, idx) => (
                            <button 
                                key={idx} 
                                onClick={() => setCurrentSectionIndex(idx)} 
                                onKeyDown={handleSectionTabKeyDown}
                                className={`flex-shrink-0 px-3 py-1 rounded-full text-[10px] font-bold transition-all border outline-none focus:ring-2 focus:ring-blue-400 ${currentSectionIndex === idx ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500'}`}
                            >
                                {sec.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="art-ep-list custom-scrollbar">
                    {playList.slice(episodeSections.length > 0 ? episodeSections[currentSectionIndex].startIdx : 0, episodeSections.length > 0 ? episodeSections[currentSectionIndex].endIdx : playList.length).map((ep, index) => (
                        <button 
                            key={index} 
                            onClick={() => { if (currentUrl === ep.url) return; historyTimeRef.current = 0; hasAppliedHistorySeek.current = true; setCurrentUrl(ep.url); }} 
                            onKeyDown={(e) => handleEpisodeItemKeyDown(e, index)}
                            className={`art-ep-item outline-none focus:ring-2 focus:ring-blue-400 ${currentUrl === ep.url ? 'active' : ''}`}
                        >
                            {ep.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="md:col-span-2 space-y-6">
                 {/* 标题区域 */}
                 <div className="flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0">
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{details.title}</h1>
                        <div className="flex flex-wrap text-xs text-gray-500 dark:text-gray-400 items-center space-x-3">
                            <span className="bg-blue-600 text-white px-2 py-0.5 rounded font-bold">{details.genre}</span>
                            <span>{details.year}</span><span>{details.badge}</span>
                            <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">当前源: {currentSource.name}</span>
                        </div>
                    </div>
                    <div className="flex space-x-2">
                        <button 
                            ref={shareButtonRef}
                            onClick={handleShare} 
                            onKeyDown={handleShareKeyDown}
                            className="flex items-center space-x-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors border border-transparent font-medium focus:ring-2 focus:ring-blue-400 focus:outline-none"
                        >
                            <Icon name="share" className="text-lg" /><span>分享</span>
                        </button>
                        <button 
                            ref={favoriteButtonRef}
                            onClick={handleFavoriteToggle} 
                            onKeyDown={handleFavoriteKeyDown}
                            className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm transition-all border font-bold shadow-sm focus:ring-2 focus:ring-blue-400 focus:outline-none ${isFavorited ? 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 border-pink-200 dark:border-pink-800' : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-transparent hover:bg-gray-200 dark:hover:bg-slate-700'}`}
                        >
                            <Icon name={isFavorited ? "bookmark" : "bookmark_border"} className="text-lg" />
                            <span>{isFavorited ? '已收藏' : '收藏'}</span>
                        </button>
                    </div>
                 </div>
                 
                 {/* 简介卡片 */}
                 <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3 flex items-center space-x-2"><Icon name="description" className="text-blue-500 text-lg" /> <span>剧情简介</span></h3>
                    <div 
                        onClick={() => setIsDescExpanded(!isDescExpanded)}
                        className={`text-xs leading-relaxed text-gray-500 dark:text-gray-400 cursor-pointer transition-all ${isDescExpanded ? '' : 'line-clamp-3'}`}
                    >
                        {details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无详细介绍'}
                    </div>
                    <div className="text-center mt-2">
                        <button onClick={() => setIsDescExpanded(!isDescExpanded)} className="text-blue-500 text-[10px] hover:underline flex items-center justify-center w-full">
                            <Icon name={isDescExpanded ? "expand_less" : "expand_more"} />
                        </button>
                    </div>
                 </div>
            </div>
        </div>
      </div>

      {/* 切源模态框 (懒加载) */}
      {showSourceSelector && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowSourceSelector(false)}>
              <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <h3 className="font-bold text-lg dark:text-white">全网切源 - {details?.title}</h3>
                      <button onClick={() => setShowSourceSelector(false)} className="outline-none focus:ring-2 focus:ring-blue-400 rounded p-1"><Icon name="close" /></button>
                  </div>
                  <div ref={sourceListRef} className="p-4 overflow-y-auto custom-scrollbar flex-1">
                      {!hasStartedSearch ? (
                          <div className="flex flex-col items-center justify-center py-10 space-y-4">
                              <Icon name="search" className="text-4xl text-gray-300" />
                              <p className="text-sm text-gray-500 text-center px-8">正在启动全网搜索...</p>
                          </div>
                      ) : (
                          <div className="space-y-2">
                             {sortedAltSources.map((alt, idx) => (
                                <button key={idx} onClick={() => handleAltSourceClick(alt)} disabled={alt.status === 'searching'} className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left outline-none focus:ring-2 focus:ring-blue-400 ${alt.source.api === currentSource.api ? 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-500' : 'bg-white dark:bg-slate-900 border-gray-100 dark:border-gray-800 hover:border-blue-400'}`}>
                                    <div className="flex items-center space-x-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs ${alt.status === 'success' ? 'bg-green-500' : alt.status === 'searching' ? 'bg-blue-400' : 'bg-gray-300 dark:bg-slate-700'}`}>
                                            {alt.status === 'searching' ? <Icon name="sync" className="animate-spin text-lg" /> : alt.status === 'success' ? 'OK' : '无'}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold dark:text-white">{alt.source.name}</div>
                                            <div className="text-[10px] text-gray-400">
                                                {alt.status === 'searching' && '检索中...'}
                                                {alt.status === 'success' && alt.movie && (alt.movie.badge || '匹配成功')}
                                                {alt.status === 'empty' && '未找到资源'}
                                                {alt.status === 'error' && '连接超时'}
                                            </div>
                                        </div>
                                    </div>
                                    {alt.latency && (
                                        <div className={`text-[10px] font-mono font-bold ${alt.latency < 500 ? 'text-green-500' : alt.latency < 2000 ? 'text-yellow-500' : 'text-red-500'}`}>
                                            {alt.latency}ms
                                        </div>
                                    )}
                                </button>
                             ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Player;
