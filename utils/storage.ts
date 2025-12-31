
import { Movie, Source } from '../types';

const HISTORY_KEY = 'streamhub_watch_history';
const FAVORITES_KEY = 'streamhub_favorites';
const CUSTOM_SOURCES_KEY = 'streamhub_custom_sources';
const DISABLED_SOURCES_KEY = 'streamhub_disabled_sources';
const CUSTOM_DOUBAN_TAGS_KEY = 'streamhub_custom_douban_tags';
const LAST_SOURCE_KEY = 'streamhub_last_source_api';
const ACCELERATION_URL_KEY = 'streamhub_acceleration_url';
const ACCELERATION_ENABLED_KEY = 'streamhub_acceleration_enabled';
const MAX_HISTORY_ITEMS = 50;

// --- Helper to get data ---
const getRawData = (key: string): any[] => {
  try {
    const json = localStorage.getItem(key);
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
};

// --- History Management ---
export const getHistory = (): Movie[] => getRawData(HISTORY_KEY).filter((item: any) => item && item.id && item.title);

export const getMovieProgress = (id: string): Movie | undefined => {
  const history = getHistory();
  const histMatch = history.find(m => m.id === id);
  if (histMatch && histMatch.currentTime) return histMatch;

  const favorites = getFavorites();
  return favorites.find(m => m.id === id);
};

export const addToHistory = (movie: Movie): void => {
  try {
    const history = getHistory();
    const existingIndex = history.findIndex((item) => item.id === movie.id);
    let newItem = { ...movie };
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

export const updateHistoryProgress = (movieId: string, time: number, episodeUrl?: string, episodeName?: string): void => {
  try {
    const history = getHistory();
    const hIndex = history.findIndex(m => m.id === movieId);
    if (hIndex !== -1) {
      history[hIndex].currentTime = time;
      if (episodeUrl) history[hIndex].currentEpisodeUrl = episodeUrl;
      if (episodeName) history[hIndex].currentEpisodeName = episodeName;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
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

export const updateAllCustomSources = (sources: Source[]): void => {
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(sources));
};

export const getDisabledSourceApis = (): string[] => {
  try {
    const stored = localStorage.getItem(DISABLED_SOURCES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) { return []; }
};

export const updateDisabledSourceApis = (apis: string[]): void => {
  localStorage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(apis));
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

export const resetSourcesToDefault = (): void => {
  localStorage.removeItem(CUSTOM_SOURCES_KEY);
  localStorage.removeItem(DISABLED_SOURCES_KEY);
  localStorage.removeItem(LAST_SOURCE_KEY);
  localStorage.removeItem(ACCELERATION_URL_KEY);
  localStorage.removeItem(ACCELERATION_ENABLED_KEY);
};

// --- Acceleration Management ---
export const getAccelerationConfig = (): { url: string, enabled: boolean } => {
    const url = localStorage.getItem(ACCELERATION_URL_KEY) || 'https://cfkua.wokaotianshi.eu.org';
    const enabled = localStorage.getItem(ACCELERATION_ENABLED_KEY) === 'true';
    return { url, enabled };
};

export const setAccelerationConfig = (url: string, enabled: boolean): void => {
    localStorage.setItem(ACCELERATION_URL_KEY, url);
    localStorage.setItem(ACCELERATION_ENABLED_KEY, String(enabled));
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

// --- 备份与还原逻辑 ---

const getFormattedTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
};

export const exportSourcesData = () => {
    const custom = getCustomSources();
    const data = custom.map(s => ({ name: s.name, url: s.api }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getFormattedTimestamp()}备份源.json`;
    a.click();
    URL.revokeObjectURL(url);
};

export const importSourcesData = (jsonData: any[]): Source[] => {
    if (!Array.isArray(jsonData)) return getCustomSources();
    const current = getCustomSources();
    const newSources: Source[] = [];
    jsonData.forEach(item => {
        const api = item.url || item.api;
        if (api && item.name && !current.some(s => s.api === api)) {
            newSources.push({ name: item.name, api: api, isCustom: true });
        }
    });
    const updated = [...current, ...newSources];
    localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(updated));
    return updated;
};

export const exportFullBackup = () => {
    const backup = {
        history: getHistory(),
        favorites: getFavorites(),
        customSources: getCustomSources(),
        disabledSources: getDisabledSourceApis(),
        customDoubanTags: {
            movie: getCustomDoubanTags('movie'),
            tv: getCustomDoubanTags('tv')
        },
        acceleration: getAccelerationConfig(),
        lastSource: getLastUsedSourceApi(),
        version: '1.2'
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getFormattedTimestamp()}一键备份源.json`;
    a.click();
    URL.revokeObjectURL(url);
};

export const importFullBackup = (backup: any) => {
    if (!backup || typeof backup !== 'object') return false;
    try {
        if (backup.history) localStorage.setItem(HISTORY_KEY, JSON.stringify(backup.history));
        if (backup.favorites) localStorage.setItem(FAVORITES_KEY, JSON.stringify(backup.favorites));
        if (backup.customSources) localStorage.setItem(CUSTOM_SOURCES_KEY, JSON.stringify(backup.customSources));
        if (backup.disabledSources) localStorage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(backup.disabledSources));
        if (backup.customDoubanTags) localStorage.setItem(CUSTOM_DOUBAN_TAGS_KEY, JSON.stringify(backup.customDoubanTags));
        if (backup.lastSource) localStorage.setItem(LAST_SOURCE_KEY, backup.lastSource);
        if (backup.acceleration) {
            localStorage.setItem(ACCELERATION_URL_KEY, backup.acceleration.url);
            localStorage.setItem(ACCELERATION_ENABLED_KEY, String(backup.acceleration.enabled));
        }
        return true;
    } catch (e) {
        return false;
    }
};
