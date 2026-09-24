import axios from 'axios';
import type { VideoApiResponse, VideoCategoryId, VideoCategory } from '../types';

// 老接口的响应类型
interface VideoResponse {
  code: number;
  msg: string;
  data: {
    video: string;
  };
}

// 视频分类列表
export const VIDEO_CATEGORIES: VideoCategory[] = [
  { id: 'jk', name: 'JK系列', description: 'JK风格视频', icon: '🌸' },
  { id: 'YuMeng', name: '欲梦系列', description: '欲梦风格视频', icon: '🌙' },
  { id: 'NvDa', name: '女大系列', description: '大学生风格', icon: '🎓' },
  { id: 'NvGao', name: '女高系列', description: '高中生风格', icon: '🏫' },
  { id: 'ReWu', name: '热舞系列', description: '舞蹈视频', icon: '💃' },
  { id: 'QingCun', name: '清纯系列', description: '清纯风格', icon: '🌼' },
  { id: 'YuZu', name: '玉足系列', description: '玉足视频', icon: '👠' },
  { id: 'SheJie', name: '蛇姐系列', description: '蛇姐风格', icon: '🐍' },
  { id: 'ChuanDa', name: '穿搭系列', description: '时尚穿搭', icon: '👗' },
  { id: 'GaoZhiLiangXiaoJieJie', name: '高质量小姐姐', description: '高质量美女视频', icon: '✨' },
  { id: 'HanFu', name: '汉服系列', description: '传统汉服', icon: '🏎️' },
  { id: 'HeiSi', name: '黑丝系列', description: '黑丝视频', icon: '🧿' },
  { id: 'BianZhuang', name: '变装系列', description: '变装视频', icon: '🎭' },
  { id: 'LuoLi', name: '萝莉系列', description: '萝莉风格', icon: '🎀' },
  { id: 'TianMei', name: '甜妹系列', description: '甜美风格', icon: '🍭' },
  { id: 'BaiSi', name: '白丝系列', description: '白丝视频', icon: '☁️' }
];

// 获取分类视频
export const getCategoryVideo = async (categoryId: VideoCategoryId): Promise<VideoApiResponse> => {
  try {
    const response = await axios.get(`/api/video/ksvideo`, {
      params: {
        type: 'json',  // 使用json格式获取视频链接
        id: categoryId
      },
      timeout: 10000,
      headers: {
        'Accept': 'application/json, text/plain, */*',
      }
    });
    
    console.log('API响应:', response.data);
    
    // 检查API响应格式
    if (response.data && typeof response.data === 'object') {
      // 如果返回的是JSON对象
      if (response.data.status === 'success' && response.data.link) {
        return {
          code: 200,
          msg: 'success',
          data: {
            video: response.data.link
          }
        };
      } else if (response.data.video) {
        // 如果直接有video字段
        return {
          code: 200,
          msg: 'success',
          data: {
            video: response.data.video
          }
        };
      }
    }
    
    // 如果是其他格式，尝试作为错误处理
    throw new Error('API返回格式不正确');
    
  } catch (error: any) {
    console.error('获取视频失败:', error);
    
    // 如果是网络错误或CORS错误，尝试备用方案
    if (error.code === 'ECONNABORTED' || error.message?.includes('CORS') || error.message?.includes('Network Error')) {
      console.log('尝试备用API...');
      return await getBackupVideo();
    }
    
    throw {
      code: 500,
      msg: error.message || '网络错误，请稍后重试',
      data: null
    };
  }
};

// 备用视频API
const getBackupVideo = async (): Promise<VideoApiResponse> => {
  try {
    // 使用原来的API作为备用
    const response = await getGirlVideo();
    return {
      code: response.code,
      msg: response.msg,
      data: response.data
    };
  } catch (error) {
    throw {
      code: 500,
      msg: '所有视频源都无法访问，请检查网络连接',
      data: null
    };
  }
};

// 获取随机视频（默认为jk分类）
export const getRandomVideo = async (): Promise<VideoApiResponse> => {
  const randomCategory = VIDEO_CATEGORIES[Math.floor(Math.random() * VIDEO_CATEGORIES.length)];
  return getCategoryVideo(randomCategory.id as VideoCategoryId);
};

// 兼容旧的API接口
export const getGirlVideo = async (): Promise<VideoResponse> => {
  const response = await axios.get('https://api.52vmy.cn/api/video/girl');
  return response.data;
}; 