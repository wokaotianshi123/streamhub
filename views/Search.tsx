
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Movie, SearchProps } from '../types';
import MovieCard from '../components/MovieCard';
import { searchVideos } from '../utils/api';
import { addToHistory } from '../utils/storage';
import { Icon } from '../components/Icon';

const Search: React.FC<SearchProps> = ({ 
    setView, 
    query, 
    onSelectMovie, 
    currentSource, 
    sources, 
    onSourceChange,
    savedState,
    onStateUpdate
}) => {
  const abortControllerRef = useRef<AbortController | null>(null);

  // 恢复滚动位置
  useLayoutEffect(() => {
    if (!savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (savedState.loading) {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading]);

  // 搜索主逻辑
  useEffect(() => {
    if (!query) return;
    
    // Guard: 如果关键词且搜索状态已经完成，则不再触发
    if (query === savedState.query && savedState.hasSearched && !savedState.loading) return;

    const doSearch = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // 开始加载
      onStateUpdate({ loading: true, query: query });

      const targetApis = savedState.isAggregate 
        ? Array.from(savedState.selectedSourceApis)
        : [currentSource.api];

      if (targetApis.length === 0) {
          onStateUpdate({ loading: false, results: [], hasSearched: true });
          return;
      }

      try {
        const searchTasks = sources
            .filter(s => targetApis.includes(s.api))
            .map(async (source) => {
                try {
                    const data = await searchVideos(source.api, query, signal);
                    return (data || []).filter(m => m && m.title).map(m => ({
                        ...m,
                        sourceApi: source.api,
                        sourceName: source.name
                    }));
                } catch (e: any) {
                    if (e.name === 'AbortError') throw e;
                    return [];
                }
            });

        const taskResults = await Promise.allSettled(searchTasks);
        
        if (signal.aborted) return;

        const flatResults: Movie[] = [];
        taskResults.forEach(result => {
            if (result.status === 'fulfilled') {
                flatResults.push(...result.value);
            }
        });

        const resultGroup = new Map<string, Movie>();
        flatResults.forEach(item => {
            const titleKey = (item.title || '').trim().toLowerCase();
            const yearKey = item.year || '';
            const fullKey = `${titleKey}_${yearKey}`;
            
            if (titleKey && !resultGroup.has(fullKey)) {
                resultGroup.set(fullKey, item);
            }
        });
        
        onStateUpdate({ 
            results: Array.from(resultGroup.values()), 
            loading: false, 
            hasSearched: true 
        });
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Search error:", error);
          onStateUpdate({ loading: false, hasSearched: true });
        }
      }
    };

    const timer = setTimeout(doSearch, 300);
    return () => {
        clearTimeout(timer);
        if (abortControllerRef.current) abortControllerRef.current.abort();
    };
    // 稳定性修复：依赖项精简，防止因引用变动导致的无限循环
  }, [query, currentSource.api, savedState.isAggregate, savedState.selectedSourceApis]);

  const handleMovieClick = (movie: Movie) => {
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const targetSource = sources.find(s => s.api === movie.sourceApi);
        if (targetSource) onSourceChange(targetSource);
    }
    addToHistory(movie);
    onSelectMovie(movie);
    setView('PLAYER');
  };

  const toggleSourceSelection = (api: string) => {
    const newSet = new Set(savedState.selectedSourceApis);
    if (newSet.has(api)) {
        if (newSet.size > 1) newSet.delete(api);
    } else {
        newSet.add(api);
    }
    onStateUpdate({ selectedSourceApis: newSet, hasSearched: false, isAggregate: true });
  };

  const selectAllSources = () => {
    onStateUpdate({ 
        selectedSourceApis: new Set(sources.map(s => s.api)), 
        hasSearched: false,
        isAggregate: true
    });
  };

  const unselectAllToCurrent = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    onStateUpdate({ 
        selectedSourceApis: new Set([currentSource.api]), 
        isAggregate: false,
        hasSearched: false,
        results: [],
        loading: false
    });
  };

  const toggleAggregateMode = () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      onStateUpdate({ isAggregate: !savedState.isAggregate, hasSearched: false });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      <section className="space-y-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">搜索结果: "{query}"</h2>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 h-5 flex items-center gap-2">
                    {savedState.loading ? (
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="animate-pulse">全网检索中...</span>
                        </div>
                    ) : `已聚合 ${savedState.isAggregate ? savedState.selectedSourceApis.size : '1'} 个源，找到 ${savedState.results.length} 个结果`}
                </div>
             </div>
             <div className="flex items-center gap-4">
                <button 
                    onClick={toggleAggregateMode}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-full border transition-all text-sm font-bold shadow-sm ${savedState.isAggregate ? 'bg-blue-600 border-blue-600 text-white shadow-blue-500/20' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                    <Icon name={savedState.isAggregate ? "layers" : "layers_clear"} className="text-lg" />
                    聚合搜索: {savedState.isAggregate ? '开启' : '关闭'}
                </button>
             </div>
          </div>

          <div className={`transition-all duration-500 ease-in-out overflow-hidden ${savedState.isAggregate ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
              <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl space-y-4">
                 <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
                    <span className="text-sm font-bold flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <Icon name="settings_input_component" className="text-blue-500" />
                        线路列表 (选中 {savedState.selectedSourceApis.size} 个)
                    </span>
                    <div className="flex gap-4">
                        <button onClick={selectAllSources} className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-bold">选中全部</button>
                        <div className="w-px h-3 bg-gray-200 dark:bg-gray-700 my-auto"></div>
                        <button onClick={unselectAllToCurrent} className="text-xs text-red-500 hover:underline font-bold">重置当前</button>
                    </div>
                 </div>
                 
                 {/* 列表滚动条优化 */}
                 <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar transition-all duration-300">
                    <div className="flex flex-wrap gap-2 pt-2 pb-1">
                        {sources.map(source => {
                            const isSelected = savedState.selectedSourceApis.has(source.api);
                            const isCurrent = currentSource.api === source.api;
                            return (
                                <button
                                    key={source.api}
                                    onClick={() => toggleSourceSelection(source.api)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all border shadow-sm ${
                                        isSelected 
                                        ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 text-blue-600 dark:text-blue-400 font-bold' 
                                        : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                                    }`}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'bg-gray-300 dark:bg-gray-600'}`}></span>
                                    {source.name}
                                    {isCurrent && <span className={`text-[9px] px-1 rounded ml-1 ${isSelected ? 'bg-blue-600 text-white' : 'bg-blue-100 dark:bg-blue-800 text-blue-600'}`}>当前</span>}
                                </button>
                            );
                        })}
                    </div>
                 </div>
              </div>
          </div>
        </div>
      </section>

      <section className="min-h-[60vh]">
         {savedState.loading ? (
             <div className="flex flex-col justify-center items-center py-32 space-y-6">
                <div className="relative">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500/20 border-t-blue-500 shadow-inner"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Icon name="travel_explore" className="text-blue-500 animate-pulse" />
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">采集引擎工作中...</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">正在从 {savedState.isAggregate ? (savedState.selectedSourceApis.size || sources.length) : '1'} 个线路采集数据，请稍后...</p>
                </div>
             </div>
         ) : (
            <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-y-10 gap-x-4 sm:gap-x-6">
                    {savedState.results.map((movie, index) => (
                        <MovieCard key={`${movie.sourceApi}-${movie.id}-${index}`} movie={movie} viewType="SEARCH" onClick={() => handleMovieClick(movie)} />
                    ))}
                </div>
                
                {savedState.results.length === 0 && savedState.hasSearched && (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="w-24 h-24 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 border border-gray-200 dark:border-gray-700">
                            <Icon name="search_off" className="text-5xl text-gray-300" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">未找到相关资源</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">尝试更换关键词，或者在上方开启“聚合搜索”并勾选更多线路。</p>
                        {!savedState.isAggregate && (
                            <button onClick={toggleAggregateMode} className="mt-8 px-8 py-3 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg active:scale-95">开启全网检索</button>
                        )}
                    </div>
                )}
            </>
         )}
      </section>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
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

export default Search;
