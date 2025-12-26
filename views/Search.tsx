import React, { useEffect, useState } from 'react';
import { Movie, ViewState, SearchProps } from '../types';
import MovieCard from '../components/MovieCard';
import { Icon } from '../components/Icon';
import { searchVideos } from '../utils/api';
import { addToHistory } from '../utils/storage';

interface ExtendedSearchProps extends SearchProps {
    onSelectMovie: (id: string) => void;
}

const Search: React.FC<ExtendedSearchProps> = ({ setView, query, onSelectMovie, currentSource, sources, onSourceChange }) => {
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAggregate, setIsAggregate] = useState(false);
  // Default to all source APIs
  const [selectedSourceApis, setSelectedSourceApis] = useState<Set<string>>(new Set());

  // Initialize selected sources when sources list loads
  useEffect(() => {
    if (sources.length > 0 && selectedSourceApis.size === 0) {
        setSelectedSourceApis(new Set(sources.map(s => s.api)));
    }
  }, [sources]);

  // Main search effect
  useEffect(() => {
    const doSearch = async () => {
      if (!query) return;
      setLoading(true);
      setResults([]);

      if (!isAggregate) {
        // Single Source Search
        if (!currentSource.api) {
            setLoading(false);
            return;
        }
        const data = await searchVideos(currentSource.api, query);
        // Map data to include source info
        const enhancedData = data.map(m => ({
            ...m,
            sourceApi: currentSource.api,
            sourceName: currentSource.name
        }));
        setResults(enhancedData);
      } else {
        // Aggregate Search
        const searchPromises = sources
            .filter(s => selectedSourceApis.has(s.api))
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
        // Flatten and maybe sort by relevance? 
        // For now just flatten.
        setResults(allResults.flat());
      }
      
      setLoading(false);
    };

    // Debounce slightly to prevent rapid firing when toggling switches
    const timer = setTimeout(() => {
        doSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [query, currentSource, isAggregate, selectedSourceApis, sources]);

  const handleMovieClick = (movie: Movie) => {
    // If it's an aggregate result and from a different source, switch the app's current source
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const targetSource = sources.find(s => s.api === movie.sourceApi);
        if (targetSource) {
            onSourceChange(targetSource);
        }
    }
    
    addToHistory(movie);
    onSelectMovie(movie.id);
    setView('PLAYER');
  };

  const toggleSourceSelection = (api: string) => {
    const newSet = new Set(selectedSourceApis);
    if (newSet.has(api)) {
        newSet.delete(api);
    } else {
        newSet.add(api);
    }
    setSelectedSourceApis(newSet);
  };

  const toggleAllSources = () => {
    if (selectedSourceApis.size === sources.length) {
        setSelectedSourceApis(new Set());
    } else {
        setSelectedSourceApis(new Set(sources.map(s => s.api)));
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8 animate-fadeIn">
      {/* Header Info & Controls */}
      <section className="space-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <h2 className="text-2xl font-bold text-text-main-light dark:text-text-main-dark">搜索: "{query}"</h2>
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-white dark:bg-card-dark px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                    <span className="text-sm font-medium">聚合搜索</span>
                    <button 
                        onClick={() => setIsAggregate(!isAggregate)}
                        className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${isAggregate ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform duration-300 ${isAggregate ? 'translate-x-5' : 'translate-x-0'}`}></div>
                    </button>
                </div>
                <div className="text-sm text-text-muted-light dark:text-text-muted-dark whitespace-nowrap">
                    找到 {results.length} 个结果
                </div>
             </div>
          </div>

          {/* Aggregate Options Panel */}
          {isAggregate && (
              <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 animate-fadeIn">
                 <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-text-muted-light dark:text-text-muted-dark">选择搜索源:</span>
                    <button 
                        onClick={toggleAllSources}
                        className="text-xs text-primary hover:text-blue-600 font-medium"
                    >
                        {selectedSourceApis.size === sources.length ? '取消全选' : '全选'}
                    </button>
                 </div>
                 <div className="flex flex-wrap gap-2">
                    {sources.map(source => (
                        <button
                            key={source.api}
                            onClick={() => toggleSourceSelection(source.api)}
                            className={`px-3 py-1.5 rounded-md text-xs transition-all border ${
                                selectedSourceApis.has(source.api) 
                                ? 'bg-primary/10 border-primary text-primary font-medium' 
                                : 'bg-white dark:bg-card-dark border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                            }`}
                        >
                            {source.name}
                        </button>
                    ))}
                 </div>
              </div>
          )}
        </div>
      </section>

      {/* Results Grid */}
      <section className="min-h-[50vh]">
         {loading ? (
             <div className="flex flex-col justify-center items-center py-20 space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                {isAggregate && <p className="text-sm text-gray-500">正在搜索 {selectedSourceApis.size} 个资源站...</p>}
             </div>
         ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-8 gap-x-4 sm:gap-x-6">
                {results.map((movie, index) => (
                <MovieCard 
                    // Use index in key to prevent collision if different sources have same ID (rare but possible)
                    key={`${movie.sourceApi}-${movie.id}-${index}`} 
                    movie={movie} 
                    viewType="SEARCH" 
                    onClick={() => handleMovieClick(movie)} 
                />
                ))}
                {results.length === 0 && !loading && (
                    <div className="col-span-full text-center text-text-muted-light dark:text-text-muted-dark py-10">
                        没有找到相关视频
                    </div>
                )}
            </div>
         )}
      </section>
    </main>
  );
};

export default Search;