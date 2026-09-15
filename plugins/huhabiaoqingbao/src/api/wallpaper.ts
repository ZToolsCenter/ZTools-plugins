import axios from 'axios';
import type { WallpaperResponse, WallpaperSearchParams } from '../types/wallpaper';
import { translateToEnglish } from './translate';

export const API_KEY = 'o2HeXcnx8mYNojNXik3QAjK3wkfJWjFH';
const BASE_URL = 'https://wallhaven.cc/api/v1';

const wallpaperApi = axios.create({
  baseURL: BASE_URL
});

export const searchWallpapers = async (params: WallpaperSearchParams): Promise<WallpaperResponse> => {
  // 处理搜索关键词
  let searchQuery = params.q || '';
  
  // 如果包含中文，先进行翻译
  if (/[\u4e00-\u9fa5]/.test(searchQuery)) {
    try {
      const translatedQuery = await translateToEnglish(searchQuery);
      
      // 添加一些相关的关键词增强搜索效果
      const keywordEnhancements: { [key: string]: string[] } = {
        'hacker': ['cyberpunk', 'cyber', 'digital'],
        'anime': ['animation', 'cartoon', 'manga'],
        'landscape': ['nature', 'scenery', 'outdoor'],
        'city': ['cityscape', 'urban', 'building'],
        'technology': ['cyber', 'digital', 'tech'],
        'space': ['galaxy', 'cosmos', 'universe'],
        'mechanical': ['machine', 'cyberpunk', 'robot'],
        'art': ['artistic', 'digital art'],
        'abstract': ['minimal', 'modern'],
        'minimalist': ['minimal', 'simple', 'clean'],
        'cyberpunk': ['cyber', 'neon', 'future'],
        'future': ['futuristic', 'sci-fi'],
        'retro': ['vintage', 'classic', 'old'],
        'game': ['gaming', 'video game'],
        'architecture': ['building', 'structure'],
        'car': ['automotive', 'vehicle'],
        'food': ['cuisine', 'cooking'],
        'animal': ['wildlife', 'nature'],
        'people': ['portrait', 'human'],
        'sports': ['athletic', 'exercise']
      };

      // 查找翻译后的关键词是否有对应的增强词
      const words = translatedQuery.toLowerCase().split(/\s+/);
      const enhancedWords = new Set<string>();
      
      words.forEach(word => {
        enhancedWords.add(word);
        if (keywordEnhancements[word]) {
          keywordEnhancements[word].forEach(enhancement => 
            enhancedWords.add(enhancement)
          );
        }
      });

      searchQuery = Array.from(enhancedWords).join(' ');
    } catch (error) {
      console.error('Translation error:', error);
    }
  }

  const searchParams = {
    ...params,
    q: searchQuery,
    apikey: API_KEY,
    // 默认搜索参数
    categories: params.categories || '111', // 所有分类
    purity: params.purity || '100', // 普通级别
    sorting: params.sorting || 'relevance', // 按相关度排序
    order: params.order || 'desc', // 降序
    page: params.page || 1
  };
  
  const { data } = await wallpaperApi.get('/search', { params: searchParams });
  return data;
};

export const getWallpaperById = async (id: string) => {
  const { data } = await wallpaperApi.get(`/w/${id}`, {
    params: { apikey: API_KEY }
  });
  return data;
};

export const getRandomWallpapers = async (params: Omit<WallpaperSearchParams, 'q'>) => {
  return searchWallpapers({ ...params, sorting: 'random' });
}; 