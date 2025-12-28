import React, { useEffect, useState, useLayoutEffect } from 'react';
import { Movie, Category, HomeProps } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';
import { fetchVideoList } from '../utils/api';
import { getHistory, addToHistory, clearHistory, removeFromHistory } from '../utils/storage';

const Home: React.FC<HomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  onSourceChange,
  onAddCustomSource,
  onRemoveCustomSource,
  savedState,
  onStateUpdate
}) => {
  const [history, setHistory] = useState<Movie[]>([]);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  useEffect(() => {
    if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true,
            error: false,
            scrollY: 0
        });
        loadData(currentSource.api, '', 1);
    } else {
        if (savedState.loading && savedState.movies.length > 0) {
            onStateUpdate({ loading: false });
        }
    }
    setHistory(getHistory());
  }, [currentSource.api]);

  useLayoutEffect(() => {
    if (!savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (savedState.movies.length === 0 && savedState.loading) {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading]);

  const loadData = async (apiUrl: string, typeId: string, pageNum: number) => {
    if (pageNum === 1) onStateUpdate({ loading: true, error: false });
    try {
        const { videos, categories: fetchedCategories } = await fetchVideoList(apiUrl, typeId, pageNum);
        // 为抓取到的视频注入当前源信息，确保存入历史记录时有源头可查
        const enhancedVideos = videos.map(v => ({
            ...v,
            sourceApi: apiUrl,
            sourceName: currentSource.name
        }));

        let newMovies = pageNum === 1 ? enhancedVideos : [...savedState.movies, ...enhancedVideos];
        let newCategories = savedState.categories;
        if (fetchedCategories.length > 0) newCategories = fetchedCategories;

        if (enhancedVideos.length === 0 && pageNum === 1 && fetchedCategories.length === 0) {
             onStateUpdate({ error: true, loading: false });
             trySwitchSource(apiUrl);
        } else {
             onStateUpdate({ 
                 movies: newMovies, 
                 categories: newCategories,
                 loading: false,
                 page: pageNum
             });
        }
    } catch (e) {
        onStateUpdate({ error: true, loading: false });
        trySwitchSource(apiUrl);
    }
  };

  const trySwitchSource = (failedApi: string) => {
      if (sources.length > 1) {
          const currentIndex = sources.findIndex(s => s.api === failedApi);
          if (currentIndex !== -1 && currentIndex < sources.length - 1) {
             const nextSource = sources[currentIndex + 1];
             setTimeout(() => onSourceChange(nextSource), 500);
          }
      }
  };

  const handleRetry = () => loadData(currentSource.api, savedState.activeCategoryId, savedState.page);

  const handleCategoryClick = (id: string) => {
    if (savedState.activeCategoryId === id) return;
    onStateUpdate({ activeCategoryId: id, page: 1, movies: [], loading: true });
    loadData(currentSource.api, id, 1);
  };

  const handleLoadMore = () => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1);

  const handleMovieClick = (movie: Movie) => {
    // 确保电影携带源信息再存入历史
    const movieWithSource = { 
        ...movie, 
        sourceApi: movie.sourceApi || currentSource.api,
        sourceName: movie.sourceName || currentSource.name
    };
    addToHistory(movieWithSource);
    onSelectMovie(movieWithSource);
    setView('PLAYER');
  };

  const handleHistoryClick = (movie: Movie) => {
    // 历史记录中的电影肯定带有 sourceApi (在 handleMovieClick 中确保过)
    onSelectMovie(movie); 
    setView('PLAYER');
  }

  const handleClearHistory = () => {
    if (confirmClear) {
        clearHistory();
        setHistory([]);
        setConfirmClear(false);
    } else {
        setConfirmClear(true);
        setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  const handleRemoveHistoryItem = (e: React.MouseEvent, movieId: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeFromHistory(movieId);
    setHistory(prev => prev.filter(m => m.id !== movieId));
  };

  const handleAddSourceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSourceName && newSourceApi) {
        onAddCustomSource(newSourceName, newSourceApi);
        setNewSourceName('');
        setNewSourceApi('');
        setShowAddSource(false);
        setIsSourceMenuOpen(false); 
    }
  };

  const officialSources = sources.filter(s => !s.isCustom);
  const customSources = sources.filter(s => s.isCustom);

  return (
    <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8 w-full animate-fadeIn">
      {/* Navigation Tags */}
      <nav className="mb-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative z-10">
              <button 
                type="button"
                onClick={() => setIsSourceMenuOpen(!isSourceMenuOpen)}
                className="flex-shrink-0 flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 shadow-sm outline-none cursor-pointer"
              >
                <Icon name="dns" className="text-blue-500 text-lg" />
                <span>来源: {currentSource.name} {currentSource.isCustom ? '(自定义)' : ''}</span>
                <Icon name={isSourceMenuOpen ? "expand_less" : "expand_more"} className="text-gray-400" />
              </button>

              {isSourceMenuOpen && (
                <>
                  <div className="fixed inset-0 z-0" onClick={() => { setIsSourceMenuOpen(false); setShowAddSource(false); }}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 max-h-[80vh] flex flex-col bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
                    <div className="overflow-y-auto flex-grow hide-scrollbar">
                        <div className="px-4 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-slate-700/50 sticky top-0 z-10">官方源</div>
                        {officialSources.map((source, idx) => (
                        <button key={`official-${idx}`} type="button" onClick={() => { onSourceChange(source); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors cursor-pointer border-b border-gray-50 dark:border-gray-700/50 ${currentSource.api === source.api ? 'text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/10' : 'text-gray-700 dark:text-gray-200'}`}>
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSource.api === source.api ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}></span>
                            <span className="truncate">{source.name}</span>
                        </button>
                        ))}
                        <div className="px-4 py-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-slate-700/50 sticky top-0 z-10 border-t border-gray-100 dark:border-gray-700">自定义源</div>
                        {customSources.length > 0 ? customSources.map((source, idx) => (
                            <div key={`custom-${idx}`} className={`w-full flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors ${currentSource.api === source.api ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}>
                                <button type="button" onClick={() => { onSourceChange(source); setIsSourceMenuOpen(false); }} className={`flex-grow text-left text-sm flex items-center gap-2 cursor-pointer ${currentSource.api === source.api ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-200'}`}>
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSource.api === source.api ? 'bg-blue-600' : 'bg-purple-400'}`}></span>
                                    <span className="truncate">{source.name}</span>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); onRemoveCustomSource(source.api); }} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20" title="删除"><Icon name="delete" className="text-base" /></button>
                            </div>
                        )) : (
                            <div className="px-4 py-3 text-sm text-gray-500 text-center italic">暂无自定义源</div>
                        )}
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-gray-700 p-3">
                        {!showAddSource ? (
                            <button onClick={() => setShowAddSource(true)} className="w-full py-2 flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 transition-colors">
                                <Icon name="add_circle_outline" /> 添加自定义源
                            </button>
                        ) : (
                            <form onSubmit={handleAddSourceSubmit} className="space-y-3 animate-fadeIn">
                                <div className="space-y-2">
                                    <input type="text" placeholder="源名称" className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 outline-none" required value={newSourceName} onChange={e => setNewSourceName(e.target.value)} autoFocus />
                                    <input type="url" placeholder="API地址" className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 outline-none" required value={newSourceApi} onChange={e => setNewSourceApi(e.target.value)} />
                                </div>
                                <div className="flex gap-2">
                                    <button type="submit" className="flex-1 py-1.5 text-xs bg-blue-600 text-white rounded">保存</button>
                                    <button type="button" onClick={() => setShowAddSource(false)} className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded">取消</button>
                                </div>
                            </form>
                        )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium hidden sm:block">分类索引</div>
          </div>
          <div className="w-full">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => handleCategoryClick('')} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm cursor-pointer ${savedState.activeCategoryId === '' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300'}`}>全部</button>
              {savedState.categories.map((cat) => (
                <button key={cat.id} type="button" onClick={() => handleCategoryClick(cat.id)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm cursor-pointer ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300'}`}>{cat.name}</button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {history.length > 0 && (
        <section className="mb-10 animate-fadeIn">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Icon name="history" className="text-blue-500" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">最近观看</h2>
            </div>
            <button type="button" onClick={handleClearHistory} className={`text-sm transition-colors flex items-center gap-1 px-3 py-1.5 rounded cursor-pointer ${confirmClear ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 font-bold ring-1 ring-red-500' : 'text-gray-500 dark:text-gray-400 hover:text-red-500'}`}>
              <Icon name={confirmClear ? "warning" : "delete_outline"} className="text-lg" />
              {confirmClear ? '确定清空?' : '清空记录'}
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-6 hide-scrollbar snap-x -mx-4 px-4 sm:mx-0 sm:px-0">
            {history.map((movie) => (
              <div key={`history-${movie.id}`} className="min-w-[140px] w-[140px] sm:min-w-[160px] w-[160px] snap-start relative group">
                 <MovieCard movie={movie} viewType="HOME" onClick={() => handleHistoryClick(movie)} />
                  {movie.currentTime && movie.currentTime > 5 && (
                      <div className="absolute bottom-[70px] left-1 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded backdrop-blur-sm z-20 pointer-events-none">继续观看</div>
                  )}
                  <button type="button" onClick={(e) => handleRemoveHistoryItem(e, movie.id)} className="absolute top-2 right-2 z-30 w-7 h-7 flex items-center justify-center bg-black/60 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all cursor-pointer"><Icon name="close" className="text-sm font-bold" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{savedState.activeCategoryId ? savedState.categories.find(c => c.id === savedState.activeCategoryId)?.name : '最新更新'}</h2>
        </div>
        {savedState.loading && savedState.page === 1 ? (
          <div className="flex justify-center items-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div></div>
        ) : savedState.error && savedState.movies.length === 0 ? (
          <div className="flex flex-col justify-center items-center py-20 text-center">
             <Icon name="cloud_off" className="text-6xl text-gray-300 dark:text-gray-600 mb-4" />
             <p className="text-gray-500 dark:text-gray-400 mb-4">连接当前资源库失败</p>
             <div className="flex gap-4">
                <button onClick={handleRetry} className="px-6 py-2 bg-blue-600 text-white rounded-full">重试</button>
                <button onClick={() => setIsSourceMenuOpen(true)} className="px-6 py-2 bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white rounded-full">切换资源</button>
             </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {savedState.movies.map((movie) => (
              <MovieCard key={`${movie.id}-${movie.title}`} movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
            ))}
          </div>
        )}
      </section>
      {savedState.movies.length > 0 && !savedState.error && (
        <div className="mt-12 flex justify-center pb-8">
          <button type="button" onClick={handleLoadMore} className="flex items-center gap-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 px-8 py-3 rounded-full cursor-pointer disabled:opacity-70" disabled={savedState.loading}>
            {savedState.loading ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-b-0 border-current"></div> : null}
            <span>{savedState.loading ? '加载中...' : '加载更多'}</span>
          </button>
        </div>
      )}
    </main>
  );
};

export default Home;