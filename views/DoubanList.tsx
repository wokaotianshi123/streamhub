
import React, { useEffect, useState } from 'react';
import { Movie, HomeViewState } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';
import { fetchDoubanRecommend } from '../utils/douban';
import { getCustomDoubanTags, addCustomDoubanTagToStorage, removeCustomDoubanTagFromStorage } from '../utils/storage';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

interface DoubanModuleProps {
  state: HomeViewState;
  onUpdate: (updates: Partial<HomeViewState>) => void;
  onSelectMovie: (movie: Movie) => void;
}

const DoubanModule: React.FC<DoubanModuleProps> = ({
  state,
  onUpdate,
  onSelectMovie
}) => {
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // 1. 初始化或类型变更时，加载自定义标签
  useEffect(() => {
    const tags = getCustomDoubanTags(state.doubanType);
    setCustomTags(tags);
  }, [state.doubanType]);

  // 2. 加载数据的核心逻辑 (从 Home 移动至此)
  const loadData = async (type: 'movie' | 'tv', tag: string, start: number) => {
    // 防止重复请求
    if (state.doubanLoading && start > 0) return;
    
    onUpdate({ doubanLoading: true, doubanError: false });
    
    try {
      const results = await fetchDoubanRecommend(type, tag, start);
      
      onUpdate({ 
        doubanMovies: start === 0 ? results : [...state.doubanMovies, ...results], 
        doubanLoading: false,
        doubanError: false
      });
    } catch (e) {
      onUpdate({ doubanLoading: false, doubanError: true });
    }
  };

  // 3. 初始加载：当列表为空时自动触发
  useEffect(() => {
    if (state.doubanMovies.length === 0 && !state.doubanLoading && !state.doubanError) {
        loadData(state.doubanType, state.doubanTag, 0);
    }
  }, [state.doubanType, state.doubanTag]);

  // 处理事件
  const handleTypeChange = (type: 'movie' | 'tv') => {
    if (state.doubanType !== type) {
        const defaultTag = type === 'movie' ? ORIGINAL_MOVIE_TAGS[0] : ORIGINAL_TV_TAGS[0];
        onUpdate({ 
            doubanType: type, 
            doubanTag: defaultTag, 
            doubanMovies: [] // 清空数据触发 useEffect 重新加载
        });
    }
  };

  const handleTagChange = (tag: string) => {
      if (state.doubanTag !== tag) {
          onUpdate({ 
              doubanTag: tag, 
              doubanMovies: [] 
          });
      }
  };

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
      const updated = addCustomDoubanTagToStorage(state.doubanType, newTagName.trim());
      setCustomTags(updated);
      setNewTagName('');
      setShowAddTag(false);
      // 自动切换到新标签
      handleTagChange(newTagName.trim());
    }
  };

  const handleRemoveTag = (tag: string) => {
    const updated = removeCustomDoubanTagFromStorage(state.doubanType, tag);
    setCustomTags(updated);
    if (state.doubanTag === tag) {
      const defaultTag = state.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS[0] : ORIGINAL_TV_TAGS[0];
      handleTagChange(defaultTag);
    }
  };

  const originalTags = state.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS : ORIGINAL_TV_TAGS;

  return (
    <div className="animate-fadeIn w-full relative">
      {/* 豆瓣专属导航栏 */}
      <nav className="mb-8 overflow-x-auto hide-scrollbar">
        <div className="flex flex-wrap items-center gap-2">
            {/* 类型切换组 */}
            <div className="flex p-1 bg-gray-100 dark:bg-slate-800 rounded-xl mr-2 border border-gray-200 dark:border-gray-700 h-9 flex-shrink-0">
                <button 
                    onClick={() => handleTypeChange('movie')} 
                    className={`px-3 flex items-center justify-center text-xs font-bold rounded-lg transition-all h-full ${state.doubanType === 'movie' ? 'bg-white dark:bg-slate-700 text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    电影
                </button>
                <button 
                    onClick={() => handleTypeChange('tv')} 
                    className={`px-3 flex items-center justify-center text-xs font-bold rounded-lg transition-all h-full ${state.doubanType === 'tv' ? 'bg-white dark:bg-slate-700 text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
                >
                    电视剧
                </button>
            </div>

            {/* 预设标签 */}
            {originalTags.map(tag => (
                <button 
                    key={tag} 
                    onClick={() => handleTagChange(tag)} 
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex-shrink-0 ${state.doubanTag === tag ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 ring-1 ring-pink-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}
                >
                    {tag}
                </button>
            ))}

            {/* 自定义标签 */}
            {customTags.map(tag => (
                <div key={tag} className="group relative flex-shrink-0">
                    <button 
                        onClick={() => handleTagChange(tag)} 
                        className={`pl-4 pr-8 py-1.5 rounded-full text-sm font-medium transition-all border-dashed ${state.doubanTag === tag ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-white dark:bg-slate-800 text-gray-600 border border-gray-300'}`}
                    >
                        {tag}
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleRemoveTag(tag); }} 
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                        <Icon name="close" className="text-[14px]" />
                    </button>
                </div>
            ))}

            {/* 添加标签按钮 */}
            <button 
                onClick={() => setShowAddTag(true)} 
                className="w-8 h-8 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-pink-500 hover:border-pink-500 transition-all flex-shrink-0"
            >
                <Icon name="add" className="text-xl" />
            </button>
        </div>
      </nav>

      {/* 状态展示 */}
      {state.doubanLoading && state.doubanMovies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fadeIn">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
          <p className="text-sm text-gray-400">正在获取豆瓣推荐...</p>
        </div>
      )}

      {state.doubanError && state.doubanMovies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fadeIn">
          <Icon name="error_outline" className="text-5xl text-gray-300 mb-4" />
          <p className="text-gray-500 mb-2">获取豆瓣数据失败</p>
          <button 
            onClick={() => loadData(state.doubanType, state.doubanTag, 0)} 
            className="text-pink-500 hover:underline px-4 py-2 rounded-lg hover:bg-pink-50 dark:hover:bg-pink-900/10 transition-colors"
          >
            点击重试
          </button>
        </div>
      )}

      {/* 列表网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
        {state.doubanMovies.map((movie) => (
          <MovieCard 
            key={`douban-${movie.id}`} 
            movie={movie} 
            viewType="HOME" 
            onClick={() => onSelectMovie(movie)} 
          />
        ))}
      </div>

      {/* 底部加载状态/按钮 */}
      {state.doubanMovies.length > 0 && (
        <div className="mt-16 flex justify-center pb-12">
          {state.doubanError ? (
            <button 
                onClick={() => loadData(state.doubanType, state.doubanTag, state.doubanMovies.length)} 
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors font-bold"
            >
                <Icon name="refresh" /> 加载失败，点击重试
            </button>
          ) : (
            <button 
                onClick={() => loadData(state.doubanType, state.doubanTag, state.doubanMovies.length)} 
                disabled={state.doubanLoading} 
                className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${
                state.doubanLoading 
                    ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed' 
                    : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:border-pink-500 dark:hover:border-pink-500'
                }`}
            >
                {state.doubanLoading ? (
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

      {/* 添加标签弹窗 */}
      {showAddTag && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddTag(false)}></div>
          <form onSubmit={handleAddTagSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="new_label" className="text-pink-500" />添加自定义标签</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">标签名称</label>
                <input autoFocus required type="text" placeholder="例如：宫崎骏" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 transition-all dark:text-white" value={newTagName} onChange={e => setNewTagName(e.target.value)}/>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setShowAddTag(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button>
              <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-pink-600 text-white shadow-lg">确认添加</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default DoubanModule;
