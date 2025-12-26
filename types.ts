
export interface Movie {
  id: string;
  title: string;
  year: string;
  genre: string;
  image: string;
  badge?: string;
  badgeColor?: 'black' | 'primary';
  rating?: number;
  // Fields for API data
  vod_id?: string;
  vod_play_url?: string;
  vod_content?: string;
  vod_actor?: string;
  vod_director?: string;
  // User data
  currentTime?: number;
  // Aggregate Search Data
  sourceApi?: string;
  sourceName?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Source {
  name: string;
  api: string;
  isCustom?: boolean;
}

export type ViewState = 'HOME' | 'SEARCH' | 'PLAYER';

export interface NavProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  toggleTheme: () => void;
  isDark: boolean;
  onSearch: (query: string) => void;
}

export interface PlayerProps {
  setView: (view: ViewState) => void;
  movieId: string;
  currentSource: Source;
}

export interface SearchProps {
  setView: (view: ViewState) => void;
  query: string;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
}

export interface HomeProps {
  setView: (view: ViewState) => void;
  onSelectMovie: (id: string) => void;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onAddCustomSource: (name: string, api: string) => void;
  onRemoveCustomSource: (api: string) => void;
}
