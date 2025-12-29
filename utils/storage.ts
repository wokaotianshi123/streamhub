
import { Movie, Source } from '../types';

const STORAGE_KEY = 'streamhub_watch_history';
const CUSTOM_SOURCES_KEY = 'streamhub_custom_sources';
const CUSTOM_DOUBAN_TAGS_KEY = 'streamhub_custom_douban_tags';
const LAST_SOURCE_KEY = 'streamhub_last_source_api';
const MAX_HISTORY_ITEMS = 50;

// --- History Management ---

export const getHistory = (): Movie[] => {
  try {
    const historyJSON = localStorage.getItem(STORAGE_KEY);
    if (!historyJSON) return [];
    
    const parsed = JSON.parse(historyJSON);
    if (Array.isArray(parsed)) {
        return parsed.filter((item: any) => item && item.id && item.title);
    }
    return [];
  } catch (error) {
    console.error('Error reading history from localStorage:', error);
    return [];
  }
};

export const getMovieHistory = (id: string): Movie | undefined => {
  const history = getHistory();
  return history.find(m => m.id === id);
};

export const addToHistory = (movie: Movie): void => {
  try {
    const history = getHistory();
    const existingIndex = history.findIndex((item) => item.id === movie.id);
    
    let newItem = { ...movie };
    
    if (existingIndex !== -1) {
        const existing = history[existingIndex];
        newItem.currentTime = existing.currentTime || 0;
        newItem.currentEpisodeUrl = existing.currentEpisodeUrl;
        newItem.currentEpisodeName = existing.currentEpisodeName;
        
        history.splice(existingIndex, 1);
    } else {
        if (newItem.currentTime === undefined) newItem.currentTime = 0;
    }

    const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  } catch (error) {
    console.error('Error saving history to localStorage:', error);
  }
};

export const updateHistoryProgress = (movieId: string, time: number, episodeUrl?: string, episodeName?: string): void => {
  try {
    const history = getHistory();
    const index = history.findIndex(m => m.id === movieId);
    
    if (index !== -1) {
      history[index].currentTime = time;
      if (episodeUrl) history[index].currentEpisodeUrl = episodeUrl;
      if (episodeName) history[index].currentEpisodeName = episodeName;
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  } catch (error) {
    console.error('Error updating progress:', error);
  }
};

export const removeFromHistory = (movieId: string): void => {
  try {
    const history = getHistory();
    const newHistory = history.filter((item) => item.id !== movieId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  } catch (error) {
    console.error('Error removing from history:', error);
  }
};

export const clearHistory = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing history:', error);
  }
};

// --- Custom Source Management ---

export const getCustomSources = (): Source[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_SOURCES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Error reading custom sources", e);
    return [];
  }
};

export const addCustomSourceToStorage = (source: Source): Source[] => {
  try {
    const current = getCustomSources();
    if (current.some(s => s.api === source.api)) {
      return current;
    }
    const updated = [...current, { ...source, isCustom: true }];
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("Error saving custom source", e);
    return [];
  }
};

export const removeCustomSourceFromStorage = (api: string): Source[] => {
  try {
    const current = getCustomSources();
    const updated = current.filter(s => s.api !== api);
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("Error removing custom source", e);
    return [];
  }
};

// --- Custom Douban Tags Management ---

export const getCustomDoubanTags = (type: 'movie' | 'tv'): string[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
    if (!stored) return [];
    const allTags = JSON.parse(stored);
    return allTags[type] || [];
  } catch (e) {
    return [];
  }
};

export const addCustomDoubanTagToStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
    const allTags = stored ? JSON.parse(stored) : { movie: [], tv: [] };
    if (!allTags[type].includes(tag)) {
      allTags[type].push(tag);
      localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
    }
    return allTags[type];
  } catch (e) {
    return [];
  }
};

export const removeCustomDoubanTagFromStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
    if (!stored) return [];
    const allTags = JSON.parse(stored);
    allTags[type] = (allTags[type] || []).filter((t: string) => t !== tag);
    localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
    return allTags[type];
  } catch (e) {
    return [];
  }
};

// --- Last Used Source Management ---

export const getLastUsedSourceApi = (): string | null => {
  return localStorage.getItem(LAST_SOURCE_KEY);
};

export const setLastUsedSourceApi = (api: string): void => {
  localStorage.setItem(LAST_SOURCE_KEY, api);
};
