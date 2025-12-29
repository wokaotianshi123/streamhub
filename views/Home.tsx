
import React, { useEffect, useState, useLayoutEffect } from 'react';
import { Movie, Category, HomeProps, Source } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';
import { fetchVideoList, fetchDoubanSubjects } from '../utils/api';
import { 
  getHistory, 
  addToHistory, 
  clearHistory, 
  removeFromHistory,
  getCustomDoubanTags,
  addCustomDoubanTagToStorage,
  removeCustomDoubanTagFromStorage
} from '../utils/storage';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

const Home: React.FC<HomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  onSourceChange,
  onAddCustomSource,
  onRemoveCustomSource,
  onSearch,
  savedState,
  onStateUpdate
}) => {
  const [history, setHistory] = useState<Movie[]>([]);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  
  // 自定义源添加表单状态
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  // 豆瓣自定义标签状态
  const [customDoubanTags, setCustomDoubanTags] = useState<string[]>([]);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // 核心加载逻辑
  useEffect(() => {
    if (savedState.isDoubanMode) {
      // 加载该类型下的自定义标签
      const tags = getCustomDoubanTags(savedState.doubanType);
      setCustomDoubanTags(tags);

      if (savedState.doubanMovies.length === 0) {
        loadDoubanData(savedState.doubanType, savedState.doubanTag, 0);
      }
    } else {
      if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true,
            error: false
        });
        loadData(currentSource.api, '', 1);
      }
    }
    setHistory(getHistory());
  }, [currentSource.api, savedState.isDoubanMode, savedState.doubanType, savedState.doubanTag]);

  // 切换电影/电视剧时刷新自定义标签
  useEffect(() => {
    if (savedState.isDoubanMode) {
      setCustomDoubanTags(getCustomDoubanTags(savedState.doubanType));
    }
  }, [savedState.doubanType]);

  // 滚动位置恢复
  useLayoutEffect(() => {
    if (!savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (savedState.loading) {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading]);

  // --- 采集源加载 ---
  const loadData = async (apiUrl: string, typeId: string, pageNum: number) => {
    if (pageNum === 1) onStateUpdate({ loading: true, error: false });
    try {
        const { videos, categories: fetchedCategories } = await fetchVideoList(apiUrl, typeId, pageNum);
        const enhancedVideos = videos.map(v => ({
            ...v,
            sourceApi: apiUrl,
            sourceName: currentSource.name
        }));

        const newMovies = pageNum === 1 ? enhancedVideos : [...savedState.movies, ...enhancedVideos];
        const newCategories = fetchedCategories.length > 0 ? fetchedCategories : savedState.categories;

        onStateUpdate({ 
            movies: newMovies, 
            categories: newCategories,
            loading: false,
            page: pageNum,
            sourceApi: apiUrl
        });
    } catch (e) {
        onStateUpdate({ error: true, loading: false });
    }
  };

  // --- 豆瓣加载 ---
  const loadDoubanData = async (type: 'movie' | 'tv', tag: string, start: number) => {
    onStateUpdate({ loading: true });
    try {
      const results = await fetchDoubanSubjects(type, tag, start);
      onStateUpdate({ 
        doubanMovies: start === 0 ? results : [...savedState.doubanMovies, ...results], 
        loading: false 
      });
    } catch (e) {
      console.error("豆瓣数据加载失败", e);
      onStateUpdate({ loading: false, error: true });
    }
  };

  const handleDoubanLoadMore = () => {
    const nextStart = savedState.doubanMovies.length;
    loadDoubanData(savedState.doubanType, savedState.doubanTag, nextStart);
  };

  const handleMovieClick = (movie: Movie) => {
    if (movie.isDouban) {
      onSearch(movie.title, true);
    } else {
      addToHistory(movie);
      onSelectMovie(movie);
      setView('PLAYER');
    }
  };

  const toggleMode = (douban: boolean) => {
    if (savedState.isDoubanMode === douban) return;
    onStateUpdate({ isDoubanMode: douban, scrollY: 0 });
  };

  const handleAddSourceSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newSourceName.trim() && newSourceApi.trim()) {
          onAddCustomSource(newSourceName.trim(), newSourceApi.trim());
          setNewSourceName('');
          setNewSourceApi('');
          setShowAddSource(false);
      }
  };

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
      const updated = addCustomDoubanTagToStorage(savedState.doubanType, newTagName.trim());
      setCustomDoubanTags(updated);
      onStateUpdate({ doubanTag: newTagName.trim(), doubanMovies: [] });
      setNewTagName('');
      setShowAddTag(false);
    }
  };

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    const updated = removeCustomDoubanTagFromStorage(savedState.doubanType, tag);
    setCustomDoubanTags(updated);
    if (savedState.doubanTag === tag) {
      onStateUpdate({ doubanTag: '热门', doubanMovies: [] });
    }
  };

  const originalTags = savedState.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS : ORIGINAL_TV_TAGS;
  const officialSources = sources.filter(s => !s.isCustom);
  const customSources = sources.filter(s => s.isCustom);

  return (
    <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full animate-fadeIn">
      
      {/* 顶部主切换栏 */}
      <section className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
             <div className="flex bg-gray-100 dark:bg-slate-900/50 p-1 rounded-xl w-full sm:w-auto">
                <button 
                    onClick={() => toggleMode(false)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${!savedState.isDoubanMode ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="dns" className="text-lg" />
                    资源源站
                </button>
                <button 
                    onClick={() => toggleMode(true)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${savedState.isDoubanMode ? 'bg-pink-600 text-white shadow-lg shadow-pink-500/30' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="auto_awesome" className="text-lg" />
                    豆瓣推荐
                </button>
             </div>

             {!savedState.isDoubanMode ? (
                <div className="relative w-full sm:w-auto">
                   <button 
                      onClick={() => setIsSourceMenuOpen(!isSourceMenuOpen)}
                      className="w-full flex items-center justify-between gap-3 bg-gray-50 dark:bg-slate-900 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-all cursor-pointer"
                   >
                      <div className="flex items-center gap-2">
                        <Icon name="settings_input_component" className="text-blue-500" />
                        <span className="truncate max-w-[120px]">{currentSource.name}</span>
                      </div>
                      <Icon name="expand_more" className={`transition-transform ${isSourceMenuOpen ? 'rotate-180' : ''}`} />
                   </button>

                   {isSourceMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsSourceMenuOpen(false)}></div>
                        <div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden flex flex-col">
                            <div className="max-h-80 overflow-y-auto hide-scrollbar">
                                <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-slate-900/50">推荐源</div>
                                {officialSources.map((s, idx) => (
                                    <button key={`off-${idx}`} onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors border-b border-gray-50 dark:border-gray-700/50 flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-700 dark:text-gray-200'}`}>
                                        <span className="truncate">{s.name}</span>
                                        {currentSource.api === s.api && <Icon name="check" className="text-xs" />}
                                    </button>
                                ))}
                                
                                {customSources.length > 0 && (
                                    <>
                                        <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-gray-700">自定义源</div>
                                        {customSources.map((s, idx) => (
                                            <div key={`cus-${idx}`} className="group flex items-center border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-slate-700">
                                                <button onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`flex-grow text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-700 dark:text-gray-200'}`}>
                                                    <span className="truncate">{s.name}</span>
                                                </button>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onRemoveCustomSource(s.api); }}
                                                    className="px-3 py-3 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <Icon name="delete_outline" className="text-sm" />
                                                </button>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                            
                            <button 
                                onClick={() => { setShowAddSource(true); setIsSourceMenuOpen(false); }}
                                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-t border-gray-100 dark:border-gray-700"
                            >
                                <Icon name="add_circle_outline" />
                                添加自定义源
                            </button>
                        </div>
                      </>
                   )}
                </div>
             ) : (
                <div className="flex gap-2 w-full sm:w-auto">
                   <button 
                      onClick={() => onStateUpdate({ doubanType: 'movie', doubanMovies: [], doubanTag: '热门' })}
                      className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all border ${savedState.doubanType === 'movie' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent' : 'bg-transparent text-gray-500 border-gray-200 dark:border-gray-700'}`}
                   >电影</button>
                   <button 
                      onClick={() => onStateUpdate({ doubanType: 'tv', doubanMovies: [], doubanTag: '热门' })}
                      className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all border ${savedState.doubanType === 'tv' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent' : 'bg-transparent text-gray-500 border-gray-200 dark:border-gray-700'}`}
                   >电视剧</button>
                </div>
             )}
          </div>
      </section>

      {/* 导航与筛选 */}
      <nav className="mb-8">
          {!savedState.isDoubanMode ? (
            <div className="flex flex-wrap gap-2">
                <button onClick={() => { onStateUpdate({ activeCategoryId: '', movies: [] }); loadData(currentSource.api, '', 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === '' ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>全部</button>
                {savedState.categories.map(cat => (
                    <button key={cat.id} onClick={() => { onStateUpdate({ activeCategoryId: cat.id, movies: [] }); loadData(currentSource.api, cat.id, 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{cat.name}</button>
                ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
                {/* 原始标签 */}
                {originalTags.map(tag => (
                    <button key={tag} onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.doubanTag === tag ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 ring-1 ring-pink-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{tag}</button>
                ))}
                
                {/* 自定义标签 */}
                {customDoubanTags.map(tag => (
                    <div key={tag} className="group relative">
                        <button 
                            onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} 
                            className={`pl-4 pr-8 py-1.5 rounded-full text-sm font-medium transition-all border-dashed ${savedState.doubanTag === tag ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600'}`}
                        >
                            {tag}
                        </button>
                        <button 
                            onClick={(e) => handleRemoveTag(e, tag)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
                        >
                            <Icon name="close" className="text-[14px]" />
                        </button>
                    </div>
                ))}

                {/* 添加标签按钮 */}
                <button 
                  onClick={() => setShowAddTag(true)}
                  className="w-8 h-8 rounded-full border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 hover:text-pink-500 hover:border-pink-500 transition-all"
                  title="添加自定义标签"
                >
                    <Icon name="add" className="text-xl" />
                </button>
            </div>
          )}
      </nav>

      {/* 历史记录 */}
      {history.length > 0 && !savedState.isDoubanMode && savedState.activeCategoryId === '' && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="history" className="text-blue-500" /> 播放历史</h2>
            <button onClick={() => { if(confirmClear){ clearHistory(); setHistory([]); setConfirmClear(false); } else { setConfirmClear(true); setTimeout(()=>setConfirmClear(false), 3000); } }} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
                <Icon name={confirmClear ? "warning" : "delete_outline"} className="text-sm" />
                {confirmClear ? "确认清除" : "清空"}
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
            {history.slice(0, 10).map(m => (
                <div key={m.id} className="min-w-[140px] max-w-[140px] relative group">
                    <MovieCard movie={m} viewType="HOME" onClick={() => { onSelectMovie(m); setView('PLAYER'); }} />
                    <button onClick={(e) => { e.stopPropagation(); removeFromHistory(m.id); setHistory(getHistory()); }} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="close" className="text-xs"/></button>
                </div>
            ))}
          </div>
        </section>
      )}

      {/* 内容展示区 */}
      <section className="min-h-[60vh]">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <span className={`w-1.5 h-6 rounded-full ${savedState.isDoubanMode ? 'bg-pink-500' : 'bg-blue-600'}`}></span>
                {savedState.isDoubanMode ? `豆瓣: ${savedState.doubanTag}` : (savedState.activeCategoryId ? savedState.categories.find(c => c.id === savedState.activeCategoryId)?.name : '最新更新')}
            </h2>
        </div>

        {savedState.loading && (savedState.isDoubanMode ? savedState.doubanMovies.length === 0 : savedState.movies.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
                <div className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${savedState.isDoubanMode ? 'border-pink-500' : 'border-blue-500'}`}></div>
                <p className="text-sm text-gray-400 animate-pulse">资源同步中...</p>
            </div>
        ) : (
            <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                    {(savedState.isDoubanMode ? savedState.doubanMovies : savedState.movies).map((movie, idx) => (
                        <MovieCard 
                            key={`${movie.id}-${idx}`} 
                            movie={movie} 
                            viewType="HOME" 
                            onClick={() => handleMovieClick(movie)} 
                        />
                    ))}
                </div>

                {(savedState.isDoubanMode ? savedState.doubanMovies : savedState.movies).length === 0 && !savedState.loading && (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400 italic">
                        <Icon name="sentiment_dissatisfied" className="text-4xl mb-2" />
                        <p>未找到相关资源</p>
                    </div>
                )}
                
                <div className="mt-16 flex justify-center pb-12">
                    <button 
                        onClick={savedState.isDoubanMode ? handleDoubanLoadMore : () => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1)} 
                        disabled={savedState.loading}
                        className={`group flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${savedState.loading ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 hover:scale-105 active:scale-95'}`}
                    >
                        {savedState.loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>}
                        <span>{savedState.loading ? '正在同步' : '加载更多内容'}</span>
                    </button>
                </div>
            </>
        )}
      </section>

      {/* 添加源模态框 */}
      {showAddSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddSource(false)}></div>
            <form onSubmit={handleAddSourceSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                    <Icon name="add_circle" className="text-blue-500" />
                    添加自定义采集源
                </h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">源站名称</label>
                        <input 
                            autoFocus
                            required
                            type="text" 
                            placeholder="例如：量子资源"
                            className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white"
                            value={newSourceName}
                            onChange={e => setNewSourceName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">API 地址 (Cms 接口)</label>
                        <input 
                            required
                            type="url" 
                            placeholder="https://.../api.php/provide/vod/"
                            className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white"
                            value={newSourceApi}
                            onChange={e => setNewSourceApi(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex gap-3 mt-8">
                    <button type="button" onClick={() => setShowAddSource(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">取消</button>
                    <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-colors">确认添加</button>
                </div>
            </form>
        </div>
      )}

      {/* 添加豆瓣标签模态框 */}
      {showAddTag && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddTag(false)}></div>
            <form onSubmit={handleAddTagSubmit} className="relative bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-xs shadow-2xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">添加自定义标签</h3>
                <input 
                    autoFocus
                    required
                    type="text" 
                    placeholder="输入标签名，如: 漫威"
                    className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-pink-500 transition-all dark:text-white mb-4"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                />
                <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAddTag(false)} className="flex-1 px-4 py-2 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">取消</button>
                    <button type="submit" className="flex-1 px-4 py-2 rounded-lg text-xs font-bold bg-pink-600 text-white hover:bg-pink-700 transition-colors">确认</button>
                </div>
            </form>
        </div>
      )}
    </main>
  );
};

export default Home;
