
import React, { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Movie, HomeProps, Source } from '../types';
import MovieCard from '../components/MovieCard';
import DoubanList from './DoubanList';
import { Icon } from '../components/Icon';
import { fetchVideoList, fetchDoubanSubjects, fetchViaProxy } from '../utils/api';
import { 
  getHistory, 
  addToHistory, 
  clearHistory, 
  removeFromHistory,
  getFavorites,
  clearFavorites,
  removeFromFavorites,
  getCustomDoubanTags,
  addCustomDoubanTagToStorage,
  removeCustomDoubanTagFromStorage,
  exportSourcesData,
  importSourcesData,
  exportFullBackup,
  importFullBackup,
  getDisabledSourceApis,
  getAccelerationConfig,
  setAccelerationConfig
} from '../utils/storage';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

const REMOTE_SOURCE_PRESETS = [
    { name: '默认采集源', url: 'https://a.wokaotianshi.eu.org/jgcj/zcying.json' },
    { name: '精简源(代理)', url: 'https://lunatvz.wofuck.dpdns.org/?format=1&source=jingjian&prefix=https://cfkua.wokaotianshi.eu.org/' },
    { name: '备用采集源', url: 'https://a.wokaotianshi.eu.org/jgcj/zyvying.json' }
];

interface MaintenanceStats {
    duplicates: number;
    dead: number;
    total: number;
    cleanedList: Source[];
    deadApis: string[];
    duplicateApis: string[];
}

interface ExtendedHomeProps extends HomeProps {
  allSources: Source[]; 
}

const Home: React.FC<ExtendedHomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  allSources, 
  onSourceChange,
  onAddCustomSource,
  onRemoveCustomSource,
  onUpdateCustomSources,
  onUpdateDisabledSources,
  onResetSources,
  onSearch,
  savedState,
  onStateUpdate
}) => {
  const [history, setHistory] = useState<Movie[]>([]);
  const [favorites, setFavorites] = useState<Movie[]>([]);
  const [mode, setMode] = useState<'SOURCE' | 'DOUBAN' | 'FAVORITE' | 'SETTINGS'>(savedState.isDoubanMode ? 'DOUBAN' : 'SOURCE');
  
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearFav, setConfirmClearFav] = useState(false);
  
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceApi, setNewSourceApi] = useState('');

  const [customDoubanTags, setCustomDoubanTags] = useState<string[]>([]);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // 设置页面管理状态
  const [selectedApis, setSelectedApis] = useState<Set<string>>(new Set());
  const [isCheckingSources, setIsCheckingSources] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0, name: '' });
  const [maintenanceStats, setMaintenanceStats] = useState<MaintenanceStats | null>(null);

  // 加速配置状态
  const [accConfig, setAccConfig] = useState(() => getAccelerationConfig());
  const [accUrlInput, setAccUrlInput] = useState(accConfig.url);

  // 导入导出相关的状态
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState(REMOTE_SOURCE_PRESETS[0].url);
  const [remoteBackupUrl, setRemoteBackupUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'DOUBAN') {
      const tags = getCustomDoubanTags(savedState.doubanType);
      setCustomDoubanTags(tags);
      if (savedState.doubanMovies.length === 0) {
        loadDoubanData(savedState.doubanType, savedState.doubanTag, 0);
      }
    } else if (mode === 'SOURCE') {
      // 只有在数据为空或源API变更时才触发加载，避免切换回SOURCE时重新加载
      if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true, // 使用源站专用 loading
            error: false
        });
        loadData(currentSource.api, '', 1);
      }
    } else if (mode === 'FAVORITE') {
      setFavorites(getFavorites());
    }
    setHistory(getHistory());
  }, [currentSource.api, mode, savedState.doubanType, savedState.doubanTag]);

  useLayoutEffect(() => {
    if (mode === 'SOURCE' && !savedState.loading && savedState.scrollY > 0) {
        window.scrollTo(0, savedState.scrollY);
    } else if (mode !== 'FAVORITE' && mode !== 'SETTINGS') {
        window.scrollTo(0, 0);
    }
  }, [savedState.loading, mode]);

  const loadData = async (apiUrl: string, typeId: string, pageNum: number) => {
    // 源站加载逻辑：只操作 loading/error
    if (pageNum === 1) onStateUpdate({ loading: true, error: false });
    try {
        const { videos, categories: fetchedCategories } = await fetchVideoList(apiUrl, typeId, pageNum);
        const enhancedVideos = videos.map(v => ({ ...v, sourceApi: apiUrl, sourceName: currentSource.name }));
        const newMovies = pageNum === 1 ? enhancedVideos : [...savedState.movies, ...enhancedVideos];
        onStateUpdate({ 
            movies: newMovies, 
            categories: fetchedCategories.length > 0 ? fetchedCategories : savedState.categories,
            loading: false,
            page: pageNum,
            sourceApi: apiUrl
        });
    } catch (e) { onStateUpdate({ error: true, loading: false }); }
  };

  const loadDoubanData = async (type: 'movie' | 'tv', tag: string, start: number) => {
    // 豆瓣加载逻辑：只操作 doubanLoading/doubanError
    onStateUpdate({ doubanLoading: true, doubanError: false });
    try {
      const results = await fetchDoubanSubjects(type, tag, start);
      onStateUpdate({ 
          doubanMovies: start === 0 ? results : [...savedState.doubanMovies, ...results], 
          doubanLoading: false 
      });
    } catch (e) { 
        onStateUpdate({ doubanLoading: false, doubanError: true }); 
    }
  };

  const handleMovieClick = (movie: Movie) => {
    if (movie.isDouban) {
      onSearch(movie.title, true);
    } else {
      addToHistory(movie);
      onSelectMovie(movie);
      setView('PLAYER');
    }
  };

  const handleAddSourceSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (newSourceName.trim() && newSourceApi.trim()) {
          onAddCustomSource(newSourceName.trim(), newSourceApi.trim());
          setNewSourceName(''); setNewSourceApi(''); setShowAddSource(false);
          alert('源站添加成功');
      }
  };

  const runSourceCheck = async () => {
    if (isCheckingSources) return;
    setIsCheckingSources(true);
    setMaintenanceStats(null);
    
    const totalToMaintenace = allSources.length;
    if (totalToMaintenace === 0) {
        alert('当前没有源站可供检测');
        setIsCheckingSources(false);
        return;
    }

    setCheckProgress({ current: 0, total: totalToMaintenace, name: '准备开始全量扫描...' });

    const seenApis = new Set<string>();
    const workingSources: Source[] = [];
    const deadApis: string[] = [];
    const duplicateApis: string[] = [];
    let duplicatesCount = 0;
    let deadCount = 0;

    for (let i = 0; i < allSources.length; i++) {
        const s = allSources[i];
        setCheckProgress({ current: i + 1, total: totalToMaintenace, name: `检测: ${s.name}` });

        if (seenApis.has(s.api)) {
            duplicatesCount++;
            duplicateApis.push(s.api);
            continue;
        }

        try {
            const separator = s.api.includes('?') ? '&' : '?';
            const testUrl = `${s.api}${separator}ac=list`;
            const result = await fetchViaProxy(testUrl);
            if (result && (result.includes('vod') || result.includes('list') || result.includes('class') || result.includes('code":200'))) {
                workingSources.push(s);
                seenApis.add(s.api);
            } else {
                deadCount++;
                deadApis.push(s.api);
            }
        } catch (err) {
            deadCount++;
            deadApis.push(s.api);
        }
    }

    setMaintenanceStats({
        duplicates: duplicatesCount,
        dead: deadCount,
        total: totalToMaintenace,
        cleanedList: workingSources,
        deadApis: deadApis,
        duplicateApis: duplicateApis
    });
    setIsCheckingSources(false);
  };

  const confirmCleanup = () => {
      if (!maintenanceStats) return;
      if (confirm(`检测完成！\n- 发现失效源: ${maintenanceStats.dead} 个\n- 发现重复项: ${maintenanceStats.duplicates} 个\n\n是否应用清理计划？`)) {
          const finalCustoms = maintenanceStats.cleanedList.filter(s => s.isCustom);
          onUpdateCustomSources(finalCustoms);
          onUpdateDisabledSources(maintenanceStats.deadApis);
          setMaintenanceStats(null);
          alert('源列表已优化');
      }
  };

  // --- 批量操作逻辑 ---
  const handleSelectAll = () => setSelectedApis(new Set(allSources.map(s => s.api)));
  const handleDeselectAll = () => setSelectedApis(new Set());

  const handleBatchEnable = (enable: boolean) => {
      if (selectedApis.size === 0) return;
      const currentDisabled = new Set(getDisabledSourceApis());
      selectedApis.forEach(api => {
          if (enable) currentDisabled.delete(api);
          else currentDisabled.add(api);
      });
      onUpdateDisabledSources(Array.from(currentDisabled));
      setSelectedApis(new Set());
  };

  const handleBatchDelete = () => {
      if (selectedApis.size === 0) return;
      if (confirm(`确定删除选中的 ${selectedApis.size} 个源？(仅对自定义源有效)`)) {
          const customs = allSources.filter(s => s.isCustom && !selectedApis.has(s.api));
          onUpdateCustomSources(customs);
          setSelectedApis(new Set());
      }
  };

  const toggleSourceEnabled = (api: string, currentEnabled: boolean) => {
      const currentDisabled = new Set(getDisabledSourceApis());
      if (currentEnabled) currentDisabled.add(api);
      else currentDisabled.delete(api);
      onUpdateDisabledSources(Array.from(currentDisabled));
  };

  const handleHandleToggleSelect = (api: string) => {
      const next = new Set(selectedApis);
      if (next.has(api)) next.delete(api);
      else next.add(api);
      setSelectedApis(next);
  };

  // --- 加速设置逻辑 ---
  const saveAcceleration = () => {
      setAccelerationConfig(accUrlInput.trim(), accConfig.enabled);
      setAccConfig({ ...accConfig, url: accUrlInput.trim() });
      alert('加速地址已保存');
  };

  const toggleAcceleration = () => {
      const newState = !accConfig.enabled;
      setAccelerationConfig(accConfig.url, newState);
      setAccConfig({ ...accConfig, enabled: newState });
      alert(newState ? '加速播放已启用' : '加速播放已禁用');
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {}
  };

  const handleSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string);
              importSourcesData(json);
              alert('源列表导入成功');
              window.location.reload();
          } catch (err) { alert('导入失败：无效的 JSON 文件'); }
      };
      reader.readAsText(file);
  };

  const handleRemoteSourceImport = async () => {
    if (!remoteSourceUrl.trim()) return;
    setIsImporting(true);
    try {
        const text = await fetchViaProxy(remoteSourceUrl.trim());
        const json = JSON.parse(text);
        importSourcesData(json);
        alert('远程源同步成功');
        window.location.reload();
    } catch (err) {
        alert('远程导入失败：请检查链接有效性或 JSON 格式');
    } finally {
        setIsImporting(false);
    }
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const json = JSON.parse(event.target?.result as string);
              const success = importFullBackup(json);
              if (success) {
                  alert('全量数据还原成功，即将刷新页面');
                  window.location.reload();
              } else { alert('还原失败：数据结构不正确'); }
          } catch (err) { alert('还原失败：无效的 JSON 文件'); }
      };
      reader.readAsText(file);
  };

  const handleRemoteBackupImport = async () => {
    if (!remoteBackupUrl.trim()) return;
    setIsImporting(true);
    try {
        const text = await fetchViaProxy(remoteBackupUrl.trim());
        const json = JSON.parse(text);
        const success = importFullBackup(json);
        if (success) {
            alert('全量远程数据同步成功，即将刷新页面');
            window.location.reload();
        } else {
            alert('数据校验失败：非法的备份文件格式');
        }
    } catch (err) {
        alert('远程备份同步失败：请检查链接有效性');
    } finally {
        setIsImporting(false);
    }
  };

  const handleRemoveTag = (tag: string) => {
    const updated = removeCustomDoubanTagFromStorage(savedState.doubanType, tag);
    setCustomDoubanTags(updated);
    if (savedState.doubanTag === tag) {
      const defaultTag = savedState.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS[0] : ORIGINAL_TV_TAGS[0];
      onStateUpdate({ doubanTag: defaultTag, doubanMovies: [] });
    }
  };

  const handleClearFavs = () => {
    if (confirmClearFav) {
      clearFavorites();
      setFavorites([]);
      setConfirmClearFav(false);
    } else {
      setConfirmClearFav(true);
      setTimeout(() => setConfirmClearFav(false), 3000);
    }
  };

  const handleRemoveFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFromFavorites(id);
    setFavorites(getFavorites());
  };

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagName.trim()) {
      const updated = addCustomDoubanTagToStorage(savedState.doubanType, newTagName.trim());
      setCustomDoubanTags(updated);
      setNewTagName('');
      setShowAddTag(false);
    }
  };

  // 辅助函数：处理类型切换
  const handleDoubanTypeChange = (type: 'movie' | 'tv') => {
      if (savedState.doubanType !== type) {
          const defaultTag = type === 'movie' ? ORIGINAL_MOVIE_TAGS[0] : ORIGINAL_TV_TAGS[0];
          onStateUpdate({ 
              doubanType: type, 
              doubanTag: defaultTag, 
              doubanMovies: [] 
          });
      }
  };
  
  return (
    <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full animate-fadeIn">
      
      {/* 顶部主切换栏 */}
      <section className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-300">
             <div className="flex bg-gray-100 dark:bg-slate-900/50 p-1 rounded-xl w-full sm:w-auto overflow-x-auto hide-scrollbar">
                <button 
                    onClick={() => { setMode('SOURCE'); onStateUpdate({ isDoubanMode: false }); }}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'SOURCE' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="dns" className="text-lg" />源站
                </button>
                <button 
                    onClick={() => { setMode('DOUBAN'); onStateUpdate({ isDoubanMode: true }); }}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'DOUBAN' ? 'bg-pink-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="auto_awesome" className="text-lg" />豆瓣
                </button>
                <button 
                    onClick={() => setMode('FAVORITE')}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'FAVORITE' ? 'bg-amber-500 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="bookmark" className="text-lg" />收藏
                </button>
                <button 
                    onClick={() => setMode('SETTINGS')}
                    className={`flex-shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'SETTINGS' ? 'bg-gray-800 text-white shadow-lg dark:bg-slate-100 dark:text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Icon name="settings" className="text-lg" />设置
                </button>
             </div>

             {mode === 'SOURCE' && (
                <div className="relative w-full sm:w-auto">
                   <button onClick={() => setIsSourceMenuOpen(!isSourceMenuOpen)} className="w-full flex items-center justify-between gap-3 bg-gray-50 dark:bg-slate-900 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-all cursor-pointer">
                      <div className="flex items-center gap-2"><Icon name="settings_input_component" className="text-blue-500" /><span className="truncate max-w-[120px]">{currentSource.name}</span></div>
                      <Icon name="expand_more" className={`transition-transform ${isSourceMenuOpen ? 'rotate-180' : ''}`} />
                   </button>
                   {isSourceMenuOpen && (
                      <><div className="fixed inset-0 z-10" onClick={() => setIsSourceMenuOpen(false)}></div><div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-20 overflow-hidden">
                        <div className="max-h-96 overflow-y-auto custom-scrollbar">
                            <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 dark:bg-slate-900/50">可用线路</div>
                            {sources.map((s, idx) => (
                                <button key={idx} onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50' : 'text-gray-700 dark:text-gray-200'}`}>
                                    <span className="truncate flex-1 mr-2">{s.name}</span>
                                    {currentSource.api === s.api && <Icon name="check" className="text-xs" />}
                                </button>
                            ))}
                        </div>
                        <button onClick={() => { setMode('SETTINGS'); setIsSourceMenuOpen(false); }} className="w-full py-3 text-[10px] font-bold text-gray-400 hover:bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-2 uppercase tracking-wider">管理源站列表</button>
                      </div></>
                   )}
                </div>
             )}
          </div>
      </section>

      {/* 动态内容展示 */}
      {mode === 'SETTINGS' ? (
        <section className="min-h-[60vh] animate-fadeIn space-y-8 pb-20">
            {/* ... 设置页面内容 ... */}
            {/* 顶层工具栏：数据同步与备份 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 1. 数据同步（源列表） */}
                <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-xl flex items-center justify-center">
                                <Icon name="cloud_sync" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold dark:text-white">数据同步</h3>
                                <p className="text-[10px] text-gray-500">同步您的自定义源</p>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <button onClick={exportSourcesData} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-gray-300 rounded-lg text-[10px] font-bold border border-gray-100 dark:border-gray-700 hover:bg-blue-50 transition-all">导出本地</button>
                            <button onClick={() => sourceFileRef.current?.click()} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-gray-300 rounded-lg text-[10px] font-bold border border-gray-100 dark:border-gray-700 hover:bg-blue-50 transition-all">导入本地</button>
                            <input type="file" ref={sourceFileRef} onChange={handleSourceUpload} accept=".json" className="hidden" />
                        </div>
                    </div>
                    {/* 远程源导入框 */}
                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex-1 flex gap-2">
                             <select
                                className="w-24 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-700 rounded-xl px-2 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                                onChange={(e) => {
                                    if(e.target.value) setRemoteSourceUrl(e.target.value);
                                }}
                                value={REMOTE_SOURCE_PRESETS.find(p => p.url === remoteSourceUrl) ? remoteSourceUrl : ""}
                             >
                                 <option value="" disabled>预设...</option>
                                 {REMOTE_SOURCE_PRESETS.map((p, idx) => (
                                     <option key={idx} value={p.url}>{p.name}</option>
                                 ))}
                                 {!REMOTE_SOURCE_PRESETS.find(p => p.url === remoteSourceUrl) && <option value={remoteSourceUrl} disabled>自定义</option>}
                             </select>
                            <input 
                                type="url" 
                                placeholder="输入远程源 JSON 链接..." 
                                className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                                value={remoteSourceUrl}
                                onChange={(e) => setRemoteSourceUrl(e.target.value)}
                            />
                        </div>
                        <button 
                            onClick={handleRemoteSourceImport}
                            disabled={isImporting || !remoteSourceUrl}
                            className={`w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${isImporting ? 'opacity-50' : 'hover:bg-blue-700 active:scale-95'}`}
                        >
                            <Icon name={isImporting ? "sync" : "cloud_download"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                            网络导入
                        </button>
                    </div>
                </div>

                {/* 2. 全量维护（一键备份） */}
                <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-xl flex items-center justify-center">
                                <Icon name="backup" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold dark:text-white">全量维护</h3>
                                <p className="text-[10px] text-gray-500">备份历史、收藏、源站等数据</p>
                            </div>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <button onClick={exportFullBackup} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-gray-300 rounded-lg text-[10px] font-bold border border-gray-100 dark:border-gray-700 hover:bg-amber-50 transition-all">保存备份</button>
                            <button onClick={() => backupFileRef.current?.click()} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-gray-300 rounded-lg text-[10px] font-bold border border-gray-100 dark:border-gray-700 hover:bg-amber-50 transition-all">还原备份</button>
                            <input type="file" ref={backupFileRef} onChange={handleBackupUpload} accept=".json" className="hidden" />
                        </div>
                    </div>
                    {/* 远程备份还原框 */}
                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <input 
                            type="url" 
                            placeholder="输入全量备份 JSON 链接..." 
                            className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-amber-500 outline-none dark:text-white"
                            value={remoteBackupUrl}
                            onChange={(e) => setRemoteBackupUrl(e.target.value)}
                        />
                        <button 
                            onClick={handleRemoteBackupImport}
                            disabled={isImporting || !remoteBackupUrl}
                            className={`px-4 py-2 rounded-xl bg-amber-600 text-white text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${isImporting ? 'opacity-50' : 'hover:bg-amber-700 active:scale-95'}`}
                        >
                            <Icon name={isImporting ? "sync" : "cloud_sync"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                            远程还原
                        </button>
                    </div>
                </div>

                {/* 3. 加速播放设置 */}
                <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5 md:col-span-2">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 text-green-600 rounded-xl flex items-center justify-center">
                                <Icon name="bolt" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold dark:text-white">加速播放 (CDN/代理前置)</h3>
                                <p className="text-[10px] text-gray-500">为每个播放链接添加前置链接，提升加载速度</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
                             <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold uppercase ${accConfig.enabled ? 'text-green-500' : 'text-gray-400'}`}>
                                    {accConfig.enabled ? '已启用' : '已禁用'}
                                </span>
                                <button 
                                    onClick={toggleAcceleration}
                                    className={`w-10 h-5 rounded-full relative transition-all duration-300 ${accConfig.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <div className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ${accConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                </button>
                             </div>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <input 
                            type="url" 
                            placeholder="输入加速前置链接 (默认: https://cfkua.wokaotianshi.eu.org)..." 
                            className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-xs focus:ring-1 focus:ring-green-500 outline-none dark:text-white"
                            value={accUrlInput}
                            onChange={(e) => setAccUrlInput(e.target.value)}
                        />
                        <button 
                            onClick={saveAcceleration}
                            className="px-6 py-2.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                            <Icon name="save" className="text-sm" />
                            保存修改
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-400 italic">注：启用后，播放链接将变为：[前置链接]/[原始链接]（全局生效）</p>
                </div>
            </div>

            {/* 核心管理列表 */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden flex flex-col">
                {/* 列表头部操作 */}
                <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-slate-900/80 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap gap-2">
                            <div className="flex bg-white dark:bg-slate-800 rounded-xl p-1 border border-gray-200 dark:border-gray-700">
                                <button 
                                    onClick={handleSelectAll}
                                    className="px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5"
                                >
                                    <Icon name="done_all" className="text-blue-500" /> <span className="hidden sm:inline">全选</span>
                                </button>
                                <button 
                                    onClick={handleDeselectAll}
                                    className="px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 border-l border-gray-100 dark:border-gray-700"
                                >
                                    <Icon name="close" className="text-red-500" /> <span className="hidden sm:inline">取消</span>
                                </button>
                            </div>
                            <span className="text-[10px] sm:text-[11px] text-gray-400 font-bold bg-gray-100 dark:bg-slate-800 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700">已选 {selectedApis.size}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={onResetSources} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-500 border border-red-100 hover:bg-red-50 transition-all">重置默认</button>
                            <button onClick={() => setShowAddSource(true)} className="px-3 sm:px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] sm:text-xs font-bold shadow-md hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-1.5">
                                <Icon name="add_link" className="text-sm" /> 新增
                            </button>
                            <button onClick={runSourceCheck} disabled={isCheckingSources} className="px-3 sm:px-4 py-1.5 bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg text-[10px] sm:text-xs font-bold flex items-center gap-1.5">
                                <Icon name={isCheckingSources ? "sync" : "health_and_safety"} className={isCheckingSources ? "animate-spin" : ""} />
                                <span className="hidden sm:inline">检测</span>
                            </button>
                        </div>
                    </div>

                    {selectedApis.size > 0 && (
                        <div className="flex flex-wrap items-center gap-2 animate-fadeIn pt-2 border-t border-gray-100 dark:border-gray-800">
                            <button onClick={() => handleBatchEnable(true)} className="flex-1 sm:flex-none px-3 py-1.5 bg-green-500 text-white rounded-lg text-[10px] font-bold shadow-sm hover:bg-green-600 flex items-center justify-center gap-1"><Icon name="visibility" className="text-sm" /> 启用</button>
                            <button onClick={() => handleBatchEnable(false)} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-500 text-white rounded-lg text-[10px] font-bold shadow-sm hover:bg-gray-600 flex items-center justify-center gap-1"><Icon name="visibility_off" className="text-sm" /> 禁用</button>
                            <button onClick={handleBatchDelete} className="flex-1 sm:flex-none px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-bold shadow-sm hover:bg-red-700 flex items-center justify-center gap-1"><Icon name="delete_sweep" className="text-sm" /> 删除</button>
                        </div>
                    )}
                </div>

                {/* 状态反馈 */}
                {isCheckingSources && (
                    <div className="px-6 py-3 bg-blue-50/50 dark:bg-blue-900/5 border-b border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between text-[10px] font-black text-blue-600 uppercase mb-1.5">
                            <span>扫描进度 ({checkProgress.current}/{checkProgress.total})</span>
                            <span className="animate-pulse truncate max-w-[50%]">{checkProgress.name}</span>
                        </div>
                        <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-900/20 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${(checkProgress.current / checkProgress.total) * 100}%` }}></div>
                        </div>
                    </div>
                )}

                {maintenanceStats && !isCheckingSources && (
                    <div className="px-4 sm:px-6 py-4 bg-green-50 dark:bg-green-900/10 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fadeIn">
                        <div className="text-[11px] sm:text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-2">
                            <Icon name="check_circle" className="text-lg" />
                            扫描完成：发现 {maintenanceStats.dead} 个失效，{maintenanceStats.duplicates} 个重复。
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <button onClick={() => setMaintenanceStats(null)} className="flex-1 sm:flex-none px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-500 rounded-lg text-xs font-bold border border-gray-200 dark:border-gray-700">忽略</button>
                            <button onClick={confirmCleanup} className="flex-1 sm:flex-none px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold shadow-md">应用优化</button>
                        </div>
                    </div>
                )}

                {/* 线路单列列表 - 响应式优化 */}
                <div className="flex-1 overflow-y-auto max-h-[700px] custom-scrollbar">
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {(() => {
                            const seenApis = new Set<string>();
                            const disabledApis = new Set(getDisabledSourceApis());

                            return allSources.map((s, idx) => {
                                const isDuplicate = seenApis.has(s.api);
                                seenApis.add(s.api);
                                const isEnabled = !disabledApis.has(s.api);
                                const isSelected = selectedApis.has(s.api);

                                return (
                                    <div 
                                        key={`${s.api}-${idx}`}
                                        className={`flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 px-4 sm:px-6 py-4 sm:py-5 hover:bg-gray-50/80 dark:hover:bg-slate-900/80 transition-all ${!isEnabled ? 'bg-gray-50/20 opacity-60' : ''}`}
                                    >
                                        <div className="flex items-center gap-4 sm:gap-6">
                                            {/* 选择 */}
                                            <button 
                                                onClick={() => handleHandleToggleSelect(s.api)}
                                                className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}
                                            >
                                                {isSelected && <Icon name="check" className="text-base font-black" />}
                                            </button>

                                            {/* 图标与基本信息 */}
                                            <div className="flex items-center gap-3 min-w-0 flex-grow">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${s.isCustom ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30'}`}>
                                                    <Icon name={s.isCustom ? "person" : "verified"} />
                                                </div>
                                                <div className="flex items-center gap-2 truncate">
                                                    <span className={`text-sm font-bold truncate ${isEnabled ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                                                        {s.name}
                                                    </span>
                                                    {currentSource.api === s.api && <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[8px] bg-green-500 text-white font-bold uppercase tracking-tighter">当前</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* API URL 与 操作按钮 - 在移动端占据独立一行 */}
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-grow sm:justify-between min-w-0 pl-10 sm:pl-0">
                                            <div 
                                                onClick={() => copyToClipboard(s.api)}
                                                className="text-[10px] text-gray-400 font-mono break-all sm:truncate max-w-full sm:max-w-xs md:max-w-md lg:max-w-xl hover:text-blue-500 cursor-pointer transition-colors"
                                                title="点击复制 URL"
                                            >
                                                {s.api}
                                            </div>

                                            <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 border-t sm:border-t-0 border-gray-100 dark:border-gray-800 pt-3 sm:pt-0">
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-[11px] font-black tracking-tight ${isEnabled ? 'text-emerald-500' : 'text-gray-400'}`}>
                                                        {isEnabled ? '已启用' : '已停用'}
                                                    </span>
                                                    <button 
                                                        onClick={() => toggleSourceEnabled(s.api, isEnabled)}
                                                        className={`w-11 h-6 sm:w-12 sm:h-6.5 rounded-full relative transition-all duration-300 ${isEnabled ? 'bg-emerald-500 shadow-md shadow-emerald-500/40' : 'bg-gray-300 dark:bg-slate-700'}`}
                                                    >
                                                        <div className={`absolute top-1 left-1 bg-white w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full shadow-lg transform transition-transform duration-300 ease-out ${isEnabled ? 'translate-x-5 sm:translate-x-5.5' : 'translate-x-0'}`}></div>
                                                    </button>
                                                </div>

                                                <div className="flex items-center gap-1 sm:gap-2">
                                                    <button onClick={() => copyToClipboard(s.api)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-700 rounded-xl transition-all">
                                                        <Icon name={copiedUrl === s.api ? "check" : "content_copy"} className="text-lg" />
                                                    </button>
                                                    {s.isCustom && (
                                                        <button onClick={() => onRemoveCustomSource(s.api)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-700 rounded-xl transition-all">
                                                            <Icon name="delete_outline" className="text-lg" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>
            </div>

            <div className="p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-900/20">
                <h4 className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-3 flex items-center gap-2">
                    <Icon name="info" className="text-lg" /> 进阶提示
                </h4>
                <ul className="text-xs text-blue-600/70 dark:text-blue-400/70 space-y-2 list-disc pl-4 font-medium">
                    <li>使用左侧<b>多选框</b>配合顶部的“批量启用/禁用”可快速清理大量不常用的采集源。</li>
                    <li>所有配置变更均会实时同步至<b>本地缓存</b>，刷新页面不会丢失自定义线路。</li>
                    <li><b>远程导入</b>：填入公开的 JSON 链接，可实时拉取社区维护的最新线路列表。</li>
                </ul>
            </div>
        </section>
      ) : (
        <>
          {mode !== 'FAVORITE' && (
            // 只有源站模式才显示源站分类，豆瓣分类已集成到 DoubanList 组件中
            mode === 'SOURCE' && (
                <nav className="mb-8 overflow-x-auto hide-scrollbar">
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => { onStateUpdate({ activeCategoryId: '', movies: [] }); loadData(currentSource.api, '', 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === '' ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>全部</button>
                        {savedState.categories.map(cat => (
                            <button key={cat.id} onClick={() => { onStateUpdate({ activeCategoryId: cat.id, movies: [] }); loadData(currentSource.api, cat.id, 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{cat.name}</button>
                        ))}
                    </div>
                </nav>
            )
          )}

          {history.length > 0 && mode !== 'FAVORITE' && mode !== 'DOUBAN' && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold flex items-center gap-2"><Icon name="history" className="text-blue-500" /> 播放历史</h2><button onClick={() => { if(confirmClear){ clearHistory(); setHistory([]); setConfirmClear(false); } else { setConfirmClear(true); setTimeout(()=>setConfirmClear(false), 3000); } }} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"><Icon name={confirmClear ? "warning" : "delete_outline"} className="text-sm" />{confirmClear ? "确认清除" : "清空"}</button></div>
              <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
                {history.slice(0, 10).map(m => (
                    <div key={m.id} className="min-w-[140px] max-w-[140px] relative group">
                        <MovieCard movie={m} viewType="HOME" onClick={() => handleMovieClick(m)} />
                        <button 
                            onClick={(e) => { e.stopPropagation(); removeFromHistory(m.id); setHistory(getHistory()); }} 
                            className="absolute top-2 right-2 w-7 h-7 bg-white dark:bg-slate-700 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-lg z-20 flex items-center justify-center border border-gray-100 dark:border-gray-600 hover:scale-110 active:scale-95"
                            title="删除此记录"
                        >
                            <Icon name="close" className="text-base font-bold"/>
                        </button>
                    </div>
                ))}
              </div>
            </section>
          )}

          <section className="min-h-[60vh]">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <span className={`w-1.5 h-6 rounded-full ${mode === 'DOUBAN' ? 'bg-pink-500' : mode === 'FAVORITE' ? 'bg-amber-500' : 'bg-blue-600'}`}></span>
                    {mode === 'DOUBAN' ? `豆瓣推荐: ${savedState.doubanTag}` : mode === 'FAVORITE' ? '我的收藏' : (savedState.activeCategoryId ? savedState.categories.find(c => c.id === savedState.activeCategoryId)?.name : '最新更新')}
                </h2>
                {mode === 'FAVORITE' && (
                   <button onClick={handleClearFavs} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${confirmClearFav ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500'}`}>
                       <Icon name={confirmClearFav ? "priority_high" : "delete_sweep"} className="text-lg" />
                       {confirmClearFav ? "确认清空收藏" : "清空全部"}
                   </button>
                )}
            </div>

            {mode === 'DOUBAN' ? (
                // 独立的豆瓣列表组件，集成导航与网格
                <DoubanList 
                    movies={savedState.doubanMovies}
                    loading={savedState.doubanLoading}
                    error={savedState.doubanError}
                    type={savedState.doubanType}
                    tag={savedState.doubanTag}
                    customTags={customDoubanTags}
                    onTypeChange={handleDoubanTypeChange}
                    onTagChange={(tag) => onStateUpdate({ doubanTag: tag, doubanMovies: [] })}
                    onAddTag={() => setShowAddTag(true)}
                    onRemoveTag={handleRemoveTag}
                    onLoadMore={() => loadDoubanData(savedState.doubanType, savedState.doubanTag, savedState.doubanMovies.length)}
                    onRetry={() => loadDoubanData(savedState.doubanType, savedState.doubanTag, 0)}
                    onMovieClick={handleMovieClick}
                />
            ) : mode === 'FAVORITE' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                    {favorites.map((m) => (
                        <div key={m.id} className="relative group">
                            <MovieCard movie={m} viewType="HOME" onClick={() => handleMovieClick(m)} />
                            <button onClick={(e) => handleRemoveFavorite(e, m.id)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-20"><Icon name="bookmark_remove" className="text-lg" /></button>
                        </div>
                    ))}
                    {favorites.length === 0 && <div className="col-span-full py-20 flex flex-col items-center text-gray-400 italic"><Icon name="collections_bookmark" className="text-5xl mb-4" /><p>收藏夹空空如也，快去收藏喜欢的影视吧</p></div>}
                </div>
            ) : savedState.loading && savedState.movies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500"></div><p className="text-sm text-gray-400">正在努力加载中...</p></div>
            ) : savedState.error && savedState.movies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Icon name="error_outline" className="text-5xl text-gray-300 mb-4" />
                    <p className="text-gray-500 mb-2">加载失败</p>
                    <button onClick={() => loadData(currentSource.api, savedState.activeCategoryId, savedState.page)} className="text-blue-500 hover:underline">点击重试</button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                        {savedState.movies.map((movie, idx) => (
                            <MovieCard key={`${movie.sourceApi}-${movie.id}-${idx}`} movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
                        ))}
                    </div>
                    {savedState.movies.length > 0 && (
                        <div className="mt-16 flex justify-center pb-12"><button onClick={() => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1)} disabled={savedState.loading} className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${savedState.loading ? 'bg-gray-100 dark:bg-slate-800 text-gray-400' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200'}`}>{savedState.loading ? '加载中...' : '加载更多内容'}</button></div>
                    )}
                </>
            )}
          </section>
        </>
      )}

      {/* 模态框逻辑 */}
      {showAddSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"><div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddSource(false)}></div><form onSubmit={handleAddSourceSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="add_circle" className="text-blue-500" />添加自定义采集源</h3>
                <div className="space-y-4">
                    <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">源站名称</label><input autoFocus required type="text" placeholder="例如：量子资源" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" value={newSourceName} onChange={e => setNewSourceName(e.target.value)}/></div>
                    <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">API 地址</label><input required type="url" placeholder="https://.../api.php/provide/vod/" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" value={newSourceApi} onChange={e => setNewSourceApi(e.target.value)}/></div>
                </div>
                <div className="flex gap-3 mt-8"><button type="button" onClick={() => setShowAddSource(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button><button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-lg">确认添加</button></div>
            </form></div>
      )}

      {showAddTag && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddTag(false)}></div>
          <form onSubmit={handleAddTagSubmit} className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-gray-700">
            <h3 className="text-xl font-bold dark:text-white mb-6 flex items-center gap-2"><Icon name="new_label" className="text-pink-500" />添加自定义标签</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1 ml-1">标签名称</label>
                <input autoFocus required type="text" placeholder="例如：宫崎骏" className="w-full bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 transition-all dark:text-white" value={newTagName} onChange={e => setNewTagName(e.target.value)}/>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={() => setShowAddTag(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">取消</button>
              <button type="submit" className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-pink-600 text-white shadow-lg">确认添加</button>
            </div>
          </form>
        </div>
      )}
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }
      `}</style>
    </main>
  );
};

export default Home;
