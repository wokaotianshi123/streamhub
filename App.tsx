import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState, Movie } from './types';
import { fetchSources } from './utils/api';
import { getCustomSources, addCustomSourceToStorage, removeCustomSourceFromStorage } from './utils/storage';

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
        if (localCustomSources.length > 0) {
           setCurrentSource(localCustomSources[0]);
        } else if (fetchedSources.length > 0) {
            setCurrentSource(fetchedSources[0]);
        }
    };
    initSources();
  }, []);

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
   * 如果电影对象携带了 sourceApi，且与当前全局源不一致，则自动切换源。
   */
  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const target = sources.find(s => s.api === movie.sourceApi);
        if (target) {
            setCurrentSource(target);
        } else {
            // 如果是历史记录里的源，但当前列表没找到（可能被删了），则手动构建一个临时源
            setCurrentSource({ name: movie.sourceName || '历史资源', api: movie.sourceApi });
        }
    }
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources(updated);
    setCurrentSource(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources(updated);
    if (currentSource.api === api) {
        if (updated.length > 0) setCurrentSource(updated[0]);
        else if (defaultSources.length > 0) setCurrentSource(defaultSources[0]);
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
            onSourceChange={setCurrentSource}
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
                onSourceChange={setCurrentSource}
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