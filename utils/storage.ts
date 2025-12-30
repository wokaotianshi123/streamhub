
import { Movie, Source } from '../types';

const HISTORY_KEY = 'streamhub_watch_history';
const FAVORITES_KEY = 'streamhub_favorites';
const CUSTOM_SOURCES_KEY = 'streamhub_custom_sources';
const CUSTOM_DOUBAN_TAGS_KEY = 'streamhub_custom_douban_tags';
const LAST_SOURCE_KEY = 'streamhub_last_source_api';
const MAX_HISTORY_ITEMS = 50;

// --- Helper to get data ---
const getRawData = (key: string): Movie[] => {
  try {
    const json = localStorage.getItem(key);
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
};

// --- History Management ---

export const getHistory = (): Movie[] => getRawData(HISTORY_KEY).filter((item: any) => item && item.id && item.title);

/**
 * 获取播放进度：优先检查历史记录，再检查收藏夹
 */
export const getMovieProgress = (id: string): Movie | undefined => {
  const history = getHistory();
  const histMatch = history.find(m => m.id === id);
  if (histMatch && histMatch.currentTime) return histMatch;

  const favorites = getFavorites();
  return favorites.find(m => m.id === id);
};

// 保持向下兼容，重定向到新函数
export const getMovieHistory = (id: string) => getMovieProgress(id);

export const addToHistory = (movie: Movie): void => {
  try {
    const history = getHistory();
    const existingIndex = history.findIndex((item) => item.id === movie.id);
    
    let newItem = { ...movie };
    
    // 关键修复：合并进度
    // 如果历史没有，尝试从收藏夹获取初始进度
    if (existingIndex === -1) {
        const favMatch = getFavorites().find(m => m.id === movie.id);
        if (favMatch) {
            newItem.currentTime = movie.currentTime || favMatch.currentTime || 0;
            newItem.currentEpisodeUrl = movie.currentEpisodeUrl || favMatch.currentEpisodeUrl;
            newItem.currentEpisodeName = movie.currentEpisodeName || favMatch.currentEpisodeName;
        }
    } else {
        const existing = history[existingIndex];
        newItem.currentTime = movie.currentTime || existing.currentTime || 0;
        newItem.currentEpisodeUrl = movie.currentEpisodeUrl || existing.currentEpisodeUrl;
        newItem.currentEpisodeName = movie.currentEpisodeName || existing.currentEpisodeName;
        history.splice(existingIndex, 1);
    }
    
    const newHistory = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  } catch (error) {}
};

/**
 * 同步更新历史和收藏夹中的进度
 */
export const updateHistoryProgress = (movieId: string, time: number, episodeUrl?: string, episodeName?: string): void => {
  try {
    // 1. 更新历史记录
    const history = getHistory();
    const hIndex = history.findIndex(m => m.id === movieId);
    if (hIndex !== -1) {
      history[hIndex].currentTime = time;
      if (episodeUrl) history[hIndex].currentEpisodeUrl = episodeUrl;
      if (episodeName) history[hIndex].currentEpisodeName = episodeName;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    // 2. 更新收藏夹进度（确保收藏项进度独立持久化）
    const favorites = getFavorites();
    const fIndex = favorites.findIndex(m => m.id === movieId);
    if (fIndex !== -1) {
      favorites[fIndex].currentTime = time;
      if (episodeUrl) favorites[fIndex].currentEpisodeUrl = episodeUrl;
      if (episodeName) favorites[fIndex].currentEpisodeName = episodeName;
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
  } catch (error) {}
};

export const removeFromHistory = (movieId: string): void => {
  const history = getHistory();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.filter(m => m.id !== movieId)));
};

export const clearHistory = (): void => localStorage.removeItem(HISTORY_KEY);

// --- Favorites Management ---

export const getFavorites = (): Movie[] => getRawData(FAVORITES_KEY);

export const isFavorite = (id: string): boolean => {
  const favorites = getFavorites();
  return favorites.some(m => m.id === id);
};

export const toggleFavorite = (movie: Movie): boolean => {
  const favorites = getFavorites();
  const index = favorites.findIndex(m => m.id === movie.id);
  let isAdded = false;
  
  if (index !== -1) {
    favorites.splice(index, 1);
    isAdded = false;
  } else {
    // 添加到收藏时，如果历史记录里有进度，顺便带过来
    const historyItem = getHistory().find(m => m.id === movie.id);
    const movieWithProgress = {
        ...movie,
        currentTime: historyItem?.currentTime || movie.currentTime || 0,
        currentEpisodeUrl: historyItem?.currentEpisodeUrl || movie.currentEpisodeUrl,
        currentEpisodeName: historyItem?.currentEpisodeName || movie.currentEpisodeName
    };
    favorites.unshift(movieWithProgress);
    isAdded = true;
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return isAdded;
};

export const removeFromFavorites = (id: string): void => {
  const favorites = getFavorites();
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.filter(m => m.id !== id)));
};

export const clearFavorites = (): void => localStorage.removeItem(FAVORITES_KEY);

// --- Custom Source Management ---

export const getCustomSources = (): Source[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_SOURCES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) { return []; }
};

export const addCustomSourceToStorage = (source: Source): Source[] => {
  const current = getCustomSources();
  if (current.some(s => s.api === source.api)) return current;
  const updated = [...current, { ...source, isCustom: true }];
  localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
  return updated;
};

export const removeCustomSourceFromStorage = (api: string): Source[] => {
  const current = getCustomSources();
  const updated = current.filter(s => s.api !== api);
  localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
  return updated;
};

// --- Douban Tags ---

export const getCustomDoubanTags = (type: 'movie' | 'tv'): string[] => {
  try {
    const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
    if (!stored) return [];
    const allTags = JSON.parse(stored);
    return allTags[type] || [];
  } catch (e) { return []; }
};

export const addCustomDoubanTagToStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
  const allTags = stored ? JSON.parse(stored) : { movie: [], tv: [] };
  if (!allTags[type].includes(tag)) {
    allTags[type].push(tag);
    localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
  }
  return allTags[type];
};

export const removeCustomDoubanTagFromStorage = (type: 'movie' | 'tv', tag: string): string[] => {
  const stored = localStorage.getItem(CUSTOM_DOUBAN_TAGS_KEY);
  if (!stored) return [];
  const allTags = JSON.parse(stored);
  allTags[type] = (allTags[type] || []).filter((t: string) => t !== tag);
  localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(allTags));
  return allTags[type];
};

export const getLastUsedSourceApi = (): string | null => localStorage.getItem(LAST_SOURCE_KEY);
export const setLastUsedSourceApi = (api: string): void => localStorage.setItem(LAST_SOURCE_KEY, api);
