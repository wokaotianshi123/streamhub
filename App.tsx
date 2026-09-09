
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source, HomeViewState, SearchViewState, Movie } from './types';
import { fetchSources } from './utils/api';
import { 
  getCustomSources, 
  addCustomSourceToStorage, 
  removeCustomSourceFromStorage, 
  updateAllCustomSources, 
  getLastUsedSourceApi, 
  setLastUsedSourceApi,
  getDisabledSourceApis,
  updateDisabledSourceApis,
  resetSourcesToDefault
} from './utils/storage';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('HOME');
  const [previousView, setPreviousView] = useState<ViewState>('HOME');
  
  const [homeViewState, setHomeViewState] = useState<HomeViewState>({
    movies: [],
    categories: [],
    activeCategoryId: '',
    page: 1,
    scrollY: 0,
    sourceApi: '',
    loading: true,
    error: false,
    doubanLoading: false, // 初始化独立状态
    doubanError: false,   // 初始化独立状态
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
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [disabledApis, setDisabledApis] = useState<Set<string>>(new Set());
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });
  
  const [playbackSource, setPlaybackSource] = useState<Source | null>(null);

  // 完整列表：用于管理和健康检测（保留所有原始项）
  const allSources = useMemo(() => [...defaultSources, ...customSources], [defaultSources, customSources]);

  // 过滤后的可用列表：
  // 1. 过滤掉被禁用的 API
  // 2. 自动去重：同一个 API 默认只保留出现的第一个，实现“干净”的展示列表
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return allSources.filter(s => {
      if (disabledApis.has(s.api)) return false;
      if (seen.has(s.api)) return false;
      seen.add(s.api);
      return true;
    });
  }, [allSources, disabledApis]);

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

  const initSources = useCallback(async () => {
    const fetchedSources = await fetchSources();
    setDefaultSources(fetchedSources);
    
    const localCustomSources = getCustomSources();
    setCustomSources(localCustomSources);
    
    const localDisabled = getDisabledSourceApis();
    setDisabledApis(new Set(localDisabled));
    
    const lastApi = getLastUsedSourceApi();
    
    // 初始化时计算一次可用源，用于恢复上次使用的源
    const seen = new Set<string>();
    const allWorkingSources = [...fetchedSources, ...localCustomSources].filter(s => {
        if (localDisabled.includes(s.api)) return false;
        if (seen.has(s.api)) return false;
        seen.add(s.api);
        return true;
    });
    
    const savedSource = lastApi ? allWorkingSources.find(s => s.api === lastApi) : null;

    if (savedSource) {
       setCurrentSource(savedSource);
    } else if (allWorkingSources.length > 0) {
        setCurrentSource(allWorkingSources[0]);
        setLastUsedSourceApi(allWorkingSources[0].api);
    }
  }, []);

  useEffect(() => {
    initSources();
  }, [initSources]);

  const handleSourceChange = (source: Source) => {
    setCurrentSource(source);
    setLastUsedSourceApi(source.api);
    setPlaybackSource(source);
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

  // 修改：默认开启聚合搜索 (autoAggregate 默认为 true)
  const handleSearch = (query: string, autoAggregate: boolean = true) => {
    setSearchQuery(query);
    setSearchViewState(prev => {
        const shouldAggregate = autoAggregate;
        const next = { 
            ...prev, 
            query: query, 
            hasSearched: false,
            isAggregate: shouldAggregate,
            selectedSourceApis: new Set(prev.selectedSourceApis)
        };
        const currentAvailableApis = sources.map(s => s.api);
        
        // 如果开启聚合，默认选中所有可用源
        if (shouldAggregate) {
            next.selectedSourceApis = new Set(currentAvailableApis);
        } else if (next.selectedSourceApis.size === 0) {
            next.selectedSourceApis = new Set([currentSource.api]);
        }
        return next;
    });
    handleViewChange('SEARCH');
  };

  const handleSelectMovie = (movie: Movie) => {
    setSelectedMovieId(movie.id);
    setSelectedMovie(movie);
    const targetSource = sources.find(s => s.api === movie.sourceApi) || 
                        (movie.sourceApi ? { name: movie.sourceName || '资源源', api: movie.sourceApi } : null);
    const activeSource = targetSource || currentSource;
    setPlaybackSource(activeSource);

    if (currentView !== 'PLAYER' && targetSource && targetSource.api !== currentSource.api) {
        setCurrentSource(targetSource);
        setLastUsedSourceApi(targetSource.api);
    }
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources([...updated]);
    handleSourceChange(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources([...updated]);
    if (currentSource.api === api) {
        // 使用更新后的源列表寻找备选
        const nextSources = [...defaultSources, ...updated].filter(s => !disabledApis.has(s.api));
        if (nextSources.length > 0) handleSourceChange(nextSources[0]);
    }
  };

  const handleUpdateCustomSources = (newCustomSources: Source[]) => {
    updateAllCustomSources(newCustomSources);
    setCustomSources([...newCustomSources]);
    
    // 检查当前选中的源是否还在可用列表（非禁用且非重复被过滤）
    const isCurrentStillInOptimized = sources.some(s => s.api === currentSource.api);
    if (!isCurrentStillInOptimized) {
      // 重新从 sources 中取第一个作为默认
      if (sources.length > 0) handleSourceChange(sources[0]);
    }
  };

  const handleUpdateDisabledSources = (newDisabledApisList: string[]) => {
    // 健康检查完成后，使用最新的失效列表替换旧的
    updateDisabledSourceApis(newDisabledApisList);
    setDisabledApis(new Set(newDisabledApisList));
    
    // 如果当前选中的源现在被禁用了，则重置
    if (newDisabledApisList.includes(currentSource.api)) {
       // 这里不能直接用 sources，因为 sources 依赖 disabledApis 状态更新，可能还没反映出来
       // 手动计算一次新的可用源
       const nextWorking = allSources.filter(s => !newDisabledApisList.includes(s.api));
       if (nextWorking.length > 0) handleSourceChange(nextWorking[0]);
    }
  };

  const handleResetSources = () => {
    if (confirm('确定要恢复默认设置吗？所有自定义源和健康检测记录都将被清除。')) {
      resetSourcesToDefault();
      setDisabledApis(new Set());
      setCustomSources([]);
      initSources();
      alert('已恢复为默认源配置');
    }
  };

  const updateHomeState = (updates: Partial<HomeViewState>) => setHomeViewState(prev => ({ ...prev, ...updates }));
  const updateSearchState = (updates: Partial<SearchViewState>) => setSearchViewState(prev => ({ ...prev, ...updates }));

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return <Home 
          setView={handleViewChange} 
          onSelectMovie={handleSelectMovie} 
          currentSource={currentSource} 
          sources={sources} 
          // @ts-ignore: 传递全量列表用于后台健康检测
          allSources={allSources}
          onSourceChange={handleSourceChange} 
          onAddCustomSource={handleAddCustomSource} 
          onRemoveCustomSource={handleRemoveCustomSource} 
          onUpdateCustomSources={handleUpdateCustomSources}
          onUpdateDisabledSources={handleUpdateDisabledSources}
          onResetSources={handleResetSources}
          onSearch={handleSearch} 
          savedState={homeViewState} 
          onStateUpdate={updateHomeState} 
        />;
      case 'SEARCH':
        return <Search setView={handleViewChange} query={searchQuery} onSelectMovie={handleSelectMovie} currentSource={currentSource} sources={sources} onSourceChange={handleSourceChange} savedState={searchViewState} onStateUpdate={updateSearchState} />;
      case 'PLAYER':
        return <Player setView={handleViewChange} movieId={selectedMovieId} currentSource={playbackSource || currentSource} sources={sources} onSelectMovie={handleSelectMovie} initialMovie={selectedMovie} />;
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
