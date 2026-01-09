
import { Movie } from '../types';
import { fetchViaProxy } from './api';

/**
 * 独立的豆瓣推荐模块逻辑
 * 包含：豆瓣 API 代理请求 + WMDB 图片直连优化
 */
export const fetchDoubanRecommend = async (type: 'movie' | 'tv', tag: string, pageStart: number = 0): Promise<Movie[]> => {
  try {
    const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=24&page_start=${pageStart}`;
    
    // 豆瓣 API 必须走代理（解决跨域和 Referer 限制）
    const text = await fetchViaProxy(url);
    if (!text || !text.trim().startsWith('{')) return [];
    
    const data = JSON.parse(text);
    if (!data || !data.subjects) return [];
    
    // 并行处理：直接从 WMDB 获取高质量无防盗链图片
    const tasks = data.subjects.map(async (item: any) => {
        // 1. 默认使用豆瓣原图 (作为兜底)
        let imageUrl = item.cover || '';

        // 2. 尝试从 WMDB 获取优化图片
        if (item.id) {
            try {
                // 随机延迟，避免瞬间并发过高
                const delay = Math.floor(Math.random() * 2000);
                await new Promise(resolve => setTimeout(resolve, delay));

                // 核心修改：直接 Fetch 请求 WMDB (支持 CORS)，不经过代理，速度最快
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                
                const wmdbRes = await fetch(`https://api.wmdb.tv/movie/api?id=${item.id}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (wmdbRes.ok) {
                    const wmdbData = await wmdbRes.json();
                    
                    // 根据 api.wmdb.tv 描述，兼容返回数组或对象的情况
                    const entry = (wmdbData.data && Array.isArray(wmdbData.data) && wmdbData.data.length > 0) 
                                  ? wmdbData.data[0] 
                                  : wmdbData;
                    
                    // 用户指定：提取 poster 字段
                    const poster = entry.poster;

                    // 过滤无效图片
                    if (poster && !poster.includes('noposter')) {
                        imageUrl = poster;
                    }
                }
            } catch (e) {
                // 获取失败时不处理，保持原图
            }
        }

        return {
            id: (item.id || '').toString(),
            title: item.title || '',
            year: '', 
            genre: tag,
            image: imageUrl, 
            rating: parseFloat(item.rate) || 0,
            isDouban: true
        };
    });

    return await Promise.all(tasks);
  } catch (e) {
    console.error("Douban fetch error:", e);
    return [];
  }
};
