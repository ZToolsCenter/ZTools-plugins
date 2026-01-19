import Cookies from "js-cookie";

// 获取 Cookie
export const getCookie = (key: string) => {
  return Cookies.get(key) ?? localStorage.getItem(`cookie-${key}`);
};

// 移除 Cookie
export const removeCookie = (key: string) => {
  Cookies.remove(key);
  localStorage.removeItem(`cookie-${key}`);
};

// 设置 Cookie
export const setCookies = (cookieValue: string) => {
  // URL解码
  let decodedCookie = cookieValue;
  try {
    // 如果包含URL编码字符，尝试解码
    if (cookieValue.includes("%")) {
      decodedCookie = decodeURIComponent(cookieValue);
    }
  } catch (e) {
    console.warn("Cookie URL解码失败，使用原始值:", e);
  }
  // 确保以分号结尾（用于正确分割）
  if (!decodedCookie.endsWith(";")) decodedCookie += ";";
  const cookies = decodedCookie.split(";");
  const date = new Date();
  // 永不过期
  date.setFullYear(date.getFullYear() + 50);
  const expires = `expires=${date.toUTCString()}`;
  // 写入
  cookies.forEach((cookie) => {
    // 跳过空字符串
    const trimmedCookie = cookie.trim();
    if (!trimmedCookie) return;
    const nameValuePair = trimmedCookie.split("=");
    const name = nameValuePair[0]?.trim();
    const value = nameValuePair[1]?.trim();
    // 跳过无效的cookie
    if (!name || !value) return;
    console.info(`name: ${name}, value: ${value}`);
    // 设置 cookie
    document.cookie = `${name}=${value}; ${expires}; path=/`;
    // 保存 cookie
    localStorage.setItem(`cookie-${name}`, value);
  });
};
