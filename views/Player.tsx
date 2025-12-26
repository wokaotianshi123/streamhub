import React, { useEffect, useState, useRef } from 'react';
import { ViewState, Movie, PlayerProps } from '../types';
import { Icon } from '../components/Icon';
import { fetchVideoDetails, parsePlayUrl } from '../utils/api';
import { getMovieHistory, updateHistoryProgress } from '../utils/storage';

declare global {
  interface Window {
    Hls: any;
  }
}

const Player: React.FC<PlayerProps> = ({ setView, movieId, currentSource }) => {
  const [details, setDetails] = useState<Movie | null>(null);
  const [playList, setPlayList] = useState<{name: string, url: string}[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [startTime, setStartTime] = useState<number>(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const saveTimeoutRef = useRef<any>(null);

  // Fetch Details and History
  useEffect(() => {
    const loadDetails = async () => {
      if (!currentSource.api) return;
      setLoading(true);
      
      // 1. Get History Progress
      const historyItem = getMovieHistory(movieId);
      if (historyItem && historyItem.currentTime) {
        console.log("Restoring history time:", historyItem.currentTime);
        setStartTime(historyItem.currentTime);
      }

      // 2. Fetch API Details
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

  // Handle saving progress on unmount
  useEffect(() => {
    return () => {
        if (videoRef.current && videoRef.current.currentTime > 5) {
            updateHistoryProgress(movieId, videoRef.current.currentTime);
        }
    };
  }, [movieId]);

  // Init Player
  useEffect(() => {
    if (!currentUrl || !videoRef.current) return;

    const video = videoRef.current;

    // Destroy previous HLS instance if exists
    if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
    }

    const trySeek = () => {
        if (startTime > 0 && Math.abs(video.currentTime - startTime) > 2) {
            video.currentTime = startTime;
        }
    };

    if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls();
        hlsRef.current = hls;
        hls.loadSource(currentUrl);
        hls.attachMedia(video);
        
        hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
            if (startTime > 0) video.currentTime = startTime;
            video.play().catch(e => console.log("Auto-play prevented"));
        });

        // Backup seek for HLS
        hls.on(window.Hls.Events.LEVEL_LOADED, function() {
            if (startTime > 0) trySeek();
        });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        video.src = currentUrl;
        video.addEventListener('loadedmetadata', function() {
            if (startTime > 0) video.currentTime = startTime;
            video.play().catch(e => console.log("Auto-play prevented"));
        });
    } else {
        // Normal MP4
        video.src = currentUrl;
        video.addEventListener('loadedmetadata', function() {
            if (startTime > 0) video.currentTime = startTime;
            video.play().catch(e => console.log("Auto-play prevented"));
        });
    }

    return () => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
        }
    };
  }, [currentUrl]); // Dependency on currentUrl to reload when switching episodes. removed startTime to avoid seek loops.

  // Handle Time Update
  const handleTimeUpdate = () => {
    if (videoRef.current) {
        const time = videoRef.current.currentTime;
        if (time > 1) { 
            // Throttle saving
            if (!saveTimeoutRef.current) {
                saveTimeoutRef.current = setTimeout(() => {
                    updateHistoryProgress(movieId, time);
                    saveTimeoutRef.current = null;
                }, 5000); // Save every 5 seconds
            }
        }
    }
  };

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
      <section className="rounded-2xl overflow-hidden shadow-xl bg-black relative group aspect-video sm:aspect-[16/9] lg:aspect-[21/9]">
         {currentUrl ? (
             <>
                <video 
                    ref={videoRef}
                    controls 
                    className="w-full h-full object-contain"
                    poster={details.image}
                    onTimeUpdate={handleTimeUpdate}
                    playsInline
                />
                {startTime > 0 && (
                    <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-xs backdrop-blur-sm animate-fadeOut pointer-events-none transition-opacity duration-1000 opacity-0 delay-3000">
                        已恢复至上次观看位置
                    </div>
                )}
             </>
         ) : (
             <div className="w-full h-full flex items-center justify-center text-white bg-gray-900">
                 <p>暂无播放资源</p>
             </div>
         )}
      </section>

      {/* Info Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-4">
             <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{details.title}</h1>
             <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded">{details.genre}</span>
                <span>{details.year}</span>
                <span>{details.badge}</span>
             </div>
             
             {/* Content */}
             <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                <p>{details.vod_content ? details.vod_content.replace(/<[^>]*>?/gm, '') : '暂无简介'}</p>
             </div>

             <div className="text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                <p className="mb-1"><span className="font-semibold text-gray-700 dark:text-gray-300">导演:</span> {details.vod_director}</p>
                <p><span className="font-semibold text-gray-700 dark:text-gray-300">主演:</span> {details.vod_actor}</p>
             </div>
        </div>

        {/* Playlist Section */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 h-fit max-h-[500px] overflow-y-auto shadow-sm">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                <Icon name="playlist_play" />
                选集 ({playList.length})
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {playList.map((ep, index) => (
                    <button 
                        key={index}
                        onClick={() => {
                            setCurrentUrl(ep.url);
                            setStartTime(0); // Reset start time when changing episode manually
                        }}
                        className={`text-xs py-2 px-1 rounded transition-colors truncate ${currentUrl === ep.url ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200'}`}
                        title={ep.name}
                    >
                        {ep.name}
                    </button>
                ))}
                {playList.length === 0 && (
                    <p className="col-span-full text-xs text-gray-500">无播放源</p>
                )}
            </div>
        </div>
      </section>
    </main>
  );
};

export default Player;