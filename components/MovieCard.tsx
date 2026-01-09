
import React, { useState, useEffect } from 'react';
import { Movie, ViewState } from '../types';
import { Icon } from './Icon';

interface MovieCardProps {
  movie: Movie;
  viewType: ViewState;
  onClick: () => void;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, viewType, onClick }) => {
  const isPlayerView = viewType === 'PLAYER';
  const showPlayButton = viewType === 'SEARCH' || isPlayerView;
  
  // 图片加载状态管理
  const [imgSrc, setImgSrc] = useState<string>(movie.image);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setImgSrc(movie.image);
    setHasError(false);
  }, [movie.image]);

  const handleImageError = () => {
    if (!hasError) {
        // 图片加载失败，不使用代理，直接显示占位图
        setImgSrc(`https://images.placeholders.dev/?width=300&height=450&text=${encodeURIComponent(movie.title || '暂无封面')}&fontSize=20&bgColor=%231e293b&textColor=%23ffffff`);
        setHasError(true);
    }
  };

  return (
    <div className="group cursor-pointer flex flex-col" onClick={onClick}>
      {/* 封面图容器 */}
      <div className={`relative overflow-hidden rounded-xl shadow-sm transition-all duration-300 ease-out bg-gray-200 dark:bg-slate-800 aspect-[2/3] ring-1 ring-black/5 dark:ring-white/5 ${viewType !== 'HOME' ? 'hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-1' : 'hover:ring-blue-500'}`}>
        <img 
          src={imgSrc || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'} 
          alt={movie.title} 
          className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
          loading="lazy"
          // 关键：不发送 Referer，这对于部分允许空 Referer 的豆瓣节点有效
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
        
        {/* 覆盖层交互 */}
        <div className={`absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center`}>
           {showPlayButton ? (
             <div className="rounded-full bg-blue-600 text-white w-12 h-12 flex items-center justify-center transform scale-0 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                <Icon name="play_arrow" className="text-3xl ml-1" />
             </div>
           ) : (
             movie.isDouban && (
               <div className="bg-pink-600/90 text-white px-4 py-2 rounded-full text-xs font-bold transform translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all shadow-lg">
                  立即检索
               </div>
             )
           )}
        </div>

        {/* 顶部标签：源名称 */}
        {movie.sourceName && !movie.isDouban && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md backdrop-blur-md text-[10px] shadow-sm bg-blue-600/80 text-white z-10 font-bold border border-white/10">
            {movie.sourceName}
          </div>
        )}

        {/* 顶部标签：备注/状态 */}
        {movie.badge && (
          <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-md backdrop-blur-md text-[10px] shadow-sm ${movie.badgeColor === 'primary' ? 'bg-amber-500 text-white' : 'bg-black/60 text-white'} z-10 font-bold border border-white/10`}>
            {movie.badge}
          </div>
        )}

        {/* 底部浮层：豆瓣评分 */}
        {movie.rating && movie.rating > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center pointer-events-none">
             <div className="bg-black/70 backdrop-blur-sm text-yellow-400 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1 border border-white/5">
                <Icon name="star" className="text-[12px]" />
                {movie.rating.toFixed(1)}
             </div>
          </div>
        )}
      </div>

      {/* 底部信息栏 */}
      <div className="mt-3 px-1">
        <h3 className={`text-sm font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-blue-500 transition-colors ${isPlayerView ? 'text-base' : ''}`} title={movie.title}>
          {movie.title}
        </h3>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5 truncate">
             {movie.year && <span>{movie.year}</span>}
             {movie.year && movie.genre && <span className="w-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-full"></span>}
             <span className="truncate">{movie.genre || '影视'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MovieCard;
