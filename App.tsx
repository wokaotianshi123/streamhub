
import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState, Movie } from './types';
import { fetchSources } from './utils/api';
import { getCustomSources, addCustomSourceToStorage, removeCustomSourceFromStorage, getLastUsedSourceApi, setLastUsedSourceApi } from './utils/storage';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('HOME');
  const [previousView, setPreviousView] = useState<ViewState>('HOME');
  
  // --- Persistent View States ---
  const [homeViewState, setHomeViewState] = useState<HomeViewState>({
    movies: [],
    categories: [],
    activeCategoryId: '',
    page: 1,
    scrollY: 0,
    sourceApi: '',
    loading: true,
    error: false
  });

  const [searchViewState, setSearchViewState] = useState<SearchViewState>({
    results: [],
    query: '',
    scrollY: 0,
    isAggregate: false,
    selectedSourceApis: new Set(),
    loading: false,
    hasSearched: false
  });

  const [isDark, setIsDark] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedTheme = localStorage.getItem('streamhub_theme');
        if (savedTheme) return savedTheme === 'dark';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return false;
    } catch (e) { return false; }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState<string>('');
  
  // Source Management
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });

  const sources = [...defaultSources, ...customSources];

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
        root.classList.add('dark');
        localStorage.setItem('streamhub_theme', 'dark');
    } else {
        root.classList.remove('dark');
        localStorage.setItem('streamhub_theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    const initSources = async () => {
        const fetchedSources = await fetchSources();
        setDefaultSources(fetchedSources);
        const localCustomSources = getCustomSources();
        setCustomSources(localCustomSources);
        
        const lastApi = getLastUsedSourceApi();
        const allSources = [...fetchedSources, ...localCustomSources];
        
        // Restore logic: 
        // 1. Try last used source
        // 2. Try first custom source
        // 3. Try first default source
        const savedSource = lastApi ? allSources.find(s => s.api === lastApi) : null;

        if (savedSource) {
           setCurrentSource(savedSource);
        } else if (localCustomSources.length > 0) {
           setCurrentSource(localCustomSources[0]);
           setLastUsedSourceApi(localCustomSources[0].api);
        } else if (fetchedSources.length > 0) {
            setCurrentSource(fetchedSources[0]);
            setLastUsedSourceApi(fetchedSources[0].api);
        }
    };
    initSources();
  }, []);

  const handleSourceChange = (source: Source) => {
    setCurrentSource(source);
    setLastUsedSourceApi(source.api);
  };

  const handleViewChange = (newView: ViewState) => {
    if (currentView === 'HOME') {
        setHomeViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    } else if (currentView === 'SEARCH') {
        setSearchViewState(prev => ({ ...prev, scrollY: window.scrollY }));
    }
    if (newView === 'PLAYER') setPreviousView(currentView);
    setCurrentView(newView);
  };

  const handleBack = useCallback(() => {
    if (currentView === 'PLAYER') setCurrentView(previousView);
    else if (currentView === 'SEARCH') setCurrentView('HOME');
  }, [currentView, previousView]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setSearchViewState(prev => ({ ...prev, query: query, hasSearched: false }));
  };

  /**
   * 增强型选片逻辑：
   * 如果电影对象携带了 sourceApi，且与当前全局源不一致，则自动切换源并记忆。
   */
  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const target = sources.find(s => s.api === movie.sourceApi);
        if (target) {
            handleSourceChange(target);
        } else {
            // 如果是历史记录里的源，但当前列表没找到，则手动构建一个临时源并记忆
            const tempSource = { name: movie.sourceName || '历史资源', api: movie.sourceApi };
            handleSourceChange(tempSource);
        }
    }
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources(updated);
    handleSourceChange(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources(updated);
    if (currentSource.api === api) {
        if (updated.length > 0) handleSourceChange(updated[0]);
        else if (defaultSources.length > 0) handleSourceChange(defaultSources[0]);
    }
  };

  const updateHomeState = (updates: Partial<HomeViewState>) => setHomeViewState(prev => ({ ...prev, ...updates }));
  const updateSearchState = (updates: Partial<SearchViewState>) => setSearchViewState(prev => ({ ...prev, ...updates }));

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return (
          <Home 
            setView={handleViewChange} 
            onSelectMovie={handleSelectMovie} 
            currentSource={currentSource}
            sources={sources}
            onSourceChange={handleSourceChange}
            onAddCustomSource={handleAddCustomSource}
            onRemoveCustomSource={handleRemoveCustomSource}
            savedState={homeViewState}
            onStateUpdate={updateHomeState}
          />
        );
      case 'SEARCH':
        return (
            <Search 
                setView={handleViewChange} 
                query={searchQuery} 
                onSelectMovie={handleSelectMovie}
                currentSource={currentSource}
                sources={sources}
                onSourceChange={handleSourceChange}
                savedState={searchViewState}
                onStateUpdate={updateSearchState}
            />
        );
      case 'PLAYER':
        return (
            <Player 
                setView={handleViewChange} 
                movieId={selectedMovieId} 
                currentSource={currentSource}
            />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen font-display">
      <Header 
        currentView={currentView} 
        setView={handleViewChange} 
        onBack={handleBack}
        onSearch={handleSearch}
      />
      {renderView()}
      <Footer currentView={currentView} />
    </div>
  );
};

export default App;
