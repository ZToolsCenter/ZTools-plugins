import axios from 'axios';
import md5 from 'md5';
import { getBaiduTranslateCredentials, hasBaiduTranslateCredentials } from '@/config/credentials';

const BAIDU_API = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

interface BaiduTranslateResponse {
  from: string;
  to: string;
  trans_result: {
    src: string;
    dst: string;
  }[];
}

export const translateToEnglish = async (text: string): Promise<string> => {
  if (!text || !/[一-龥]/.test(text)) {
    return text;
  }

  const credentials = await getBaiduTranslateCredentials();
  if (!hasBaiduTranslateCredentials(credentials)) {
    return text;
  }

  const salt = Date.now().toString();
  const sign = md5(credentials.appid + text + salt + credentials.key);

  try {
    const response = await axios.get<BaiduTranslateResponse>(BAIDU_API, {
      params: {
        q: text,
        from: 'zh',
        to: 'en',
        appid: credentials.appid,
        salt,
        sign
      }
    });

    if (response.data.trans_result?.[0]?.dst) {
      return response.data.trans_result[0].dst.toLowerCase();
    }

    return text;
  } catch (error) {
    console.error('Translation error:', error);
    return text;
  }
};
