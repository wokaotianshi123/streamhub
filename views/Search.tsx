
import React, { useEffect, useLayoutEffect } from 'react';
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
  // 初始化默认选择：仅选中当前正在使用的源
  useEffect(() => {
    if (sources.length > 0 && savedState.selectedSourceApis.size === 0) {
        onStateUpdate({ selectedSourceApis: new Set([currentSource.api]) });
    }
  }, [sources, currentSource.api]);

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
    // 如果查询词没变且已经搜索过，不再重复请求（除非手动触发了 hasSearched: false）
    if (query === savedState.query && savedState.hasSearched) return;

    const doSearch = async () => {
      onStateUpdate({ loading: true, results: [], query: query });

      const targetApis = savedState.isAggregate 
        ? Array.from(savedState.selectedSourceApis)
        : [currentSource.api];

      if (targetApis.length === 0) {
          onStateUpdate({ loading: false, results: [], hasSearched: true });
          return;
      }

      const searchPromises = sources
          .filter(s => targetApis.includes(s.api))
          .map(async (source) => {
              try {
                  const data = await searchVideos(source.api, query);
                  return data.map(m => ({
                      ...m,
                      sourceApi: source.api,
                      sourceName: source.name
                  }));
              } catch (e) {
                  console.warn(`Search failed for ${source.name}`, e);
                  return [];
              }
          });

      const allResults = await Promise.all(searchPromises);
      // 聚合结果并去重
      const flatResults = allResults.flat();
      const uniqueResults = Array.from(new Map(flatResults.map(item => [`${item.title}-${item.year}`, item])).values());

      onStateUpdate({ 
          results: uniqueResults, 
          loading: false, 
          hasSearched: true 
      });
    };

    const timer = setTimeout(doSearch, 300);
    return () => clearTimeout(timer);
  }, [query, currentSource.api, savedState.isAggregate, savedState.selectedSourceApis, sources, savedState.hasSearched, savedState.query]);

  const handleMovieClick = (movie: Movie) => {
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const targetSource = sources.find(s => s.api === movie.sourceApi);
        if (targetSource) {
            onSourceChange(targetSource);
        }
    }
    
    addToHistory(movie);
    onSelectMovie(movie);
    setView('PLAYER');
  };

  const toggleSourceSelection = (api: string) => {
    const newSet = new Set(savedState.selectedSourceApis);
    if (newSet.has(api)) {
        // 如果已选中，点击则移除（除非是最后一个）
        if (newSet.size > 1) {
            newSet.delete(api);
        } else {
            // 如果是最后一个且点击了它，我们不做操作，或者根据用户习惯重置到当前源
        }
    } else {
        // 如果未选中，点击则添加
        newSet.add(api);
    }
    onStateUpdate({ selectedSourceApis: newSet, hasSearched: false });
    
    // 点击任何源标签时，如果聚合模式没开，自动帮用户开启，提升体验
    if (!savedState.isAggregate) {
        onStateUpdate({ isAggregate: true });
    }
  };

  const selectAllSources = () => {
    onStateUpdate({ 
        selectedSourceApis: new Set(sources.map(s => s.api)), 
        hasSearched: false,
        isAggregate: true
    });
  };

  const unselectAllToCurrent = () => {
    // “取消全选”：恢复到只选当前源
    onStateUpdate({ 
        selectedSourceApis: new Set([currentSource.api]), 
        hasSearched: false 
    });
  };

  const toggleAggregateMode = () => {
      onStateUpdate({ isAggregate: !savedState.isAggregate, hasSearched: false });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      <section className="space-y-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">搜索结果: "{query}"</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {savedState.loading ? '正在检索中...' : `在 ${savedState.isAggregate ? savedState.selectedSourceApis.size : '1'} 个源中找到 ${savedState.results.length} 个结果`}
                </p>
             </div>
             
             <div className="flex items-center gap-4">
                <button 
                    onClick={toggleAggregateMode}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-sm font-medium ${savedState.isAggregate ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                    <Icon name={savedState.isAggregate ? "layers" : "layers_clear"} className="text-lg" />
                    聚合搜索: {savedState.isAggregate ? '开启' : '关闭'}
                </button>
             </div>
          </div>

          {/* 聚合搜索源控制面板 */}
          <div className={`transition-all duration-300 overflow-hidden ${savedState.isAggregate ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
              <div className="bg-white dark:bg-slate-800/80 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
                 <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
                    <span className="text-sm font-bold flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <Icon name="settings_input_component" className="text-blue-500" />
                        搜索源目录
                    </span>
                    <div className="flex gap-4">
                        <button onClick={selectAllSources} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-bold px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">全选</button>
                        <button onClick={unselectAllToCurrent} className="text-xs text-red-500 hover:text-red-700 font-bold px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">取消全选</button>
                    </div>
                 </div>
                 <div className="flex flex-wrap gap-2 pt-2">
                    {sources.map(source => {
                        const isSelected = savedState.selectedSourceApis.has(source.api);
                        const isCurrent = currentSource.api === source.api;
                        return (
                            <button
                                key={source.api}
                                onClick={() => toggleSourceSelection(source.api)}
                                className={`group flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all border ${
                                    isSelected 
                                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400 font-bold shadow-sm' 
                                    : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-400 dark:hover:border-gray-500'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'bg-gray-300 dark:bg-gray-600'}`}></span>
                                {source.name}
                                {isCurrent && <span className="text-[9px] bg-blue-100 dark:bg-blue-800 px-1 rounded ml-1 text-blue-600 dark:text-blue-400">当前</span>}
                            </button>
                        );
                    })}
                 </div>
                 <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-2 italic">提示：点击源标签可快速将其添加/移出搜索列表</p>
              </div>
          </div>
        </div>
      </section>

      {/* 结果网格 */}
      <section className="min-h-[60vh]">
         {savedState.loading ? (
             <div className="flex flex-col justify-center items-center py-32 space-y-6">
                <div className="relative">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500/20 border-t-blue-500"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Icon name="search" className="text-blue-500 animate-pulse" />
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <p className="text-lg font-medium text-gray-900 dark:text-white">资源聚合中</p>
                    {savedState.isAggregate && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">正在并发检索 {savedState.selectedSourceApis.size} 个线路...</p>
                    )}
                </div>
             </div>
         ) : (
            <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-y-10 gap-x-4 sm:gap-x-6">
                    {savedState.results.map((movie, index) => (
                    <MovieCard 
                        key={`${movie.sourceApi}-${movie.id}-${index}`} 
                        movie={movie} 
                        viewType="SEARCH" 
                        onClick={() => handleMovieClick(movie)} 
                    />
                    ))}
                </div>
                
                {savedState.results.length === 0 && savedState.hasSearched && (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="w-20 h-20 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
                            <Icon name="search_off" className="text-4xl text-gray-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">暂无搜索结果</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-md">当前选择的源中未找到资源，请尝试在上方开启更多搜索源。</p>
                        {!savedState.isAggregate && (
                            <button 
                                onClick={toggleAggregateMode}
                                className="mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-full font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
                            >
                                立即开启聚合搜索
                            </button>
                        )}
                    </div>
                )}
            </>
         )}
      </section>
    </main>
  );
};

export default Search;
