import React, { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { dbStorage, copyText } from '../utils/platform';

/**
 * AppContext - 全局状态管理
 * 
 * 提供全局功能:
 * - setting: 色值去 "#" 的设置状态
 * - onColorClick: 点击颜色后的全局处理(复制+Snackbar+操作按钮)
 * - formatCopiedColor: 根据setting格式化复制的颜色值
 */

interface ColorMessageData {
  color: string;
  key: number;
  body?: string;
}

interface AppContextValue {
  setting: boolean;
  setSetting: (value: boolean) => void;
  onColorClick: (eventOrColor: any) => void;
  showMessage: (msg: string) => void;
  colorMessage: ColorMessageData | null;
  openMessage: boolean;
  setOpenMessage: (value: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppContextProvider');
  return ctx;
};

/**
 * 从 rgb(r, g, b) 格式的backgroundColor解析出HEX颜色值
 * setting=true时去掉#前缀，setting=false时保留#前缀
 */
function colorFromBackgroundColor(backgroundColor: string, setting: boolean): string {
  const match = backgroundColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!match) return backgroundColor;
  const hex = match.slice(1).map((n: string) => parseInt(n, 10).toString(16).padStart(2, "0")).join("");
  return `${setting ? "" : "#"}${hex}`;
}

/**
 * 将HEX颜色转为 rgb(r, g, b) 格式
 */
export function hexToRgbString(hex: string): string {
  hex = hex.slice(1);
  const re = new RegExp(`.{1,${hex.length >= 6 ? 2 : 1}}`, "g");
  let result = hex.match(re);
  if (result && result[0].length === 1) {
    result = result.map((o: string) => o + o);
  }
  if (!result) return "";
  return `rgb${result.length === 4 ? "a" : ""}(${result.map((o: string, s: number) =>
    s < 3 ? parseInt(o, 16) : Math.round(parseInt(o, 16) / 255 * 1000) / 1000
  ).join(", ")})`;
}

export const AppContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [setting, setSettingState] = useState<boolean>(() => {
    return !!dbStorage.getItem('setting');
  });
  const [colorMessage, setColorMessage] = useState<ColorMessageData | null>(null);
  const [openMessage, setOpenMessage] = useState(false);

  // 全局颜色点击处理
  // 兼容两种调用方式: 1) 传入DOM event对象 2) 传入颜色字符串
  const onColorClick = useCallback((eventOrColor: any) => {
    let color: string;
    if (eventOrColor && eventOrColor.currentTarget && eventOrColor.currentTarget.style) {
      // 从DOM event的backgroundColor提取
      color = colorFromBackgroundColor(eventOrColor.currentTarget.style.backgroundColor, setting);
    } else if (typeof eventOrColor === 'string') {
      // 字符串方式: 直接使用
      color = eventOrColor;
    } else {
      return;
    }

    copyText(color);
    setColorMessage({ color, key: Date.now() });
    setOpenMessage(true);
  }, [setting]);

  // showMessage
  const showMessage = useCallback((msg: string) => {
    setColorMessage({ key: Date.now(), body: msg, color: '' });
    setOpenMessage(true);
  }, []);

  // 处理设置checkbox变更
  const handleSettingChange = useCallback((checked: boolean) => {
    if (checked) {
      dbStorage.setItem('setting', true);
    } else {
      dbStorage.removeItem('setting');
    }
    setSettingState(checked);
  }, []);

  // 暴露全局路由函数给main.tsx的onPluginEnter使用
  React.useEffect(() => {
    window.__platformNavigate = (path: string, state?: any) => {
      navigate(path, { state });
    };
    return () => { window.__platformNavigate = null; };
  }, [navigate]);

  return (
    <AppContext.Provider value={{
      setting,
      setSetting: handleSettingChange,
      onColorClick,
      showMessage,
      colorMessage,
      openMessage,
      setOpenMessage
    }}>
      {children}
    </AppContext.Provider>
  );
};

export default AppContext;
