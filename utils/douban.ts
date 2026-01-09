
import { Movie } from '../types';
import { fetchViaProxy } from './api';

// 内存缓存，避免重复请求
const imageCache = new Map<string, string | null>();

// 豆瓣图片代理服务
const DOUBAN_PROXY = 'https://api.yangzirui.com/proxy/';

// 辅助函数：为豆瓣图片添加代理
const wrapDoubanImage = (url: string) => {
    if (!url) return '';
    // 仅处理 doubanio.com 且未被代理过的链接
    if (url.includes('doubanio.com') && !url.startsWith(DOUBAN_PROXY)) {
        return `${DOUBAN_PROXY}${url}`;
    }
    return url;
};

/**
 * 获取单个电影的高清海报 (替换原失效的 QueryData，目前使用 WMDB)
 * @param id 豆瓣 ID
 */
export const fetchTmdbImage = async (id: string): Promise<string | null> => {
    if (!id) return null;
    
    // 检查缓存
    if (imageCache.has(id)) {
        return imageCache.get(id) || null;
    }

    // WMDB API: 目前最稳定的免费公开源，支持通过豆瓣 ID 获取高清资料
    const fetchFromWmdb = async () => {
        try {
            const controller = new AbortController();
            // 适当放宽超时时间，保证连接成功率
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            // 使用 WMDB 的通用 API
            const res = await fetch(`https://api.wmdb.tv/movie/api?id=${id}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (res.ok) {
                const data = await res.json();
                
                // WMDB 返回格式兼容处理 (可能是数组或对象)
                let entry = null;
                if (Array.isArray(data)) {
                    entry = data.length > 0 ? data[0] : null;
                } else if (data && data.data && Array.isArray(data.data)) {
                    entry = data.data.length > 0 ? data.data[0] : null;
                } else {
                    entry = data;
                }

                if (entry && entry.poster && !entry.poster.includes('noposter')) {
                    return wrapDoubanImage(entry.poster);
                }
            }
        } catch (e) {
            // console.warn("WMDB fetch failed:", e);
        }
        return null;
    };

    try {
        // 随机微小延迟，错峰请求，避免列表页瞬间并发过高导致 429
        const delay = Math.floor(Math.random() * 300);
        await new Promise(resolve => setTimeout(resolve, delay));

        // 直接请求 WMDB
        const poster = await fetchFromWmdb();

        if (poster) {
            imageCache.set(id, poster);
            return poster;
        }
    } catch (e) {
        // console.error("Image fetch error for", id, e);
    }
    
    // 失败或无图也记录缓存
    imageCache.set(id, null);
    return null;
};

/**
 * 独立的豆瓣推荐模块逻辑
 * 仅获取豆瓣列表数据，不阻塞等待高清图片
 */
export const fetchDoubanRecommend = async (type: 'movie' | 'tv', tag: string, pageStart: number = 0): Promise<Movie[]> => {
  try {
    const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=24&page_start=${pageStart}`;
    
    // 豆瓣 API 必须走代理（解决跨域和 Referer 限制）
    const text = await fetchViaProxy(url);
    if (!text || !text.trim().startsWith('{')) return [];
    
    const data = JSON.parse(text);
    if (!data || !data.subjects) return [];
    
    // 立即返回列表，不处理高清图逻辑，提高响应速度
    return data.subjects.map((item: any) => {
        // 默认先尝试将 s_ratio_poster 替换为 l_ratio_poster 以获得稍好的体验
        // 随后 DoubanList 组件会异步调用 fetchTmdbImage 替换为更高清的原图
        let cover = item.cover || '';
        if (cover) {
            cover = cover.replace('s_ratio_poster', 'l_ratio_poster');
            cover = wrapDoubanImage(cover);
        }

        return {
            id: (item.id || '').toString(),
            title: item.title || '',
            year: '', 
            genre: tag,
            image: cover, 
            rating: parseFloat(item.rate) || 0,
            isDouban: true
        };
    });
  } catch (e) {
    console.error("Douban fetch error:", e);
    return [];
  }
};
