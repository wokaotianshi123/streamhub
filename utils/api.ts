
import { Movie, Category, Source } from '../types';

// 代理仅用于 API 请求跨域，不用于图片
interface ProxyConfig {
  url: string;
  type: 'append' | 'query';
}

const PROXIES: ProxyConfig[] = [
  { url: '/api/proxy?url=', type: 'query' },
  { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'query' },
  { url: 'https://corsproxy.io/?', type: 'append' },
  { url: 'https://api.allorigins.win/raw?url=', type: 'query' },
];

const fetchViaProxy = async (targetUrl: string, externalSignal?: AbortSignal): Promise<string> => {
  let lastError = null;
  for (const proxy of PROXIES) {
    if (externalSignal?.aborted) throw new Error("Aborted");
    
    try {
      const url = proxy.type === 'query' ? `${proxy.url}${encodeURIComponent(targetUrl)}` : `${proxy.url}${targetUrl}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); 
      
      // 兼容性处理合并信号
      let signal = controller.signal;
      if (externalSignal) {
        if ((AbortSignal as any).any) {
          signal = (AbortSignal as any).any([controller.signal, externalSignal]);
        } else {
          // 如果不支持 .any，至少传递外部信号以支持手动取消
          signal = externalSignal;
        }
      }

      try {
        const response = await fetch(url, { signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const text = await response.text();
          if (text && text.trim().length > 0) {
            if (text.trim().toLowerCase().startsWith('<!doctype html') || text.trim().toLowerCase().startsWith('<html')) {
               if (!targetUrl.includes('ac=list') && !targetUrl.includes('ac=detail')) {
                   throw new Error("Proxy returned HTML instead of data");
               }
            }
            return text;
          }
          throw new Error("Empty response body");
        }
        throw new Error(`HTTP status ${response.status}`);
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError' && externalSignal?.aborted) throw e;
        lastError = e;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to fetch`);
};

const getBaseHost = (apiUrl: string): string => {
    try {
        const url = new URL(apiUrl);
        return `${url.protocol}//${url.host}`;
    } catch (e) { return ""; }
};

const formatImageUrl = (url: string, apiHost: string, providedDomain?: string): string => {
    if (!url) return "";
    let cleaned = url.trim();
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
    if (cleaned.startsWith('//')) return 'https:' + cleaned;
    const domain = (providedDomain || apiHost).replace(/\/$/, '');
    if (cleaned.startsWith('/')) return domain + cleaned;
    if (!cleaned.includes('://')) return domain + '/' + cleaned;
    return cleaned;
};

const getTagValue = (element: Element, tagNames: string[]): string => {
    for (const tag of tagNames) {
        const el = element.getElementsByTagName(tag)[0];
        if (el && el.textContent) return el.textContent.trim();
    }
    return "";
};

const sanitizeXml = (xml: string): string => {
    if (!xml) return "";
    return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
              .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
};

const mapJsonToMovie = (v: any, apiHost: string, picDomain?: string): Movie => ({
    id: (v.vod_id || v.id || '').toString(),
    vod_id: (v.vod_id || v.id || '').toString(),
    title: v.vod_name || v.name || '',
    image: formatImageUrl(v.vod_pic || v.pic || v.vod_img || v.vod_pic_thumb || '', apiHost, picDomain),
    genre: v.type_name || v.type || '',
    year: v.vod_year || v.year || '',
    badge: v.vod_remarks || v.note || '',
    badgeColor: 'black',
    vod_content: v.vod_content || v.des || '',
    vod_actor: v.vod_actor || v.actor || '',
    vod_director: v.vod_director || v.director || '',
    vod_play_url: v.vod_play_url || ''
});

const parseMacCMSXml = (xmlText: string, apiHost: string) => {
    try {
        const cleanXml = sanitizeXml(xmlText);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");
        const videos: Movie[] = [];
        
        const listTag = xmlDoc.getElementsByTagName("list")[0];
        const picDomain = listTag?.getAttribute("pic_domain") || listTag?.getAttribute("vod_pic_domain") || undefined;
        
        const videoTags = xmlDoc.getElementsByTagName("video"); 
        for (let i = 0; i < videoTags.length; i++) {
            const v = videoTags[i];
            const movieData = {
                id: getTagValue(v, ["id", "vod_id"]),
                name: getTagValue(v, ["name", "vod_name"]),
                pic: getTagValue(v, ["vod_pic", "pic", "vod_img", "img"]),
                type: getTagValue(v, ["type", "type_name"]),
                year: getTagValue(v, ["year", "vod_year"]),
                note: getTagValue(v, ["note", "vod_remarks"]),
                des: getTagValue(v, ["des", "vod_content"]),
                actor: getTagValue(v, ["actor", "vod_actor"]),
                director: getTagValue(v, ["director", "vod_director"]),
                vod_play_url: getTagValue(v, ["vod_play_url"])
            };
            const movie = mapJsonToMovie(movieData, apiHost, picDomain);
            if (!movie.vod_play_url) {
                const dl = v.getElementsByTagName("dl")[0];
                if (dl) {
                    const dds = dl.getElementsByTagName("dd");
                    const parts = [];
                    for(let j=0; j<dds.length; j++) {
                        const text = dds[j].textContent;
                        if(text) parts.push(text.trim());
                    }
                    if (parts.length > 0) movie.vod_play_url = parts.join("$$$");
                }
            }
            if (movie.title) videos.push(movie);
        }

        const categories: Category[] = [];
        const classTags = xmlDoc.getElementsByTagName("class");
        if (classTags.length > 0) {
            const tyTags = classTags[0].getElementsByTagName("ty");
            for (let i = 0; i < tyTags.length; i++) {
                const id = tyTags[i].getAttribute("id");
                const name = tyTags[i].textContent;
                if (id && name) categories.push({ id, name });
            }
        }
        return { videos, categories };
    } catch (e) { throw e; }
};

export const fetchSources = async (): Promise<Source[]> => {
  const fallbackSources = [
      { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/' }, 
      { name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/' },
      { name: '天空资源', api: 'https://api.tiankongapi.com/api.php/provide/vod/' }
  ];
  try {
    const targetUrl = 'https://a.wokaotianshi.eu.org/jgcj/zyvying.json';
    const jsonText = await fetchViaProxy(targetUrl);
    const data = JSON.parse(jsonText);
    if (Array.isArray(data) && data.length > 0) return data.map((item: any) => ({ name: item.name, api: item.api }));
    return fallbackSources;
  } catch (error) {
    return fallbackSources;
  }
};

export const fetchVideoList = async (apiUrl: string, typeId: string = '', page: number = 1): Promise<{ videos: Movie[], categories: Category[] }> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    
    const listUrl = `${apiUrl}${separator}ac=list`;
    const detailUrl = `${apiUrl}${separator}ac=detail&pg=${page}${typeId ? `&t=${typeId}` : ''}`;

    const [listContent, detailContent] = await Promise.all([
        fetchViaProxy(listUrl).catch(() => ""),
        fetchViaProxy(detailUrl).catch(() => "")
    ]);

    let categories: Category[] = [];
    let videos: Movie[] = [];

    if (listContent) {
        try {
            if (listContent.trim().startsWith('{')) {
                const data = JSON.parse(listContent);
                categories = (data.class || []).map((c: any) => ({ 
                    id: (c.type_id || c.id || '').toString(), 
                    name: (c.type_name || c.name || '') 
                })).filter((c: any) => c.id && c.name);
            } else if (listContent.trim().startsWith('<')) {
                categories = parseMacCMSXml(listContent, apiHost).categories;
            }
        } catch (e) { console.warn("Failed to parse categories", e); }
    }

    if (detailContent) {
        try {
            if (detailContent.trim().startsWith('{')) {
                const data = JSON.parse(detailContent);
                const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
                videos = (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
            } else if (detailContent.trim().startsWith('<')) {
                videos = parseMacCMSXml(detailContent, apiHost).videos;
            }
        } catch (e) { console.warn("Failed to parse videos", e); }
    }

    return { videos, categories };
  } catch (error) {
    return { videos: [], categories: [] };
  }
};

export const fetchDoubanSubjects = async (type: 'movie' | 'tv', tag: string, pageStart: number = 0): Promise<Movie[]> => {
  try {
    const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=24&page_start=${pageStart}`;
    const text = await fetchViaProxy(url);
    if (!text || !text.trim().startsWith('{')) return [];
    
    const data = JSON.parse(text);
    if (!data || !data.subjects) return [];
    
    return data.subjects.map((item: any) => ({
      id: (item.id || '').toString(),
      title: item.title || '',
      year: '', 
      genre: tag,
      image: item.cover || '', 
      rating: parseFloat(item.rate) || 0,
      isDouban: true
    }));
  } catch (e) {
    return [];
  }
};

export const searchVideos = async (apiUrl: string, query: string, signal?: AbortSignal): Promise<Movie[]> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=detail&wd=${encodeURIComponent(query)}`;
    const content = await fetchViaProxy(targetUrl, signal);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
        return (data.list || []).map((v: any) => mapJsonToMovie(v, apiHost, picDomain));
    }
    const { videos } = parseMacCMSXml(content, apiHost);
    return videos;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return [];
  }
};

export const fetchVideoDetails = async (apiUrl: string, ids: string): Promise<Movie | null> => {
  try {
    const apiHost = getBaseHost(apiUrl);
    const separator = apiUrl.includes('?') ? '&' : '?';
    const targetUrl = `${apiUrl}${separator}ac=detail&ids=${ids}`;
    const content = await fetchViaProxy(targetUrl);
    
    if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        const picDomain = data.pic_domain || data.vod_pic_domain || undefined;
        if (data.list && data.list.length > 0) return mapJsonToMovie(data.list[0], apiHost, picDomain);
    }
    const { videos } = parseMacCMSXml(content, apiHost);
    return videos.length > 0 ? videos[0] : null;
  } catch (error) {
    return null;
  }
};

export const parsePlayUrl = (urlStr: string) => {
  if (!urlStr) return [];
  const playerRawLists = urlStr.split('$$$');
  const candidates = playerRawLists.map(rawList => {
      return rawList.split('#').map(ep => {
          const trimmed = ep.trim();
          if (!trimmed) return null;
          let name = '正片', url = '';
          const splitIdx = trimmed.indexOf('$');
          if (splitIdx > -1) {
              name = trimmed.substring(0, splitIdx);
              url = trimmed.substring(splitIdx + 1);
          } else {
              url = trimmed;
          }
          url = url.trim();
          if (url.startsWith('//')) url = 'https:' + url;
          return { name: name.trim(), url };
      }).filter((item): item is {name: string, url: string} => 
          !!item && !!item.url && (item.url.startsWith('http') || item.url.startsWith('https'))
      );
  });
  let bestList = candidates.find(list => list.some(ep => ep.url.includes('.m3u8'))) || 
                 candidates.find(list => list.some(ep => ep.url.includes('.mp4'))) || 
                 candidates.find(list => list.length > 0);
  return bestList || [];
};
