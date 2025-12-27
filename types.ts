
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
  currentEpisodeUrl?: string; // New: Store specific episode
  currentEpisodeName?: string; // New: Store episode name
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

// --- State Persistence Interfaces ---

export interface HomeViewState {
  movies: Movie[];
  categories: Category[];
  activeCategoryId: string;
  page: number;
  scrollY: number;
  sourceApi: string; // To track if source changed
  loading: boolean;
  error: boolean;
}

export interface SearchViewState {
  results: Movie[];
  query: string;
  scrollY: number;
  isAggregate: boolean;
  selectedSourceApis: Set<string>;
  loading: boolean;
  hasSearched: boolean; // To know if we should show results or empty state
}

// --- Props Interfaces ---

export interface NavProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
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
  onSelectMovie: (id: string) => void;
  // State injection
  savedState: SearchViewState;
  onStateUpdate: (updates: Partial<SearchViewState>) => void;
}

export interface HomeProps {
  setView: (view: ViewState) => void;
  onSelectMovie: (id: string) => void;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onAddCustomSource: (name: string, api: string) => void;
  onRemoveCustomSource: (api: string) => void;
  // State injection
  savedState: HomeViewState;
  onStateUpdate: (updates: Partial<HomeViewState>) => void;
}