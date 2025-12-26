import { Movie, Category, Source } from '../types';

// Define proxy configurations with their URL construction strategy
interface ProxyConfig {
  url: string;
  type: 'append' | 'query';
}

// Optimized Proxy List
// Priority 1 is now our own Vercel API route which avoids CORS completely and is more reliable.
const PROXIES: ProxyConfig[] = [
  // Priority 1: Vercel Serverless Proxy (Local)
  { url: '/api/proxy?url=', type: 'query' },
  // Priority 2: CodeTabs (External Backup)
  { url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'query' },
  // Priority 3: AllOrigins (External Backup)
  { url: 'https://api.allorigins.win/raw?url=', type: 'query' },
  // Priority 4: CORS Proxy IO (External Backup)
  { url: 'https://corsproxy.io/?', type: 'append' },
];

// Helper to fetch through proxy with fallback
const fetchViaProxy = async (targetUrl: string): Promise<string> => {
  let lastError;
  
  for (const proxy of PROXIES) {
    try {
      let url;
      // Handle URL construction based on proxy type
      if (proxy.type === 'query') {
          url = `${proxy.url}${encodeURIComponent(targetUrl)}`;
      } else {
          // 'append' strategy
          url = `${proxy.url}${targetUrl}`;
      }
      
      // 10s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
          controller.abort(); 
      }, 10000); 
      
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const text = await response.text();
            
            // Critical Check: Validate that response is NOT an HTML error page
            const trimmed = text.trim().toLowerCase();
            if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.includes('404 not found') || trimmed.includes('error')) {
                // If it's the Vercel proxy returning JSON error, we want to skip it
                if (trimmed.includes('missing url parameter') || trimmed.includes('failed to fetch data')) {
                     throw new Error('Proxy API error');
                }
                
                // Allow some XML that might look like HTML if we are desperate, but usually strict errors are bad
                if (trimmed.length < 200 && (trimmed.includes('error') || trimmed.includes('denied'))) {
                    throw new Error('Proxy returned error message');
                }
            }
            
            return text;
        }
        
        throw new Error(`Status ${response.status}`);

      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        // Continue to next proxy
        continue;
      }

    } catch (error) {
      // Don't log expected fallbacks too noisily
      // console.warn(`Proxy ${proxy.url} failed:`, error);
      lastError = error;
    }
  }
  
  throw lastError || new Error(`Failed to fetch ${targetUrl} after trying multiple proxies`);
};

// Helper to ensure images load correctly
const fixImageUrl = (url: string, baseUrl?: string): string => {
  if (!url) return '';
  
  try {
    let result = url.trim();
    result = result.replace(/\{mac_url\}/gi, '');

    if (result.startsWith('//')) {
        result = `https:${result}`;
    } else if (result.startsWith('www.')) {
        result = `https://${result}`;
    } else if (result.startsWith('http')) {
        if ((result.includes('localhost') || result.includes('127.0.0.1')) && baseUrl) {
            try {
                const urlObj = new URL(result);
                const path = urlObj.pathname + urlObj.search;
                let rootOrigin = '';
                if (baseUrl.startsWith('http')) {
                   const parts = baseUrl.split('/');
                   if (parts.length >= 3) rootOrigin = `${parts[0]}//${parts[2]}`;
                }
                if (rootOrigin) {
                    const cleanPath = path.startsWith('/') ? path : `/${path}`;
                    result = `${rootOrigin}${cleanPath}`;
                }
            } catch(e) {}
        }
    } else if (!result.startsWith('http') && !result.startsWith('data:')) {
        if (baseUrl && baseUrl.startsWith('http')) {
            try {
                const origin = new URL(baseUrl).origin;
                const path = result.startsWith('/') ? result : `/${result}`;
                result = `${origin}${path}`;
            } catch(e) {}
        }
    }

    return result;

  } catch (err) {
    return url;
  }
};

// --- XML Parsing Helpers ---

const getTagValue = (element: Element, tagNames: string[]): string => {
    for (const tag of tagNames) {
        const el = element.getElementsByTagName(tag)[0];
        if (el && el.textContent) return el.textContent.trim();
    }
    return "";
};

const sanitizeXml = (xml: string): string => {
    if (!xml) return "";
    return xml
        .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
};

const parseMacCMSXml = (xmlText: string, baseUrl?: string) => {
    try {
        const cleanXml = sanitizeXml(xmlText);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(cleanXml, "text/xml");
        
        // Loosen check: Check for root element 'rss' or 'play' or 'video'
        const hasRss = xmlDoc.getElementsByTagName("rss").length > 0;
        const hasList = xmlDoc.getElementsByTagName("list").length > 0;
        const hasVideo = xmlDoc.getElementsByTagName("video").length > 0;

        if (!hasRss && !hasList && !hasVideo) {
             // Fallback: If no standard tags, check if there's any parsing error
             if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
                 throw new Error("XML Parsing Error");
             }
        }
        
        const videos: Movie[] = [];
        const videoTags = xmlDoc.getElementsByTagName("video"); 
        
        for (let i = 0; i < videoTags.length; i++) {
            const v = videoTags[i];
            
            const id = getTagValue(v, ["id", "vod_id"]);
            const name = getTagValue(v, ["name", "vod_name"]);
            const pic = getTagValue(v, ["pic", "vod_pic", "img"]);
            const type = getTagValue(v, ["type", "type_name"]);
            const year = getTagValue(v, ["year", "vod_year"]);
            const note = getTagValue(v, ["note", "vod_remarks"]);
            const content = getTagValue(v, ["des", "vod_content"]);
            const actor = getTagValue(v, ["actor", "vod_actor"]);
            const director = getTagValue(v, ["director", "vod_director"]);
            
            let playUrl = getTagValue(v, ["vod_play_url"]);
            if (!playUrl) {
                const dl = v.getElementsByTagName("dl")[0];
                if (dl) {
                    const dds = dl.getElementsByTagName("dd");
                    const parts = [];
                    for(let j=0; j<dds.length; j++) {
                        const text = dds[j].textContent;
                        if(text) parts.push(text.trim());
                    }
                    playUrl = parts.join("$$$");
                }
            }

            if (name) {
                videos.push({
                    id,
                    vod_id: id,
                    title: name,
                    image: fixImageUrl(pic, baseUrl),
                    genre: type,
                    year: year || new Date().getFullYear().toString(),
                    badge: note,
                    badgeColor: 'black',
                    vod_content: content,
                    vod_actor: actor,
                    vod_director: director,
                    vod_play_url: playUrl
                });
            }
        }

        const categories: Category[] = [];
        const classTag = xmlDoc.getElementsByTagName("class")[0];
        if (classTag) {
            const tyTags = classTag.getElementsByTagName("ty");
            for (let i = 0; i < tyTags.length; i++) {
                const id = tyTags[i].getAttribute("id");
                const name = tyTags[i].textContent;
                if (id && name) {
                    categories.push({ id, name });
                }
            }
        }

        return { videos, categories };
    } catch (e) {
        throw e;
    }
};

// Fetch Sources List
export const fetchSources = async (): Promise<Source[]> => {
  // HIGH RELIABILITY SOURCES (HTTPS)
  const fallbackSources = [
      { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod/' }, 
      { name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod/' },
      { name: '天空资源', api: 'https://api.tiankongapi.com/api.php/provide/vod/' },
      { name: '默认资源', api: 'https://caiji.maotaizy.cc/api.php/provide/vod/' }
  ];

  try {
    const targetUrl = 'https://a.wokaotianshi.eu.org/jgcj/zyvying.json';
    const jsonText = await fetchViaProxy(targetUrl);
    const data = JSON.parse(jsonText);
    if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
            name: item.name,
            api: item.api
        }));
    }
    return fallbackSources;
  } catch (error) {
    console.error("Error fetching sources:", error);
    return fallbackSources;
  }
};

// Fetch Video List
export const fetchVideoList = async (apiUrl: string, typeId: string = '', page: number = 1): Promise<{ videos: Movie[], categories: Category[] }> => {
  try {
    let targetUrl = `${apiUrl}`;
    // Force ac=list which is usually XML and widely supported
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}ac=list&pg=${page}`;
    
    if (typeId) {
        targetUrl += `&t=${typeId}`;
    }
    
    // 1. Attempt fetch
    const content = await fetchViaProxy(targetUrl);
    
    // 2. Try JSON parse first (some APIs return JSON even if we didn't explicitly ask, or if we did)
    try {
        if (content.trim().startsWith('{')) {
            const data = JSON.parse(content);
            if(data && (data.list || data.class)) {
                const categories: Category[] = [];
                if (data.class && Array.isArray(data.class)) {
                    data.class.forEach((c: any) => {
                        if (c.type_id && c.type_name) {
                            categories.push({ id: c.type_id.toString(), name: c.type_name });
                        }
                    });
                }

                const results: Movie[] = [];
                const list = data.list || [];
                
                for (let i = 0; i < list.length; i++) {
                const v = list[i];
                if (v.vod_name) {
                    results.push({
                    id: v.vod_id.toString(),
                    vod_id: v.vod_id,
                    title: v.vod_name,
                    image: fixImageUrl(v.vod_pic, apiUrl),
                    genre: v.type_name || '',
                    year: v.vod_year || new Date().getFullYear().toString(),
                    badge: v.vod_remarks || '',
                    badgeColor: 'black'
                    });
                }
                }
                return { videos: results, categories };
            }
        }
    } catch(e) {
        // Not JSON, continue to XML
    }

    // 3. Try XML parse
    return parseMacCMSXml(content, apiUrl);

  } catch (error) {
    console.error("Fetch List Error:", error);
    return { videos: [], categories: [] };
  }
};

// Search Videos
export const searchVideos = async (apiUrl: string, query: string): Promise<Movie[]> => {
  try {
    let targetUrl = `${apiUrl}`;
    const separator = targetUrl.includes('?') ? '&' : '?';
    // Use ac=videolist or ac=list with wd parameter
    targetUrl = `${targetUrl}${separator}ac=list&wd=${encodeURIComponent(query)}`;

    const content = await fetchViaProxy(targetUrl);
    
    // Try JSON
    try {
      if (content.trim().startsWith('{')) {
        const data = JSON.parse(content);
        if (data && data.list) {
            return data.list.map((item: any) => ({
            id: item.vod_id.toString(),
            vod_id: item.vod_id,
            title: item.vod_name,
            image: fixImageUrl(item.vod_pic, apiUrl),
            genre: item.type_name || '其他',
            year: item.vod_year || '',
            badge: item.vod_remarks || 'HD',
            badgeColor: 'primary'
            }));
        }
      }
    } catch (e) {}
    
    // Try XML
    const { videos } = parseMacCMSXml(content, apiUrl);
    return videos;
    
  } catch (error) {
    console.warn(`Search failed for ${apiUrl} query ${query}`, error);
    return [];
  }
};

// Get Video Details
export const fetchVideoDetails = async (apiUrl: string, ids: string): Promise<Movie | null> => {
  try {
    let targetUrl = `${apiUrl}`;
    const separator = targetUrl.includes('?') ? '&' : '?';
    // Use ac=detail for details
    targetUrl = `${targetUrl}${separator}ac=detail&ids=${ids}`;

    const content = await fetchViaProxy(targetUrl);
    
    try {
        if (content.trim().startsWith('{')) {
            const data = JSON.parse(content);
            if (data && data.list && data.list.length > 0) {
                const item = data.list[0];
                return {
                    id: item.vod_id.toString(),
                    vod_id: item.vod_id,
                    title: item.vod_name,
                    image: fixImageUrl(item.vod_pic, apiUrl),
                    genre: item.type_name,
                    year: item.vod_year,
                    badge: item.vod_remarks,
                    vod_content: item.vod_content,
                    vod_actor: item.vod_actor,
                    vod_director: item.vod_director,
                    vod_play_url: item.vod_play_url, 
                    rating: 9.0 
                };
            }
        }
    } catch(e) {}
    
    const { videos } = parseMacCMSXml(content, apiUrl);
    return videos.length > 0 ? videos[0] : null;

  } catch (error) {
    console.error("Error fetching details:", error);
    return null;
  }
};

export const parsePlayUrl = (urlStr: string) => {
  if (!urlStr) return [];
  const players = urlStr.split('$$$');
  const selectedPlayer = players[0]; 
  const episodes = selectedPlayer.split('#');
  
  return episodes.map(ep => {
    if (ep.includes('$')) {
        const parts = ep.split('$');
        return { name: parts[0], url: parts[1] };
    } else {
        return { name: '正片', url: ep };
    }
  }).filter(item => item.url && (item.url.includes('.m3u8') || item.url.includes('.mp4')));
};