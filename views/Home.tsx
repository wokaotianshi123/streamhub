
import React, { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Movie, Category, HomeProps, Source } from '../types';
import MovieCard from '../components/MovieCard';
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
  importFullBackup
} from '../utils/storage';

const ORIGINAL_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const ORIGINAL_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

const Home: React.FC<HomeProps> = ({ 
  setView, 
  onSelectMovie, 
  currentSource, 
  sources, 
  onSourceChange,
  onAddCustomSource,
  onRemoveCustomSource,
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

  // 导入导出相关的状态
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState('');
  const [remoteBackupUrl, setRemoteBackupUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (mode === 'DOUBAN') {
      const tags = getCustomDoubanTags(savedState.doubanType);
      setCustomDoubanTags(tags);
      if (savedState.doubanMovies.length === 0) {
        loadDoubanData(savedState.doubanType, savedState.doubanTag, 0);
      }
    } else if (mode === 'SOURCE') {
      if (currentSource.api && (currentSource.api !== savedState.sourceApi || savedState.movies.length === 0)) {
        onStateUpdate({
            sourceApi: currentSource.api,
            movies: [],
            categories: [],
            activeCategoryId: '',
            page: 1,
            loading: true,
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
    onStateUpdate({ loading: true });
    try {
      const results = await fetchDoubanSubjects(type, tag, start);
      onStateUpdate({ doubanMovies: start === 0 ? results : [...savedState.doubanMovies, ...results], loading: false });
    } catch (e) { onStateUpdate({ loading: false, error: true }); }
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
      }
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

  const handleRemoveTag = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
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

  const originalTags = savedState.doubanType === 'movie' ? ORIGINAL_MOVIE_TAGS : ORIGINAL_TV_TAGS;
  const officialSources = sources.filter(s => !s.isCustom);
  const customSources = sources.filter(s => s.isCustom);

  return (
    <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full animate-fadeIn">
      
      {/* 顶部主切换栏 */}
      <section className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
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
                        <div className="max-h-80 overflow-y-auto">
                            <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 dark:bg-slate-900/50">推荐源</div>
                            {officialSources.map((s, idx) => (
                                <button key={idx} onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50' : 'text-gray-700 dark:text-gray-200'}`}>{s.name}{currentSource.api === s.api && <Icon name="check" className="text-xs" />}</button>
                            ))}
                            {customSources.length > 0 && (
                                <><div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-gray-700">自定义源</div>
                                {customSources.map((s, idx) => (
                                    <div key={idx} className="group flex items-center border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50"><button onClick={() => { onSourceChange(s); setIsSourceMenuOpen(false); }} className={`flex-grow text-left px-4 py-3 text-sm ${currentSource.api === s.api ? 'text-blue-600 bg-blue-50' : 'text-gray-700 dark:text-gray-200'}`}>{s.name}</button><button onClick={(e) => { e.stopPropagation(); onRemoveCustomSource(s.api); }} className="px-3 py-3 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="delete_outline" className="text-sm" /></button></div>
                                ))}</>
                            )}
                        </div>
                        <button onClick={() => { setShowAddSource(true); setIsSourceMenuOpen(false); }} className="w-full py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 border-t border-gray-100 flex items-center justify-center gap-2"><Icon name="add" />添加自定义源</button>
                      </div></>
                   )}
                </div>
             )}
          </div>
      </section>

      {/* 动态内容展示 */}
      {mode === 'SETTINGS' ? (
        <section className="min-h-[60vh] animate-fadeIn">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-3">
                <span className="w-1.5 h-6 rounded-full bg-gray-800 dark:bg-white"></span>系统设置
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* 采集源导入导出 */}
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600">
                            <Icon name="source" className="text-2xl" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 dark:text-white">源导入与导出</h3>
                            <p className="text-xs text-gray-500 mt-1 text-balance">管理您的采集站资源列表</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={exportSourcesData} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-gray-100 dark:border-gray-700">
                            <Icon name="download" className="text-xl" />
                            <span className="text-xs font-bold">导出源站</span>
                        </button>
                        <button onClick={() => sourceFileRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-gray-100 dark:border-gray-700">
                            <Icon name="upload" className="text-xl" />
                            <span className="text-xs font-bold">导入本地源</span>
                        </button>
                        <input type="file" ref={sourceFileRef} onChange={handleSourceUpload} accept=".json" className="hidden" />
                    </div>

                    {/* 网络导入 - 源 */}
                    <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex gap-2">
                            <input 
                                type="url" 
                                placeholder="输入远程源 JSON 链接..." 
                                className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                                value={remoteSourceUrl}
                                onChange={(e) => setRemoteSourceUrl(e.target.value)}
                            />
                            <button 
                                onClick={handleRemoteSourceImport}
                                disabled={isImporting || !remoteSourceUrl}
                                className={`px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold transition-all flex items-center gap-2 ${isImporting ? 'opacity-50' : 'hover:bg-blue-700 active:scale-95'}`}
                            >
                                <Icon name={isImporting ? "sync" : "cloud_download"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                                {isImporting ? '处理中' : '网络导入'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* 一键备份与还原 */}
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-amber-600">
                            <Icon name="backup" className="text-2xl" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 dark:text-white">数据一键备份</h3>
                            <p className="text-xs text-gray-500 mt-1 text-balance">备份源、收藏、历史等所有数据</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={exportFullBackup} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all border border-gray-100 dark:border-gray-700">
                            <Icon name="save" className="text-xl" />
                            <span className="text-xs font-bold">全量备份</span>
                        </button>
                        <button onClick={() => backupFileRef.current?.click()} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all border border-gray-100 dark:border-gray-700">
                            <Icon name="restore" className="text-xl" />
                            <span className="text-xs font-bold">全量还原</span>
                        </button>
                        <input type="file" ref={backupFileRef} onChange={handleBackupUpload} accept=".json" className="hidden" />
                    </div>

                    {/* 网络还原 - 备份 */}
                    <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex gap-2">
                            <input 
                                type="url" 
                                placeholder="输入全量备份 JSON 链接..." 
                                className="flex-1 bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-xs focus:ring-1 focus:ring-amber-500 outline-none dark:text-white"
                                value={remoteBackupUrl}
                                onChange={(e) => setRemoteBackupUrl(e.target.value)}
                            />
                            <button 
                                onClick={handleRemoteBackupImport}
                                disabled={isImporting || !remoteBackupUrl}
                                className={`px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold transition-all flex items-center gap-2 ${isImporting ? 'opacity-50' : 'hover:bg-amber-700 active:scale-95'}`}
                            >
                                <Icon name={isImporting ? "sync" : "cloud_sync"} className={`text-sm ${isImporting ? 'animate-spin' : ''}`} />
                                {isImporting ? '恢复中' : '远程还原'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-12 p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/20">
                <h4 className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
                    <Icon name="info" className="text-lg" />提示事项
                </h4>
                <ul className="text-xs text-blue-600/70 dark:text-blue-400/70 space-y-1.5 list-disc pl-4">
                    <li>导出文件为 JSON 格式，包含源站名称及 API 链接。</li>
                    <li><strong>网络导入</strong> 支持任何公开的 JSON 地址，系统会自动尝试解决跨域问题。</li>
                    <li>导入全量备份时会覆盖当前所有浏览数据，建议操作前先进行导出备份。</li>
                    <li>一键备份包含：播放记录、收藏夹、自定义源及自定义豆瓣标签。</li>
                </ul>
            </div>
        </section>
      ) : (
        <>
          {mode !== 'FAVORITE' && (
            <nav className="mb-8 overflow-x-auto hide-scrollbar">
                {mode === 'SOURCE' ? (
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => { onStateUpdate({ activeCategoryId: '', movies: [] }); loadData(currentSource.api, '', 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === '' ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>全部</button>
                        {savedState.categories.map(cat => (
                            <button key={cat.id} onClick={() => { onStateUpdate({ activeCategoryId: cat.id, movies: [] }); loadData(currentSource.api, cat.id, 1); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.activeCategoryId === cat.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{cat.name}</button>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        {originalTags.map(tag => (
                            <button key={tag} onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${savedState.doubanTag === tag ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 ring-1 ring-pink-500' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'}`}>{tag}</button>
                        ))}
                        {customDoubanTags.map(tag => (
                            <div key={tag} className="group relative"><button onClick={() => onStateUpdate({ doubanTag: tag, doubanMovies: [] })} className={`pl-4 pr-8 py-1.5 rounded-full text-sm font-medium transition-all border-dashed ${savedState.doubanTag === tag ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-white dark:bg-slate-800 text-gray-600 border border-gray-300'}`}>{tag}</button><button onClick={(e) => handleRemoveTag(e, tag)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"><Icon name="close" className="text-[14px]" /></button></div>
                        ))}
                        <button onClick={() => setShowAddTag(true)} className="w-8 h-8 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-pink-500 hover:border-pink-500 transition-all"><Icon name="add" className="text-xl" /></button>
                    </div>
                )}
            </nav>
          )}

          {history.length > 0 && mode !== 'FAVORITE' && (
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

            {mode === 'FAVORITE' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                    {favorites.map((m) => (
                        <div key={m.id} className="relative group">
                            <MovieCard movie={m} viewType="HOME" onClick={() => handleMovieClick(m)} />
                            <button onClick={(e) => handleRemoveFavorite(e, m.id)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-20"><Icon name="bookmark_remove" className="text-lg" /></button>
                        </div>
                    ))}
                    {favorites.length === 0 && <div className="col-span-full py-20 flex flex-col items-center text-gray-400 italic"><Icon name="collections_bookmark" className="text-5xl mb-4" /><p>收藏夹空空如也，快去收藏喜欢的影视吧</p></div>}
                </div>
            ) : savedState.loading && (mode === 'DOUBAN' ? savedState.doubanMovies.length === 0 : savedState.movies.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4"><div className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${mode === 'DOUBAN' ? 'border-pink-500' : 'border-blue-500'}`}></div><p className="text-sm text-gray-400">正在努力加载中...</p></div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-10 sm:gap-x-6">
                        {(mode === 'DOUBAN' ? savedState.doubanMovies : savedState.movies).map((movie, idx) => (
                            <MovieCard key={`${movie.id}-${idx}`} movie={movie} viewType="HOME" onClick={() => handleMovieClick(movie)} />
                        ))}
                    </div>
                    {(mode === 'DOUBAN' ? savedState.doubanMovies : savedState.movies).length > 0 && (
                        <div className="mt-16 flex justify-center pb-12"><button onClick={mode === 'DOUBAN' ? () => loadDoubanData(savedState.doubanType, savedState.doubanTag, savedState.doubanMovies.length) : () => loadData(currentSource.api, savedState.activeCategoryId, savedState.page + 1)} disabled={savedState.loading} className={`flex items-center gap-3 px-10 py-3.5 rounded-full font-bold transition-all shadow-lg ${savedState.loading ? 'bg-gray-100 dark:bg-slate-800 text-gray-400' : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-white border border-gray-200'}`}>加载更多内容</button></div>
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
    </main>
  );
};

export default Home;
