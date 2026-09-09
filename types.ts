

export interface Movie {
  id: string;
  title: string;
  year: string;
  genre: string;
  image: string;
  badge?: string;
  badgeColor?: 'black' | 'primary';
  rating?: number;
  vod_id?: string;
  vod_play_url?: string;
  vod_content?: string;
  vod_actor?: string;
  vod_director?: string;
  currentTime?: number;
  currentEpisodeUrl?: string; 
  currentEpisodeName?: string; 
  sourceApi?: string;
  sourceName?: string;
  isDouban?: boolean;
  // 新增：聚合模式下的可用源列表
  availableSources?: {
    api: string;
    name: string;
    vodId?: string; // 保存对应源的视频ID
  }[];
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

export interface HomeViewState {
  movies: Movie[];
  categories: Category[];
  activeCategoryId: string;
  page: number;
  scrollY: number;
  sourceApi: string; 
  loading: boolean;      // 仅用于采集源加载状态
  error: boolean;        // 仅用于采集源错误状态
  doubanLoading: boolean; // 新增：独立用于豆瓣加载状态
  doubanError: boolean;   // 新增：独立用于豆瓣错误状态
  isDoubanMode: boolean;
  doubanType: 'movie' | 'tv';
  doubanTag: string;
  doubanMovies: Movie[];
}

export interface SearchViewState {
  results: Movie[];
  query: string;
  scrollY: number;
  isAggregate: boolean;
  selectedSourceApis: Set<string>;
  loading: boolean;
  hasSearched: boolean; 
}

export interface NavProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  onBack: () => void;
  onSearch: (query: string, autoAggregate?: boolean) => void;
}

export interface PlayerProps {
  setView: (view: ViewState) => void;
  movieId: string;
  currentSource: Source;
  sources: Source[]; 
  onSelectMovie: (movie: Movie) => void;
  /** 点击卡片时携带的列表数据，详情接口失败时可作为兜底展示，避免空白 */
  initialMovie?: Movie | null;
}

export interface SearchProps {
  setView: (view: ViewState) => void;
  query: string;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onSelectMovie: (movie: Movie) => void;
  savedState: SearchViewState;
  onStateUpdate: (updates: Partial<SearchViewState>) => void;
}

export interface HomeProps {
  setView: (view: ViewState) => void;
  onSelectMovie: (movie: Movie) => void;
  currentSource: Source;
  sources: Source[];
  onSourceChange: (source: Source) => void;
  onAddCustomSource: (name: string, api: string) => void;
  onRemoveCustomSource: (api: string) => void;
  onUpdateCustomSources: (newCustomSources: Source[]) => void;
  onUpdateDisabledSources: (disabledApis: string[]) => void; // 新增：管理禁用的内置源
  onResetSources: () => void; // 新增：重置源站
  onSearch: (query: string, autoAggregate?: boolean) => void; 
  savedState: HomeViewState;
  onStateUpdate: (updates: Partial<HomeViewState>) => void;
}
