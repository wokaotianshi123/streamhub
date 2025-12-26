import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './views/Home';
import Search from './views/Search';
import Player from './views/Player';
import { ViewState, Source } from './types';
import { fetchSources } from './utils/api';
import { getCustomSources, addCustomSourceToStorage, removeCustomSourceFromStorage } from './utils/storage';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('HOME');
  
  // Theme state initialization
  const [isDark, setIsDark] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedTheme = localStorage.getItem('streamhub_theme');
        if (savedTheme) {
          return savedTheme === 'dark';
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return false;
    } catch (e) {
      return false;
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState<string>('');
  
  // Source Management
  const [defaultSources, setDefaultSources] = useState<Source[]>([]);
  const [customSources, setCustomSources] = useState<Source[]>([]);
  const [currentSource, setCurrentSource] = useState<Source>({ name: '加载中...', api: '' });

  // Computed combined sources
  const sources = [...defaultSources, ...customSources];

  // Sync theme
  useEffect(() => {
    try {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark');
            localStorage.setItem('streamhub_theme', 'dark');
        } else {
            root.classList.remove('dark');
            localStorage.setItem('streamhub_theme', 'light');
        }
    } catch (e) {
        console.error("Theme Error", e);
    }
  }, [isDark]);

  // Load sources
  useEffect(() => {
    const initSources = async () => {
        // 1. Fetch Default Sources
        const fetchedSources = await fetchSources();
        setDefaultSources(fetchedSources);

        // 2. Load Custom Sources
        const localCustomSources = getCustomSources();
        setCustomSources(localCustomSources);

        // 3. Set Initial Source
        if (localCustomSources.length > 0) {
           setCurrentSource(localCustomSources[0]);
        } else if (fetchedSources.length > 0) {
            setCurrentSource(fetchedSources[0]);
        }
    };
    initSources();
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev);
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleSelectMovie = (id: string) => {
    setSelectedMovieId(id);
  };

  const handleAddCustomSource = (name: string, api: string) => {
    const newSource = { name, api, isCustom: true };
    const updated = addCustomSourceToStorage(newSource);
    setCustomSources(updated);
    // Switch to new source immediately for better UX
    setCurrentSource(newSource);
  };

  const handleRemoveCustomSource = (api: string) => {
    const updated = removeCustomSourceFromStorage(api);
    setCustomSources(updated);
    // If current source was the deleted one, switch to default
    if (currentSource.api === api) {
        if (updated.length > 0) setCurrentSource(updated[0]);
        else if (defaultSources.length > 0) setCurrentSource(defaultSources[0]);
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'HOME':
        return (
          <Home 
            setView={setCurrentView} 
            onSelectMovie={handleSelectMovie} 
            currentSource={currentSource}
            sources={sources}
            onSourceChange={setCurrentSource}
            onAddCustomSource={handleAddCustomSource}
            onRemoveCustomSource={handleRemoveCustomSource}
          />
        );
      case 'SEARCH':
        return (
            <Search 
                setView={setCurrentView} 
                query={searchQuery} 
                onSelectMovie={handleSelectMovie}
                currentSource={currentSource}
                sources={sources}
                onSourceChange={setCurrentSource}
            />
        );
      case 'PLAYER':
        return (
            <Player 
                setView={setCurrentView} 
                movieId={selectedMovieId} 
                currentSource={currentSource}
            />
        );
      default:
        return (
            <Home 
                setView={setCurrentView} 
                onSelectMovie={handleSelectMovie} 
                currentSource={currentSource}
                sources={sources}
                onSourceChange={setCurrentSource}
                onAddCustomSource={handleAddCustomSource}
                onRemoveCustomSource={handleRemoveCustomSource}
            />
        );
    }
  };

  return (
    <div className="flex flex-col min-h-screen font-display">
      <Header 
        currentView={currentView} 
        setView={setCurrentView} 
        toggleTheme={toggleTheme}
        isDark={isDark}
        onSearch={handleSearch}
      />
      
      {renderView()}

      <Footer currentView={currentView} />
    </div>
  );
};

export default App;
