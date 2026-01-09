
import React from 'react';
import { Movie } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

interface DoubanListProps {
  movies: Movie[];
  loading: boolean;
  error: boolean;
  
  // 状态控制 props
  type: 'movie' | 'tv';
  tag: string;
  customTags: string[];
  
  // 事件处理 props
  onTypeChange: (type: 'movie' | 'tv') => void;
  onTagChange: (tag: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onMovieClick: (movie: Movie) => void;
}

const DoubanList: React.FC<DoubanListProps> = ({
  movies,
  loading,
  error,
  type,
  tag: currentTag,
  customTags,
  onTypeChange,
  onTagChange,
  onAddTag,
  onRemoveTag,
  onLoadMore,
  onRetry,
  onMovieClick
}) => {
  const originalTags = type === 'movie' ? ORIGINAL_MOVIE_TAGS : ORIGINAL_TV_TAGS;

  return (
    <div className="animate-fadeIn w-full">
      {/* 豆瓣专属导航栏 */}
      <nav className="mb-8 overflow-x-auto hide-scrollbar">
        <div className="flex flex-wrap items-center gap-2">
            {/* 类型切换组 */}
            <div className="flex p-1 bg-gray-100 dark:bg-slate-800 rounded-xl mr-2 border border-gray-200 dark:border-gray-700 h-9 flex-shrink-0">
                <button 
                    onClick={() => onTypeChange('movie')} 
                    className={`px-3 flex items-center justify-center text-xs font-bold rounded-lg transition-all h-full ${type === 'movie' ? 'bg-white dark:bg-slate-700 text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    电影
                </button>
                <button 
                    onClick={() => onTypeChange('tv')} 
                    className={`px-3 flex items-center justify-center text-xs font-bold rounded-lg transition-all h-full ${type === 'tv' ? 'bg-white dark:bg-slate-700 text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    电视剧
                </button>
            </div>

            {/* 预设标签 */}
            {originalTags.map(tag => (
                <button 
                    key={tag} 
                    onClick={() => onTagChange(tag)} 
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex-shrink-0 ${currentTag === tag ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 ring-1 ring-pink-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}
                >
                    {tag}
                </button>
            ))}

            {/* 自定义标签 */}
            {customTags.map(tag => (
                <div key={tag} className="group relative flex-shrink-0">
                    <button 
                        onClick={() => onTagChange(tag)} 
                        className={`pl-4 pr-8 py-1.5 rounded-full text-sm font-medium transition-all border-dashed ${currentTag === tag ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-white dark:bg-slate-800 text-gray-600 border border-gray-300'}`}
                    >
                        {tag}
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRemoveTag(tag); }} 
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                        <Icon name="close" className="text-[14px]" />
                    </button>
                </div>
            ))}

            {/* 添加标签按钮 */}
            <button 
                onClick={onAddTag} 
                className="w-8 h-8 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-pink-500 hover:border-pink-500 transition-all flex-shrink-0"
            >
                <Icon name="add" className="text-xl" />
            </button>
        </div>
      </nav>

      {/* 独立的加载中状态（无数据时） */}
      {loading && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fadeIn">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
          <p className="text-sm text-gray-400">正在获取豆瓣推荐...</p>
        </div>
      )}

      {/* 独立的错误状态（无数据时） */}
      {error && movies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn">
          <Icon name="error_outline" className="text-5xl text-gray-300 mb-4" />
          <p className="text-gray-500 mb-2">获取豆瓣数据失败</p>
          <button 
            onClick={onRetry} 
            className="text-pink-500 hover:underline px-4 py-2 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/10 transition-colors"
          >
            点击重试
          </button>
        </div>
      )}

      {/* 列表网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
        {movies.map((movie) => (
          <MovieCard 
            key={`douban-${movie.id}`} 
            movie={movie} 
            viewType="HOME" 
            onClick={() => onMovieClick(movie)} 
          />
        ))}
      </div>

      {/* 底部加载状态/按钮 */}
      {movies.length > 0 && (
        <div className="mt-16 flex justify-center pb-12">
          {error ? (
            <button 
                onClick={onRetry} 
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors font-bold"
            >
                <Icon name="refresh" /> 加载失败，点击重试
            </button>
          ) : (
            <button 
                onClick={onLoadMore} 
                disabled={loading} 
                className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${
                loading 
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed' 
                    : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-pink-500 dark:hover:border-pink-500'
                }`}
            >
                {loading ? (
                    <>
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        加载中...
                    </>
                ) : (
                    '加载更多推荐'
                )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DoubanList;
