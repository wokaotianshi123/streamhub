
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
    error: false,
    isDoubanMode: false,
    doubanType: 'movie',
    doubanTag: '热门',
    doubanMovies: []
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

  // 这里的 sources 是实时计算的，供子组件使用
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
        
        const savedSource = lastApi ? allSources.find(s => s.api === lastApi) : null;

        if (savedSource) {
           setCurrentSource(savedSource);
        } else if (allSources.length > 0) {
            setCurrentSource(allSources[0]);
            setLastUsedSourceApi(allSources[0].api);
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

  const handleSearch = (query: string, autoAggregate: boolean = false) => {
    setSearchQuery(query);
    setSearchViewState(prev => {
        const next = { 
            ...prev, 
            query: query, 
            hasSearched: false,
            isAggregate: autoAggregate || prev.isAggregate,
            selectedSourceApis: new Set(prev.selectedSourceApis)
        };
        
        // 关键：实时根据当前已加载的源列表进行初始化
        const currentAvailableApis = sources.map(s => s.api);
        
        if (autoAggregate) {
            // 豆瓣点击立即检索：强制选中所有源
            next.selectedSourceApis = new Set(currentAvailableApis);
        } else if (next.selectedSourceApis.size === 0) {
            // 普通搜索：至少选中当前源
            next.selectedSourceApis = new Set([currentSource.api]);
        }
        return next;
    });
    handleViewChange('SEARCH');
  };

  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    if (movie.sourceApi && movie.sourceApi !== currentSource.api) {
        const target = sources.find(s => s.api === movie.sourceApi);
        if (target) {
            handleSourceChange(target);
        } else {
            const tempSource = { name: movie.sourceName || '资源源', api: movie.sourceApi };
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
        return <Home setView={handleViewChange} onSelectMovie={handleSelectMovie} currentSource={currentSource} sources={sources} onSourceChange={handleSourceChange} onAddCustomSource={handleAddCustomSource} onRemoveCustomSource={handleRemoveCustomSource} onSearch={handleSearch} savedState={homeViewState} onStateUpdate={updateHomeState} />;
      case 'SEARCH':
        return <Search setView={handleViewChange} query={searchQuery} onSelectMovie={handleSelectMovie} currentSource={currentSource} sources={sources} onSourceChange={handleSourceChange} savedState={searchViewState} onStateUpdate={updateSearchState} />;
      case 'PLAYER':
        return <Player setView={handleViewChange} movieId={selectedMovieId} currentSource={currentSource} />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen font-display">
      <Header currentView={currentView} setView={handleViewChange} onBack={handleBack} onSearch={handleSearch} />
      {renderView()}
      <Footer currentView={currentView} />
    </div>
  );
};

export default App;
