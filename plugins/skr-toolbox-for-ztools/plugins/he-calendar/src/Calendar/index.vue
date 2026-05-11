<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import dayjs from 'dayjs';
import { SolarDay, LunarDay, SolarTerm, LegalHoliday, SolarFestival, LunarFestival, Taboo, PengZu, FetusDay } from 'tyme4ts';
import { ChevronLeft, ChevronRight, Palette, Settings, Github, ExternalLink, User, Sun, Moon, Monitor, CalendarDays } from 'lucide-vue-next';
import { projectConfig } from '../config';

const props = defineProps(['enterAction']);

const currentMonth = ref(dayjs());
const selectedDate = ref(dayjs());
const currentTheme = ref('auto'); // 默认为智能主题
const showYearPicker = ref(false);
const showMonthPicker = ref(false);
const showThemePicker = ref(false);
const showSettings = ref(false);
// 统一的存储工具函数，优先使用 uTools dbStorage，降级到 localStorage
const getStorageItem = (key, defaultValue) => {
  if (window.utools && window.utools.dbStorage) {
    const value = window.utools.dbStorage.getItem(key);
    return value !== undefined && value !== null ? value : defaultValue;
  }
  return localStorage.getItem(key) || defaultValue;
};

const setStorageItem = (key, value) => {
  if (window.utools && window.utools.dbStorage) {
    window.utools.dbStorage.setItem(key, value);
  }
  localStorage.setItem(key, value);
};

const colorMode = ref(getStorageItem('calendar-color-mode', 'auto')); // light, dark, auto
const weekStartDay = ref(parseInt(getStorageItem('calendar-week-start', '0')));
const previewTheme = ref(null);
const yearPickerOffset = ref(0); // 年份选择器的偏移量

// 节假日显示开关（四大分类，法定假日始终显示）
const showSolarFestivals = ref(getStorageItem('calendar-show-solar-festivals', 'true') === 'true'); // 公历现代节日
const showLunarFestivals = ref(getStorageItem('calendar-show-lunar-festivals', 'true') === 'true'); // 农历传统节日
const showInternationalFestivals = ref(getStorageItem('calendar-show-international-festivals', 'true') === 'true'); // 国际节日
const showSolarTerms = ref(getStorageItem('calendar-show-solar-terms', 'true') === 'true'); // 二十四节气
const showFestivalPanel = ref(false); // 节日配置面板展开状态

// 节日弹出卡片状态
const showFestivalCard = ref(false);
const selectedFestival = ref(null);
const festivalCardPosition = ref({ x: 0, y: 0 });

// 节日倒数列表面板状态
const showFestivalList = ref(false);

// 国际节日数据（公历）- tyme4ts不包含这些，需手动定义
const internationalFestivals = {
  '2-14': '情人节',
  '4-1': '愚人节',
  '10-31': '万圣节',
  '11-11': '光棍节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
};

// 节日简介数据
const festivalDescriptions = {
  // 农历传统节日
  '春节': '中华民族最隆重的传统佳节，象征团圆与新年新气象',
  '元宵节': '正月十五闹元宵，赏花灯、吃汤圆、猜灯谜',
  '龙头节': '二月二龙抬头，民间理发、祭龙祈雨的传统节日',
  '上巳节': '三月三踏青节，古时水边祓禊、曲水流觞的日子',
  '清明节': '扫墓祭祖、踏青郊游，缅怀先人的传统节日',
  '端午节': '五月初五纪念屈原，赛龙舟、吃粽子、挂艾草',
  '七夕节': '牛郎织女相会日，中国传统的情人节',
  '中元节': '七月十五祭祀祖先，民间俗称鬼节',
  '中秋节': '八月十五月圆人团圆，赏月、吃月饼',
  '重阳节': '九月初九登高望远，敬老爱老的传统节日',
  '寒衣节': '十月初一祭祀先人，送寒衣的民俗节日',
  '下元节': '十月十五祭祀祖先，道教水官解厄之日',
  '腊八节': '腊月初八喝腊八粥，年味渐浓的开始',
  '小年': '腊月廿三祭灶神，扫尘迎新年',
  '除夕': '一年最后一天，阖家团圆守岁迎新',
  // 公历现代节日
  '元旦': '公历新年第一天，世界多数国家的法定假日',
  '妇女节': '国际劳动妇女节，庆祝女性权益与成就',
  '植树节': '倡导植树造林，绿化祖国的纪念日',
  '劳动节': '国际劳动节，纪念全世界劳动人民的节日',
  '青年节': '纪念五四运动，中国青年的节日',
  '儿童节': '国际儿童节，保障儿童权益的纪念日',
  '建党节': '中国共产党成立纪念日',
  '建军节': '中国人民解放军建军纪念日',
  '教师节': '尊师重教，感恩教师的节日',
  '国庆节': '中华人民共和国成立纪念日',
  // 国际节日
  '情人节': '西方传统情人节，表达爱意的浪漫日子',
  '愚人节': '西方民间节日，相互开玩笑的欢乐日',
  '母亲节': '感恩母亲的节日，五月第二个星期日',
  '父亲节': '感恩父亲的节日，六月第三个星期日',
  '万圣节': '西方传统节日，孩子们装扮讨糖的狂欢夜',
  '光棍节': '源自中国的购物狂欢节，单身者的节日',
  '感恩节': '美国传统节日，家人团聚感恩的日子',
  '平安夜': '圣诞节前夕，西方重要的家庭团聚时刻',
  '圣诞节': '纪念耶稣诞生的西方重要节日',
  // 二十四节气
  '立春': '春季开始，万物复苏，一年农事之始',
  '雨水': '降雨开始增多，气温回升，春耕备播',
  '惊蛰': '春雷始鸣，蛰虫惊醒，万物萌动',
  '春分': '昼夜平分，春暖花开，农耕繁忙',
  '清明': '天清气明，祭祖扫墓，踏青时节',
  '清明节': '天清气明，祭祖扫墓，踏青时节',
  '谷雨': '雨生百谷，播种移苗，春茶采摘',
  '立夏': '夏季开始，万物繁茂，农作物生长旺季',
  '小满': '麦类等夏熟作物籽粒开始饱满',
  '芒种': '有芒作物成熟，抢收抢种最忙时节',
  '夏至': '白昼最长，阳气至极，盛夏来临',
  '小暑': '天气开始炎热，但尚未到最热时候',
  '大暑': '一年中最热的时期，酷暑难耐',
  '立秋': '秋季开始，暑去凉来，收获季节',
  '处暑': '暑气渐消，秋意渐浓，早晚转凉',
  '白露': '天气转凉，露水凝结，秋高气爽',
  '秋分': '昼夜平分，秋色正浓，丰收时节',
  '寒露': '露气寒冷，秋深渐寒，菊花盛开',
  '霜降': '天气渐寒，初霜出现，深秋时节',
  '立冬': '冬季开始，万物收藏，准备过冬',
  '小雪': '开始降雪，但雪量不大，天气寒冷',
  '大雪': '降雪量增大，天寒地冻，银装素裹',
  '冬至': '白昼最短，数九寒天，吃饺子习俗',
  '小寒': '天气渐寒，但未到最冷，腊梅初放',
  '大寒': '一年中最冷时期，年关将至',
};

// 获取节日简介
const getFestivalDescription = (name) => {
  return festivalDescriptions[name] || '';
};

// 动态计算的西方节日（如母亲节、父亲节、感恩节）
const getDynamicInternationalFestival = (year, month, day) => {
  // 母亲节：5月第二个星期日
  if (month === 5) {
    const firstDay = new Date(year, 4, 1).getDay();
    const motherDay = firstDay === 0 ? 8 : (14 - firstDay + 1);
    if (day === motherDay) return '母亲节';
  }
  // 父亲节：6月第三个星期日
  if (month === 6) {
    const firstDay = new Date(year, 5, 1).getDay();
    const fatherDay = firstDay === 0 ? 15 : (21 - firstDay + 1);
    if (day === fatherDay) return '父亲节';
  }
  // 感恩节：11月第四个星期四
  if (month === 11) {
    const firstDay = new Date(year, 10, 1).getDay();
    const thanksDay = firstDay <= 4 ? (22 + (4 - firstDay)) : (29 - firstDay + 4);
    if (day === thanksDay) return '感恩节';
  }
  return null;
};

// 获取国际节日
const getInternationalFestival = (year, month, day) => {
  const key = `${month}-${day}`;
  if (internationalFestivals[key]) return internationalFestivals[key];
  return getDynamicInternationalFestival(year, month, day);
};

// 节日名称标准化映射（用于合并相似节日）
const festivalNameMap = {
  // 清明相关
  '清明': '清明节',
  '清明节': '清明节',
  // 劳动节相关
  '劳动节': '劳动节',
  '五一劳动节': '劳动节',
  '国际劳动节': '劳动节',
  // 国庆相关
  '国庆节': '国庆节',
  '国庆': '国庆节',
  // 端午相关
  '端午节': '端午节',
  '端午': '端午节',
  // 中秋相关
  '中秋节': '中秋节',
  '中秋': '中秋节',
  // 春节相关
  '春节': '春节',
  // 元旦相关
  '元旦': '元旦',
  '元旦节': '元旦',
  // 妇女节相关
  '三八妇女节': '妇女节',
  '国际妇女节': '妇女节',
  '妇女节': '妇女节',
  // 儿童节相关
  '六一儿童节': '儿童节',
  '国际儿童节': '儿童节',
  '儿童节': '儿童节',
  // 青年节相关
  '五四青年节': '青年节',
  '青年节': '青年节',
};

// 获取标准化的节日名称
const getNormalizedFestivalName = (name) => {
  return festivalNameMap[name] || name;
};

// 检查两个节日名称是否相同（考虑别名）
const isSameFestival = (name1, name2) => {
  return getNormalizedFestivalName(name1) === getNormalizedFestivalName(name2);
};

// 计算已选节日类型数量（不含法定假日，法定假日始终显示）
const selectedFestivalCount = computed(() => {
  let count = 0;
  if (showSolarFestivals.value) count++;
  if (showLunarFestivals.value) count++;
  if (showInternationalFestivals.value) count++;
  if (showSolarTerms.value) count++;
  return count;
});

// 24节气主题配色（基于中国传统色）
const solarTermThemes = {
  '立春': { name: '立春·春黄', color: '#E9BB4E', bgColor: '#fffbf0', accentColor: '#E9BB4E' },
  '雨水': { name: '雨水·雨绿', color: '#8FCE95', bgColor: '#f0faf1', accentColor: '#6fb876' },
  '惊蛰': { name: '惊蛰·桃红', color: '#F596AA', bgColor: '#fff5f7', accentColor: '#f47c97' },
  '春分': { name: '春分·春蓝', color: '#8DB5D8', bgColor: '#f0f7fc', accentColor: '#6a9bc7' },
  '清明': { name: '清明·桐绿', color: '#85B09A', bgColor: '#f0f7f3', accentColor: '#689b7f' },
  '谷雨': { name: '谷雨·羽紫', color: '#A98BB5', bgColor: '#f7f3f9', accentColor: '#926fa3' },
  '立夏': { name: '立夏·夏黄', color: '#F3C13A', bgColor: '#fffdf0', accentColor: '#e5b12e' },
  '小满': { name: '小满·满红', color: '#ED6D46', bgColor: '#fff5f2', accentColor: '#e55a38' },
  '芒种': { name: '芒种·麦黄', color: '#E9B96E', bgColor: '#fffdf5', accentColor: '#dda855' },
  '夏至': { name: '夏至·星云', color: '#5F8C9F', bgColor: '#f0f6f8', accentColor: '#4a7a8d' },
  '小暑': { name: '小暑·晨紫', color: '#9C89B8', bgColor: '#f7f5fa', accentColor: '#8774a6' },
  '大暑': { name: '大暑·萤黑', color: '#374047', bgColor: '#f5f6f7', accentColor: '#5a6269' },
  '立秋': { name: '立秋·蝉绿', color: '#8FB08A', bgColor: '#f5f9f4', accentColor: '#7a9e74' },
  '处暑': { name: '处暑·谷蓝', color: '#7FA8C9', bgColor: '#f3f7fc', accentColor: '#6594b7' },
  '白露': { name: '白露·鹟黄', color: '#F2BE45', bgColor: '#fffdf2', accentColor: '#e5b133' },
  '秋分': { name: '秋分·秋紫', color: '#A07CAB', bgColor: '#f8f5f9', accentColor: '#8e6899' },
  '寒露': { name: '寒露·菊红', color: '#DB8872', bgColor: '#fdf6f4', accentColor: '#cf7460' },
  '霜降': { name: '霜降·柿红', color: '#DC6B3E', bgColor: '#fff5f1', accentColor: '#d05a2e' },
  '立冬': { name: '立冬·冬黄', color: '#E0A626', bgColor: '#fffcf0', accentColor: '#d19820' },
  '小雪': { name: '小雪·雪青', color: '#B8CDD1', bgColor: '#f7fbfc', accentColor: '#9fb9be' },
  '大雪': { name: '大雪·雪白', color: '#E8E8E8', bgColor: '#fafafa', accentColor: '#a8a8a8' },
  '冬至': { name: '冬至·冬蓝', color: '#5A7C99', bgColor: '#f3f6f9', accentColor: '#4a6a81' },
  '小寒': { name: '小寒·寒青', color: '#6C8F9E', bgColor: '#f4f8f9', accentColor: '#5a7b89' },
  '大寒': { name: '大寒·寒紫', color: '#6A5988', bgColor: '#f5f3f7', accentColor: '#584a73' },
};

const years = computed(() => {
  const currentYear = currentMonth.value.year();
  const start = currentYear - 100 + yearPickerOffset.value; // 前100年
  const result = [];
  for (let i = 0; i < 12; i++) { // 一次显示12个年份（3x4网格）
    const year = start + i;
    if (year >= currentYear - 100 && year <= currentYear + 20) {
      result.push(year);
    }
  }
  return result;
});

const months = [
  { value: 0, label: '一月' },
  { value: 1, label: '二月' },
  { value: 2, label: '三月' },
  { value: 3, label: '四月' },
  { value: 4, label: '五月' },
  { value: 5, label: '六月' },
  { value: 6, label: '七月' },
  { value: 7, label: '八月' },
  { value: 8, label: '九月' },
  { value: 9, label: '十月' },
  { value: 10, label: '十一月' },
  { value: 11, label: '十二月' },
];

const themes = [
  { id: 'auto', name: '智能动态', color: 'linear-gradient(135deg, #8DB5D8 0%, #E9BB4E 100%)' },
  { id: 'default', name: '素雅', color: '#A3D5E0' },
  { id: 'ink', name: '水墨', color: '#111827' },
  { id: 'red', name: '朱红', color: '#b91c1c' },
  { id: 'gold', name: '鎏金', color: '#b45309' },
  { id: 'cyan', name: '黛蓝', color: '#1e40af' },
];

// 获取当前节气（使用 tyme4ts）
const getCurrentSolarTerm = () => {
  const now = new Date();
  const solarDay = SolarDay.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  // 获取当天的节气（如果有）
  const term = solarDay.getTerm();
  if (term) {
    return term.getName();
  }
  // 获取上一个节气
  const termDay = solarDay.getTermDay();
  return termDay.getSolarTerm().getName();
};

// 获取当前节气对应的动态主题名称
const dynamicThemeName = computed(() => {
  const solarTerm = getCurrentSolarTerm();
  const termTheme = solarTermThemes[solarTerm] || solarTermThemes['立春'];
  return termTheme.name;
});

// 判断当前是否处于深色模式
const systemDarkMode = ref(false);

const isDarkMode = computed(() => {
  if (colorMode.value === 'auto') {
    return systemDarkMode.value;
  }
  return colorMode.value === 'dark';
});

// 系统深色模式媒体查询对象
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// 检测系统深色模式（使用 web 原生方式，uTools 官方推荐）
const detectSystemDarkMode = () => {
  return darkModeMediaQuery.matches;
};

// 系统主题变化处理函数
const handleSystemThemeChange = (e) => {
  if (colorMode.value === 'auto') {
    systemDarkMode.value = e.matches;
    applyTheme();
  }
};

// 获取指定主题的配置
const getThemeConfigById = (themeId) => {
  const isDark = isDarkMode.value;
  
  if (themeId === 'auto') {
    const solarTerm = getCurrentSolarTerm();
    const termTheme = solarTermThemes[solarTerm] || solarTermThemes['立春'];
    return {
      id: 'auto',
      primaryColor: termTheme.color,
      bgColor: isDark ? '#1a1a1a' : termTheme.bgColor,
      accentColor: termTheme.accentColor,
      name: termTheme.name,
    };
  }
  
  const themeMap = {
    'default': { primaryColor: '#A3D5E0', bgColor: isDark ? '#1a1a1a' : '#f9fafb', accentColor: '#7db4c4', name: '素雅' },
    'ink': { primaryColor: isDark ? '#9ca3af' : '#111827', bgColor: isDark ? '#111827' : '#f3f4f6', accentColor: isDark ? '#6b7280' : '#374151', name: '水墨' },
    'red': { primaryColor: '#b91c1c', bgColor: isDark ? '#1a1a1a' : '#fff1f2', accentColor: '#b91c1c', name: '朱红' },
    'gold': { primaryColor: '#b45309', bgColor: isDark ? '#1a1a1a' : '#fffbeb', accentColor: '#b45309', name: '鎏金' },
    'cyan': { primaryColor: '#1e40af', bgColor: isDark ? '#1a1a1a' : '#eff6ff', accentColor: '#1e40af', name: '黛蓝' },
  };
  
  return themeMap[themeId] || themeMap['default'];
};

// 计算当前应用的主题（包含预览）
const activeThemeConfig = computed(() => {
  return getThemeConfigById(previewTheme.value || currentTheme.value);
});

// 计算已保存的主题配置
const savedThemeConfig = computed(() => {
  return getThemeConfigById(currentTheme.value);
});

const switchTheme = (themeId) => {
  currentTheme.value = themeId;
  setStorageItem('calendar-theme', themeId);
  applyTheme();
  showThemePicker.value = false; // 选中后隐藏选择列表
};

const parseColor = (color) => {
  const value = color.trim();

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }
    const int = Number.parseInt(hex, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
      a: 1,
    };
  }

  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const [r, g, b, a = '1'] = match[1].split(',').map(part => part.trim());
    return {
      r: Number.parseFloat(r),
      g: Number.parseFloat(g),
      b: Number.parseFloat(b),
      a: Number.parseFloat(a),
    };
  }

  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
};

const toRgba = ({ r, g, b, a = 1 }) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;

const mixColors = (color1, color2, weight = 0.5) => {
  const c1 = typeof color1 === 'string' ? parseColor(color1) : color1;
  const c2 = typeof color2 === 'string' ? parseColor(color2) : color2;
  const w1 = Math.max(0, Math.min(1, weight));
  const w2 = 1 - w1;

  return toRgba({
    r: c1.r * w1 + c2.r * w2,
    g: c1.g * w1 + c2.g * w2,
    b: c1.b * w1 + c2.b * w2,
    a: c1.a * w1 + c2.a * w2,
  });
};

const withAlpha = (color, alpha) => {
  const parsed = typeof color === 'string' ? parseColor(color) : color;
  return toRgba({ ...parsed, a: alpha });
};

// 应用主题
const applyTheme = () => {
  const theme = activeThemeConfig.value;
  const savedTheme = savedThemeConfig.value;
  const root = document.documentElement;
  const isDark = isDarkMode.value;
  
  root.style.setProperty('--primary-color', theme.primaryColor);
  root.style.setProperty('--bg-color', theme.bgColor);
  root.style.setProperty('--accent-color', theme.accentColor);
  root.style.setProperty('--saved-primary-color', savedTheme.primaryColor);

  let textColor = '#1f2937';
  let borderColor = 'rgba(0,0,0,0.06)';
  let hoverBg = 'rgba(0,0,0,0.03)';
  let panelBg = '#ffffff';
  let secondaryText = '#6b7280';
  
  // 夜间模式变量
  if (isDark) {
    textColor = '#e5e7eb';
    root.style.setProperty('--header-bg', '#1e1e1e');
    root.style.setProperty('--cell-bg', '#262626');
    borderColor = 'rgba(255,255,255,0.08)';
    hoverBg = 'rgba(255,255,255,0.05)';
    panelBg = '#1e1e1e';
    secondaryText = '#9ca3af';
    root.style.setProperty('--scrollbar-thumb', 'rgba(255,255,255,0.2)');
  } else {
    root.style.setProperty('--header-bg', '#ffffff');
    root.style.setProperty('--cell-bg', '#ffffff');
    root.style.setProperty('--scrollbar-thumb', 'rgba(0,0,0,0.1)');
  }

  root.style.setProperty('--text-color', textColor);
  root.style.setProperty('--border-color', borderColor);
  root.style.setProperty('--hover-bg', hoverBg);
  root.style.setProperty('--panel-bg', panelBg);
  root.style.setProperty('--secondary-text', secondaryText);

  const almanacLine = mixColors(theme.accentColor, borderColor, 0.18);
  const almanacSoftLine = mixColors(theme.accentColor, borderColor, 0.08);

  root.style.setProperty('--almanac-line', almanacLine);
  root.style.setProperty('--almanac-soft-line', almanacSoftLine);
  root.style.setProperty('--almanac-soft-divider', withAlpha(almanacSoftLine, 0.7));
  root.style.setProperty('--almanac-tint', mixColors(theme.primaryColor, panelBg, 0.04));
  root.style.setProperty('--almanac-strong-tint', mixColors(theme.accentColor, panelBg, 0.06));
  root.style.setProperty('--almanac-gold', mixColors(theme.accentColor, textColor, 0.58));
  root.style.setProperty('--almanac-gold-soft', mixColors(theme.accentColor, secondaryText, 0.32));
  root.style.setProperty('--almanac-shadow-color', withAlpha(theme.accentColor, 0.025));
  root.style.setProperty('--almanac-text-shadow-color', withAlpha(theme.accentColor, 0.1));
  root.style.setProperty('--almanac-board-bg', mixColors(theme.accentColor, panelBg, 0.015));
  root.style.setProperty('--almanac-ganzhi-bg', withAlpha(theme.accentColor, 0.025));
  root.style.setProperty('--almanac-shichen-grid', withAlpha(almanacSoftLine, 0.45));
  root.style.setProperty('--almanac-shichen-ji-bg', mixColors(theme.accentColor, panelBg, 0.08));
  root.style.setProperty('--almanac-shichen-active-ji-bg', mixColors(theme.accentColor, panelBg, 0.14));
  root.style.setProperty('--almanac-shichen-current-bg', mixColors(theme.accentColor, panelBg, 0.12));
  root.style.setProperty('--almanac-shichen-active-xiong-bg', isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
  root.style.setProperty('--almanac-detail-bg', mixColors(theme.accentColor, panelBg, 0.02));
  root.style.setProperty('--almanac-luck-ji-bg', withAlpha(theme.accentColor, 0.065));
  root.style.setProperty('--almanac-luck-xiong-bg', withAlpha(theme.accentColor, 0.03));
};

const switchColorMode = (mode) => {
  colorMode.value = mode;
  setStorageItem('calendar-color-mode', mode);
  applyTheme();
};

// Generate calendar days
const calendarDays = computed(() => {
  const startOfMonth = currentMonth.value.startOf('month');
  
  // Calculate the first day of the calendar grid
  const firstDayOfWeek = startOfMonth.day();
  const daysToSubtract = (firstDayOfWeek - weekStartDay.value + 7) % 7;
  const start = startOfMonth.subtract(daysToSubtract, 'day');
  
  const days = [];
  
  // Create 6 weeks (42 days)
  for (let i = 0; i < 42; i++) {
    const date = start.add(i, 'day');
    
    // 使用 tyme4ts API
    const solarDay = SolarDay.fromYmd(date.year(), date.month() + 1, date.date());
    const lunarDay = solarDay.getLunarDay();
    
    // 法定假日（始终获取，用于显示休/班标记）
    const legalHoliday = solarDay.getLegalHoliday();
    
    // 公历现代节日
    const solarFestival = showSolarFestivals.value ? solarDay.getFestival() : null;
    
    // 农历传统节日
    const lunarFestival = showLunarFestivals.value ? lunarDay.getFestival() : null;
    
    // 国际节日
    const internationalFestival = showInternationalFestivals.value ? getInternationalFestival(date.year(), date.month() + 1, date.date()) : null;
    
    // 节气（只在节气日当天显示）
    const termDay = solarDay.getTermDay();
    const isTermDay = termDay.getDayIndex() === 0; // 第0天表示正好是节气日
    const solarTermName = isTermDay ? termDay.getSolarTerm().getName() : '';
    const displaySolarTerm = showSolarTerms.value ? solarTermName : '';
    
    // 获取农历月和日的中文名称（提前获取，用于节日详情）
    const lunarMonth = lunarDay.getLunarMonth();
    const lunarDayName = lunarDay.getName(); // 如 "初一"、"十五"
    const lunarMonthName = lunarMonth.getName(); // 如 "正月"、"二月"
    const lunarDateDisplay = `${lunarMonthName}${lunarDayName}`;
    const solarDateDisplay = `${date.month() + 1}月${date.date()}日`;
    
    // 合并所有节日用于详情显示（去重）
    const allFestivalsForDetail = [];
    const addedNames = new Set();
    
    const addToDetail = (festival) => {
      const normalizedName = getNormalizedFestivalName(festival.name);
      if (!addedNames.has(normalizedName)) {
        addedNames.add(normalizedName);
        allFestivalsForDetail.push({ ...festival, name: normalizedName });
      }
    };
    
    if (lunarFestival) addToDetail({ name: lunarFestival.getName(), type: 'lunar', dateStr: lunarDateDisplay });
    if (solarFestival) addToDetail({ name: solarFestival.getName(), type: 'solar', dateStr: solarDateDisplay });
    if (solarTermName) addToDetail({ name: solarTermName, type: 'term', dateStr: solarDateDisplay });
    if (internationalFestival) addToDetail({ name: internationalFestival, type: 'international', dateStr: solarDateDisplay });
    
    // 日历格子显示优先级：农历传统节日 > 公历现代节日 > 节气 > 国际节日
    let displayFestival = '';
    if (showLunarFestivals.value && lunarFestival) {
      displayFestival = lunarFestival.getName();
    } else if (showSolarFestivals.value && solarFestival) {
      displayFestival = solarFestival.getName();
    } else if (showSolarTerms.value && solarTermName) {
      displayFestival = solarTermName;
    } else if (showInternationalFestivals.value && internationalFestival) {
      displayFestival = internationalFestival;
    }
    
    // lunarText 用于日历格子显示
    const lunarText = lunarDayName === '初一' ? lunarMonthName : lunarDayName;
    
    days.push({
      date,
      solarDay,
      lunarDay,
      isCurrentMonth: date.month() === currentMonth.value.month(),
      isToday: date.isSame(dayjs(), 'day'),
      isSelected: date.isSame(selectedDate.value, 'day'),
      lunarText: lunarText,
      displayFestival: displayFestival, // 日历格子显示的节日（按优先级）
      allFestivals: allFestivalsForDetail, // 所有节日（用于详情显示）
      holiday: legalHoliday ? { name: legalHoliday.getName(), isWork: legalHoliday.isWork() } : null,
    });
  }
  return days;
});

const baseWeekDays = ['日', '一', '二', '三', '四', '五', '六'];
const weekDays = computed(() => {
  const days = [...baseWeekDays];
  if (weekStartDay.value === 1) {
    const sun = days.shift();
    days.push(sun);
  }
  return days;
});

const nextMonth = () => {
  currentMonth.value = currentMonth.value.add(1, 'month');
};

const prevMonth = () => {
  currentMonth.value = currentMonth.value.subtract(1, 'month');
};

const selectYear = (year) => {
  currentMonth.value = currentMonth.value.year(year);
  showYearPicker.value = false;
  
  // 下次打开时，定位到选中年份的页，并且选中年份在中间
  // 不立即重置，等下次toggleYearPicker时再重新计算
};

const selectMonth = (monthValue) => {
  currentMonth.value = currentMonth.value.month(monthValue);
  showMonthPicker.value = false;
};

const toggleYearPicker = () => {
  showYearPicker.value = !showYearPicker.value;
  showMonthPicker.value = false;
  
  if (showYearPicker.value) {
    // 打开时，让当前年份在页面中间（第6-7个位置）
    const currentYear = currentMonth.value.year();
    const baseYear = currentYear - 100; // 最小年份
    const totalOffset = currentYear - baseYear; // 当前年份相对位置
    
    // 让当前年份显示在第6个位置（中间位置）
    yearPickerOffset.value = Math.max(0, totalOffset - 5);
  }
};

const toggleMonthPicker = () => {
  showMonthPicker.value = !showMonthPicker.value;
  showYearPicker.value = false;
};

const setWeekStartDay = (day) => {
  weekStartDay.value = day;
  setStorageItem('calendar-week-start', day.toString());
};

// 节假日显示开关控制
const toggleSolarFestivals = () => {
  showSolarFestivals.value = !showSolarFestivals.value;
  setStorageItem('calendar-show-solar-festivals', showSolarFestivals.value.toString());
};

const toggleLunarFestivals = () => {
  showLunarFestivals.value = !showLunarFestivals.value;
  setStorageItem('calendar-show-lunar-festivals', showLunarFestivals.value.toString());
};

const toggleInternationalFestivals = () => {
  showInternationalFestivals.value = !showInternationalFestivals.value;
  setStorageItem('calendar-show-international-festivals', showInternationalFestivals.value.toString());
};

const toggleFestivalPanel = () => {
  showFestivalPanel.value = !showFestivalPanel.value;
};

const toggleSolarTerms = () => {
  showSolarTerms.value = !showSolarTerms.value;
  setStorageItem('calendar-show-solar-terms', showSolarTerms.value.toString());
};

const toggleSettings = () => {
  showSettings.value = !showSettings.value;
  if (showSettings.value) {
    showYearPicker.value = false;
    showMonthPicker.value = false;
    showThemePicker.value = false;
  }
};

const toggleThemePicker = () => {
  showThemePicker.value = !showThemePicker.value;
  if (showThemePicker.value) {
    showYearPicker.value = false;
    showMonthPicker.value = false;
    showSettings.value = false;
    showFestivalList.value = false;
  }
};

const closePickers = () => {
  showYearPicker.value = false;
  showMonthPicker.value = false;
  showSettings.value = false;
  showThemePicker.value = false;
  previewTheme.value = null;
  yearPickerOffset.value = 0;
};

// 打开外部链接的统一方法
const openExternalLink = (url) => {
  if (window.utools && window.utools.shellOpenExternal) {
    // uTools 环境下使用 shellOpenExternal API
    window.utools.shellOpenExternal(url);
  } else {
    // Web 环境下使用普通的 window.open
    window.open(url, '_blank');
  }
};

const selectDate = (day) => {
  selectedDate.value = day.date;
};

// 计算选中日期和今天的距离
 const dayDifference = computed(() => {
  const today = dayjs().startOf('day');
  const selected = selectedDate.value.startOf('day');
  const diff = selected.diff(today, 'day');
  
  if (diff === 0) return ''; // 今天不显示
  if (diff > 0) return `${diff}天后`;
  return `${Math.abs(diff)}天前`;
});

let lastScrollTime = 0;
let monthWheelAccumulator = 0;
let lastWheelTime = 0;
let lastMonthChangeTime = 0;

const handleScroll = (e) => {
  const now = Date.now();

  // 如果节日倒数面板打开，不处理滚轮（让面板自己滚动）
  if (showFestivalList.value) {
    return;
  }

  // 如果年份选择器打开，滚轮切换年份页面（保留原有节流）
  if (showYearPicker.value) {
    if (now - lastScrollTime < 300) return;
    if (Math.abs(e.deltaY) < 10) return;

    const direction = e.deltaY > 0 ? 1 : -1;
    const newOffset = yearPickerOffset.value + direction * 6; // 每次翻6个年份（半页）

    // 限制范围：前100年到后20年
    const minOffset = 0;
    const maxOffset = 121 - 12; // 121个年份 - 12个可见 = 109

    if (newOffset >= minOffset && newOffset <= maxOffset) {
      yearPickerOffset.value = newOffset;
    }
    lastScrollTime = now;
    return;
  }

  // 如果月份选择器打开，不处理滚轮
  if (showMonthPicker.value) {
    return;
  }

  // 默认情况：滚轮切换月份
  // 采用「累加器 + 触发后固定冷却」双重机制：
  // - 累加器：归一化鼠标滚轮（大 delta、少事件）与触控板（小 delta、多事件）的差异
  // - 冷却期：触发月份切换后 500ms 内忽略所有滚轮，
  //   吃掉触控板惯性滚动，冷却从触发时刻算起，不会被后续事件重置

  // 触发后冷却期内，直接忽略
  if (now - lastMonthChangeTime < 500) return;

  // 事件间隔较大时重置累加器（新手势从零开始）
  if (now - lastWheelTime > 200) {
    monthWheelAccumulator = 0;
  }
  lastWheelTime = now;

  // 根据 deltaMode 归一化为像素单位
  let delta = e.deltaY;
  if (e.deltaMode === 1) delta *= 40;  // 行模式（Firefox）
  if (e.deltaMode === 2) delta *= 800; // 页模式

  monthWheelAccumulator += delta;

  // 累加量未达阈值，不触发
  if (Math.abs(monthWheelAccumulator) < 80) return;

  const direction = monthWheelAccumulator > 0 ? 1 : -1;
  monthWheelAccumulator = 0;
  lastMonthChangeTime = now;

  if (direction > 0) {
    nextMonth();
  } else {
    prevMonth();
  }
};

const almanacInfo = computed(() => {
  const date = selectedDate.value;
  const solarDay = SolarDay.fromYmd(date.year(), date.month() + 1, date.date());
  const lunarDay = solarDay.getLunarDay();
  const lunarMonth = lunarDay.getLunarMonth();
  const lunarYear = lunarMonth.getLunarYear();
  
  // 获取干支信息
  const yearSixtyCycle = lunarDay.getYearSixtyCycle();
  const monthSixtyCycle = lunarDay.getMonthSixtyCycle();
  const daySixtyCycle = lunarDay.getSixtyCycle();
  
  // 获取彭祖百忌
  const pengZu = PengZu.fromSixtyCycle(daySixtyCycle);
  const pengZuText = pengZu.getPengZuHeavenStem().getName() + ' ' + pengZu.getPengZuEarthBranch().getName();
  
  // 获取胎神方位
  const fetusDay = FetusDay.fromLunarDay(lunarDay);
  const fetusText = fetusDay.getName();
  
  // 获取冲煎信息
  const dayEarthBranch = daySixtyCycle.getEarthBranch();
  const chongEarthBranch = dayEarthBranch.getOpposite();
  const sha = dayEarthBranch.getOminous();
  
  // 获取宜忌
  const recommends = lunarDay.getRecommends();
  const avoids = lunarDay.getAvoids();
  
  // 获取上一个和下一个节气
  const termDay = solarDay.getTermDay();
  const currentTerm = termDay.getSolarTerm();
  const nextTerm = currentTerm.next(1);
  
  return {
    solarDate: date.format('YYYY年MM月DD日'),
    weekDay: '星期' + baseWeekDays[date.day()],
    lunarDate: `${yearSixtyCycle.getName()}(${lunarYear.getSixtyCycle().getEarthBranch().getZodiac().getName()})年 ${lunarMonth.getName()}${lunarDay.getName()}`,
    ganZhi: `${yearSixtyCycle.getName()}年 ${monthSixtyCycle.getName()}月 ${daySixtyCycle.getName()}日`,
    yi: recommends.map(t => t.getName()),
    ji: avoids.map(t => t.getName()),
    pengZu: pengZuText,
    wuXing: daySixtyCycle.getSound().getName(), // 五行纳音
    chong: `冲${chongEarthBranch.getZodiac().getName()}`,
    sha: sha.getName(),
    taiShen: fetusText, // 胎神方位
    jieQi: currentTerm.getName() + ' ' + nextTerm.getName(),
  };
});

// ============================================================
// 十二时辰吉凶
// ============================================================

const hoveredShichen = ref(-1);

const shichenNames = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];
const shichenTimeRanges = ['23:00-01:00', '01:00-03:00', '03:00-05:00', '05:00-07:00', '07:00-09:00', '09:00-11:00', '11:00-13:00', '13:00-15:00', '15:00-17:00', '17:00-19:00', '19:00-21:00', '21:00-23:00'];

// 黄道十二神（按固定顺序轮转）
const twelveGods = ['青龙', '明堂', '天刑', '朱雀', '金匮', '天德', '白虎', '玉堂', '天牢', '玄武', '司命', '勾陈'];
const yellowRoadGods = new Set(['青龙', '明堂', '金匮', '天德', '玉堂', '司命']); // 黄道吉神

// 根据当前小时获取所在时辰索引
const getCurrentShichenIndex = () => {
  const h = new Date().getHours();
  if (h >= 23 || h < 1) return 0; // 子时
  return Math.floor((h + 1) / 2);
};

// 计算选中日期的十二时辰吉凶
const shichenInfo = computed(() => {
  const date = selectedDate.value;
  const solarDay = SolarDay.fromYmd(date.year(), date.month() + 1, date.date());
  const lunarDay = solarDay.getLunarDay();
  // getHours() 可能返回13项（早子时+晚子时），只取前12个标准时辰
  const hours = lunarDay.getHours().slice(0, 12);

  // 日支决定黄道十二神起始位置：子午→0, 丑未→1, 寅申→2, 卯酉→3, 辰戌→4, 巳亥→5
  const dayBranchIndex = lunarDay.getSixtyCycle().getEarthBranch().getIndex();
  const godStartIndex = dayBranchIndex % 6;

  const isToday = date.isSame(dayjs(), 'day');
  const currentIdx = isToday ? getCurrentShichenIndex() : -1;

  return hours.map((hour, i) => {
    const godIndex = (godStartIndex + i) % 12;
    const god = twelveGods[godIndex];
    const isYellowRoad = yellowRoadGods.has(god);

    return {
      name: shichenNames[i],
      timeRange: shichenTimeRanges[i],
      ganZhi: hour.getSixtyCycle().getName(),
      god,
      luck: isYellowRoad ? '吉' : '凶',
      isYellowRoad,
      isCurrent: i === currentIdx,
      recommends: hour.getRecommends().map(r => r.getName()),
      avoids: hour.getAvoids().map(a => a.getName()),
    };
  });
});

// 获取选中日期的所有节日信息
const selectedDayFestivals = computed(() => {
  const day = calendarDays.value.find(d => d.isSelected);
  return day ? day.allFestivals : [];
});

// 打开百度百科
const openBaikeLink = (festivalName) => {
  const url = `https://baike.baidu.com/item/${encodeURIComponent(festivalName)}`;
  if (window.utools && window.utools.shellOpenExternal) {
    window.utools.shellOpenExternal(url);
  } else {
    window.open(url, '_blank');
  }
  showFestivalCard.value = false; // 关闭卡片
};

// 显示节日弹出卡片
const openFestivalCard = (festival, event) => {
  event.stopPropagation();
  
  // 如果点击的是同一个节日，则关闭卡片
  if (showFestivalCard.value && selectedFestival.value && selectedFestival.value.name === festival.name) {
    closeFestivalCard();
    return;
  }
  
  const rect = event.target.getBoundingClientRect();
  
  // 计算卡片位置，确保不超出视口
  const cardWidth = 200;
  const cardHeight = 200; // 预估卡片高度
  let x = rect.left + rect.width / 2;
  let y = rect.bottom + 8;
  let showAbove = false;
  
  // 确保卡片不超出右边
  if (x + cardWidth / 2 > window.innerWidth - 20) {
    x = window.innerWidth - cardWidth / 2 - 20;
  }
  // 确保卡片不超出左边
  if (x - cardWidth / 2 < 20) {
    x = cardWidth / 2 + 20;
  }
  // 确保卡片不超出底部，如果超出则显示在上方
  if (y + cardHeight > window.innerHeight - 20) {
    y = rect.top - 8;
    showAbove = true;
  }
  
  // 构建完整的节日信息
  const festivalDate = festival.date || selectedDate.value;
  const festivalInfo = {
    ...festival,
    dateStr: festival.dateStr || dayjs(festivalDate).format('YYYY年MM月DD日'),
    countdown: festival.countdown || getFestivalCountdown(festivalDate)
  };
  
  selectedFestival.value = festivalInfo;
  festivalCardPosition.value = { x, y, showAbove };
  showFestivalCard.value = true;
};

// 关闭节日弹出卡片
const closeFestivalCard = () => {
  showFestivalCard.value = false;
  selectedFestival.value = null;
};

// 计算节日倒数天数（返回对象用于分离数字和单位）
const getFestivalCountdown = (date) => {
  const today = dayjs().startOf('day');
  const targetDate = dayjs(date).startOf('day');
  const diff = targetDate.diff(today, 'day');
  
  if (diff === 0) return { text: '今天', num: '', unit: '' };
  if (diff === 1) return { text: '明天', num: '', unit: '' };
  if (diff > 0) return { text: '', num: diff, unit: '天后' };
  return { text: '', num: Math.abs(diff), unit: '天前' };
};

// 获取节日类型名称
const getFestivalTypeName = (type) => {
  const typeNames = {
    'lunar': '农历传统',
    'solar': '公历现代',
    'term': '节气',
    'international': '国际节日',
    'legal': '法定假日'
  };
  return typeNames[type] || '';
};

// 计算法定假日的连续休假天数
const getHolidayDuration = (startDate) => {
  const date = dayjs(startDate);
  
  // 找到假期的第一天（向前查找直到找到非休假日或非假日）
  let firstRestDay = date;
  while (true) {
    const prevDay = firstRestDay.subtract(1, 'day');
    const solarDay = SolarDay.fromYmd(prevDay.year(), prevDay.month() + 1, prevDay.date());
    const holiday = solarDay.getLegalHoliday();
    if (holiday && !holiday.isWork()) {
      firstRestDay = prevDay;
    } else {
      break;
    }
  }
  
  // 从第一天开始向后查找连续的休假日
  let restDays = 0;
  let checkDate = firstRestDay;
  while (true) {
    const solarDay = SolarDay.fromYmd(checkDate.year(), checkDate.month() + 1, checkDate.date());
    const holiday = solarDay.getLegalHoliday();
    if (holiday && !holiday.isWork()) {
      restDays++;
      checkDate = checkDate.add(1, 'day');
    } else {
      break;
    }
  }
  
  return restDays;
};

// 月份名称映射
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

// 计算未来节日列表（按月分组）
const upcomingFestivals = computed(() => {
  const today = dayjs().startOf('day');
  const festivals = [];
  
  // 遍历未来365天
  for (let i = 0; i < 365; i++) {
    const date = today.add(i, 'day');
    const solarDay = SolarDay.fromYmd(date.year(), date.month() + 1, date.date());
    const lunarDay = solarDay.getLunarDay();
    const lunarMonth = lunarDay.getLunarMonth();
    
    // 公历日期格式（不带前导零）
    const solarDateStr = `${date.month() + 1}月${date.date()}日`;
    // 农历日期格式
    const lunarDateStr = `${lunarMonth.getName()}${lunarDay.getName()}`;
    // 星期几
    const weekDayStr = '周' + baseWeekDays[date.day()];
    
    // 收集当天的所有节日
    const dayFestivals = [];
    const addedFestivalNames = new Set(); // 用于当天节日去重
    
    // 辅助函数：添加节日（自动去重）
    const addFestival = (festival) => {
      const normalizedName = getNormalizedFestivalName(festival.name);
      // 检查是否已存在相同节日
      const existingIndex = dayFestivals.findIndex(f => 
        getNormalizedFestivalName(f.name) === normalizedName
      );
      if (existingIndex === -1) {
        // 不存在，直接添加
        dayFestivals.push({ ...festival, name: normalizedName });
        addedFestivalNames.add(normalizedName);
      } else if (festival.type === 'legal' && festival.isRest) {
        // 法定假日有休假信息，优先级更高，合并信息
        dayFestivals[existingIndex] = { 
          ...dayFestivals[existingIndex], 
          ...festival, 
          name: normalizedName 
        };
      }
    };
    
    // 农历传统节日（显示农历日期）
    const lunarFestival = lunarDay.getFestival();
    if (lunarFestival) {
      addFestival({ name: lunarFestival.getName(), type: 'lunar', dateStr: `${lunarDateStr} | ${weekDayStr}` });
    }
    
    // 公历现代节日（显示公历日期）
    const solarFestival = solarDay.getFestival();
    if (solarFestival) {
      addFestival({ name: solarFestival.getName(), type: 'solar', dateStr: `${solarDateStr} | ${weekDayStr}` });
    }
    
    // 节气（显示公历日期）- 清明节气会被合并到清明节
    const termDay = solarDay.getTermDay();
    if (termDay.getDayIndex() === 0) {
      addFestival({ name: termDay.getSolarTerm().getName(), type: 'term', dateStr: `${solarDateStr} | ${weekDayStr}` });
    }
    
    // 国际节日（显示公历日期）
    const internationalFestival = getInternationalFestival(date.year(), date.month() + 1, date.date());
    if (internationalFestival) {
      addFestival({ name: internationalFestival, type: 'international', dateStr: `${solarDateStr} | ${weekDayStr}` });
    }
    
    // 法定假日（只在节日实际日期显示休假天数，不显示调休）
    const legalHoliday = solarDay.getLegalHoliday();
    if (legalHoliday) {
      // 检查当天是否有对应的节日/节气（说明今天是节日实际日期）
      const holidayName = legalHoliday.getName();
      const normalizedHolidayName = getNormalizedFestivalName(holidayName);
      const existingIndex = dayFestivals.findIndex(f => 
        getNormalizedFestivalName(f.name) === normalizedHolidayName
      );
      
      // 只有当天有对应节日时才添加假期信息（合并到已有的节日条目）
      if (existingIndex !== -1) {
        const restDays = getHolidayDuration(date);
        if (restDays > 0) {
          // 合并休假信息到已有节日
          dayFestivals[existingIndex] = {
            ...dayFestivals[existingIndex],
            isRest: true,
            restDays
          };
        }
      }
    }
    
    // 为每个节日添加完整信息
    dayFestivals.forEach(f => {
      festivals.push({
        ...f,
        date: date,
        month: date.month(),
        monthName: monthNames[date.month()],
        countdown: getFestivalCountdown(date)
      });
    });
  }
  
  // 按月分组
  const grouped = {};
  festivals.forEach(f => {
    if (!grouped[f.monthName]) {
      grouped[f.monthName] = [];
    }
    grouped[f.monthName].push(f);
  });
  
  // 对每组内的节日按日期排序
  Object.keys(grouped).forEach(month => {
    grouped[month].sort((a, b) => a.date.valueOf() - b.date.valueOf());
  });
  
  // 按月份顺序返回（从当前月份开始）
  const sortedMonths = [];
  const currentMonthIndex = today.month();
  for (let i = 0; i < 12; i++) {
    const monthIndex = (currentMonthIndex + i) % 12;
    const monthName = monthNames[monthIndex];
    if (grouped[monthName] && grouped[monthName].length > 0) {
      sortedMonths.push({
        month: monthName,
        festivals: grouped[monthName]
      });
    }
  }
  
  return sortedMonths;
});

// 切换节日列表面板
const toggleFestivalList = () => {
  showFestivalList.value = !showFestivalList.value;
  if (showFestivalList.value) {
    showYearPicker.value = false;
    showMonthPicker.value = false;
    showThemePicker.value = false;
    showSettings.value = false;
    closeFestivalCard();
  }
};

// 全局点击监听，用于关闭弹出菜单
const handleGlobalClick = (e) => {
  // 如果点击的目标不在弹出菜单内，也不在触发按钮内，则关闭菜单
  const isClickInsideTheme = e.target.closest('.theme-picker');
  const isClickInsideSettings = e.target.closest('.settings-wrapper');
  const isClickInsideYearPicker = e.target.closest('.year-month');
  const isClickInsideFestivalCard = e.target.closest('.festival-card');
  const isClickInsideFestivalList = e.target.closest('.festival-list-wrapper');
  const isClickOnFestivalItem = e.target.closest('.festival-list-item') || e.target.closest('.festival-item');
  
  // 点击节日卡片外部时关闭卡片（包括点击节日列表的空白区域）
  if (!isClickInsideFestivalCard && !isClickOnFestivalItem) {
    closeFestivalCard();
  }
  
  if (!isClickInsideTheme && !isClickInsideSettings && !isClickInsideYearPicker && !isClickInsideFestivalCard && !isClickInsideFestivalList) {
    closePickers();
    showFestivalList.value = false;
  }
};

watch([isDarkMode, activeThemeConfig], () => {
  applyTheme();
}, { deep: true });

onMounted(() => {
  const savedTheme = getStorageItem('calendar-theme', 'auto');
  currentTheme.value = savedTheme;
  
  // 初始化系统深色模式检测
  systemDarkMode.value = detectSystemDarkMode();
  applyTheme();
  
  if (props.enterAction && props.enterAction.code === 'calendar') {
    // Already set by default ref
  }

  // 网页版添加全局点击监听
  window.addEventListener('click', handleGlobalClick);
  
  // 监听系统主题变化（web 原生方式，uTools 官方推荐）
  darkModeMediaQuery.addEventListener('change', handleSystemThemeChange);
});

onUnmounted(() => {
  window.removeEventListener('click', handleGlobalClick);
  darkModeMediaQuery.removeEventListener('change', handleSystemThemeChange);
});

// 监听主题变化
watch(activeThemeConfig, () => {
  applyTheme();
});
</script>

<template>
  <div class="calendar-container" :class="['theme-' + currentTheme, isDarkMode ? 'dark-mode' : 'light-mode']" :data-mode="isDarkMode ? 'dark' : 'light'" @wheel.prevent="handleScroll">
    <!-- Header -->
    <header class="calendar-header">
      <div class="current-info" @click.stop>
        <span class="year-month" @click="toggleYearPicker" :class="{ active: showYearPicker }">
          {{ currentMonth.format('YYYY年') }}
        </span>
        <span class="year-month" @click="toggleMonthPicker" :class="{ active: showMonthPicker }">
          {{ currentMonth.format('MM月') }}
        </span>
        <span v-if="dayDifference" class="day-diff">{{ dayDifference }}</span>
        
        <!-- Year Picker Dropdown -->
        <div v-if="showYearPicker" class="picker-dropdown year-picker" @click.stop>
          <div 
            v-for="year in years" 
            :key="year" 
            class="picker-item"
            :class="{ active: year === currentMonth.year() }"
            @click="selectYear(year)"
          >
            {{ year }}年
          </div>
        </div>
        
        <!-- Month Picker Dropdown -->
        <div v-if="showMonthPicker" class="picker-dropdown month-picker" @click.stop>
          <div 
            v-for="month in months" 
            :key="month.value" 
            class="picker-item"
            :class="{ active: month.value === currentMonth.month() }"
            @click="selectMonth(month.value)"
          >
            {{ month.label }}
          </div>
        </div>
      </div>
      <div class="actions">
        <button @click="prevMonth" class="icon-btn"><ChevronLeft :size="20" /></button>
        <button @click="currentMonth = dayjs(); selectedDate = dayjs()" class="text-btn">今天</button>
        <button @click="nextMonth" class="icon-btn"><ChevronRight :size="20" /></button>
        
        <div class="festival-list-wrapper">
          <button @click.stop="toggleFestivalList" class="icon-btn" :class="{ active: showFestivalList }">
            <CalendarDays :size="20" />
          </button>
          
          <!-- 节日倒数面板 -->
          <div v-if="showFestivalList" class="festival-list-panel shadow-lg" @click.stop @wheel.stop>
            <div class="festival-list-title">节日倒数</div>
            <div class="festival-list-content">
              <div v-for="group in upcomingFestivals" :key="group.month" class="festival-month-group">
                <div class="festival-month-header">{{ group.month }}</div>
                <div class="festival-month-card">
                  <div v-for="(festival, idx) in group.festivals" :key="idx" 
                       class="festival-list-item"
                       @click="openFestivalCard(festival, $event)">
                    <div class="festival-item-left">
                      <div class="festival-item-row">
                        <span class="festival-item-name">{{ festival.name }}</span>
                        <span v-if="festival.isRest && festival.restDays > 0" class="festival-rest-badge">
                          休{{ festival.restDays }}天
                        </span>
                      </div>
                      <span class="festival-item-date">{{ festival.dateStr }}</span>
                    </div>
                    <div class="festival-item-countdown">
                      <template v-if="festival.countdown.text">{{ festival.countdown.text }}</template>
                      <template v-else>
                        <span class="countdown-num">{{ festival.countdown.num }}</span>
                        <span class="countdown-unit">{{ festival.countdown.unit }}</span>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="theme-picker">
          <button @click.stop="toggleThemePicker" class="icon-btn theme-trigger" :class="{ active: showThemePicker }">
            <Palette :size="20" class="theme-icon" />
          </button>
          <div v-if="showThemePicker" class="theme-options shadow-lg" @click.stop>
            <div class="color-mode-switch">
              <button 
                class="mode-btn" 
                :class="{ active: colorMode === 'light' }" 
                @click="switchColorMode('light')"
                title="日间模式"
              >
                <Sun :size="16" />
              </button>
              <button 
                class="mode-btn" 
                :class="{ active: colorMode === 'dark' }" 
                @click="switchColorMode('dark')"
                title="夜间模式"
              >
                <Moon :size="16" />
              </button>
              <button 
                class="mode-btn" 
                :class="{ active: colorMode === 'auto' }" 
                @click="switchColorMode('auto')"
                title="跟随系统"
              >
                <Monitor :size="16" />
              </button>
            </div>
            <div class="settings-separator"></div>
            <div 
              v-for="t in themes" 
              :key="t.id" 
              class="theme-option-item"
              @click="switchTheme(t.id)"
              @mouseenter="previewTheme = t.id"
              @mouseleave="previewTheme = null"
            >
              <div 
                :style="{ background: t.color }"
                class="theme-dot"
                :class="{ active: currentTheme === t.id }"
              ></div>
              <span class="theme-name">{{ t.id === 'auto' ? dynamicThemeName : t.name }}</span>
            </div>
          </div>
        </div>

        <div class="settings-wrapper">
          <button @click.stop="toggleSettings" class="icon-btn" :class="{ active: showSettings }">
            <Settings :size="20" />
          </button>
          
          <div v-if="showSettings" class="settings-panel shadow-lg" @click.stop>
            <div class="settings-section">
              <div class="section-title">周起始日</div>
              <div class="setting-options">
                <button 
                  class="option-btn" 
                  :class="{ active: weekStartDay === 0 }"
                  @click="setWeekStartDay(0)"
                >周日</button>
                <button 
                  class="option-btn" 
                  :class="{ active: weekStartDay === 1 }"
                  @click="setWeekStartDay(1)"
                >周一</button>
              </div>
            </div>
            
            <div class="settings-separator"></div>
            
            <div class="settings-section">
              <div class="section-title festival-header" @click="toggleFestivalPanel">
                <span>节日显示</span>
                <span class="festival-count">{{ selectedFestivalCount }}/4</span>
                <span class="expand-icon">{{ showFestivalPanel ? '▲' : '▼' }}</span>
              </div>
              <div v-if="showFestivalPanel" class="festival-tags">
                <span 
                  class="festival-tag" 
                  :class="{ active: showLunarFestivals }" 
                  @click="toggleLunarFestivals"
                >农历</span>
                <span 
                  class="festival-tag" 
                  :class="{ active: showSolarFestivals }" 
                  @click="toggleSolarFestivals"
                >公历</span>
                <span 
                  class="festival-tag" 
                  :class="{ active: showSolarTerms }" 
                  @click="toggleSolarTerms"
                >节气</span>
                <span 
                  class="festival-tag" 
                  :class="{ active: showInternationalFestivals }" 
                  @click="toggleInternationalFestivals"
                >国际</span>
              </div>
            </div>
            
            <div class="settings-separator"></div>
            
            <div class="settings-section">
              <div class="section-title">
                关于{{ projectConfig.name }}
                <span class="version-badge">v{{ projectConfig.version }}</span>
              </div>
              <div class="about-info">
                <div class="about-item link-item" @click="openExternalLink(projectConfig.github)">
                  <Github :size="14" class="about-icon" />
                  <span class="link-text">GitHub 源码</span>
                </div>
                <div class="about-item link-item" @click="openExternalLink(projectConfig.website)">
                  <ExternalLink :size="14" class="about-icon" />
                  <span class="link-text">网页版地址</span>
                </div>
                <div class="about-item">
                  <User :size="14" class="about-icon" />
                  <span>作者: {{ projectConfig.author }}</span>
                </div>
              </div>
            </div>
            
            <div class="settings-footer">
              <div class="slogan">{{ projectConfig.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="main-content">
      <!-- Calendar Grid -->
      <div class="calendar-grid-wrapper">
        <div class="week-header">
          <div v-for="w in weekDays" :key="w" class="week-day">{{ w }}</div>
        </div>
        <div class="grid">
          <div 
            v-for="day in calendarDays" 
            :key="day.date.toString()" 
            class="day-cell"
            :class="{ 
              'other-month': !day.isCurrentMonth, 
              'today': day.isToday,
              'selected': day.isSelected,
              'weekend': day.date.day() === 0 || day.date.day() === 6
            }"
            @click="selectDate(day)"
          >
            <div class="solar-day">{{ day.date.date() }}</div>
            <div class="lunar-day" :class="{ 'festival': day.displayFestival }">
              {{ day.displayFestival || day.lunarText }}
            </div>
            <div v-if="day.holiday" class="holiday-tag" :class="day.holiday.isWork ? 'work' : 'rest'">
              {{ day.holiday.isWork ? '班' : '休' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Almanac Details -->
      <aside class="almanac-panel">
        <div class="almanac-header">
          <div class="big-day">{{ selectedDate.date() }}</div>
          <div class="detail-info">
            <div class="solar-full">{{ almanacInfo.solarDate }}</div>
            <div class="lunar-full">{{ almanacInfo.lunarDate }}</div>
          </div>
        </div>
        
        <!-- 节日显示区域 -->
        <div v-if="selectedDayFestivals.length > 0" class="festival-section">
          <div class="festival-list">
            <span 
              v-for="(festival, index) in selectedDayFestivals" 
              :key="index"
              class="festival-item"
              :class="'festival-' + festival.type"
              @click="openFestivalCard(festival, $event)"
              title="点击查看详情"
            >
              {{ festival.name }}
            </span>
          </div>
        </div>
        
        <div class="almanac-body">
          <div class="yi-ji">
            <div class="item yi">
              <span class="label">宜</span>
              <div class="content">{{ almanacInfo.yi.join(' ') }}</div>
            </div>
            <div class="item ji">
              <span class="label">忌</span>
              <div class="content">{{ almanacInfo.ji.join(' ') }}</div>
            </div>
          </div>

          <div class="almanac-board">
            <dl class="other-details">
              <div class="detail-card detail-card-full detail-card-ganzhi">
                <dt class="detail-card-label">干支</dt>
                <dd class="detail-card-value">{{ almanacInfo.ganZhi }}</dd>
              </div>
              <div class="detail-card is-compact">
                <dt class="detail-card-label">胎神方位</dt>
                <dd class="detail-card-value">{{ almanacInfo.taiShen }}</dd>
              </div>
              <div class="detail-card is-compact">
                <dt class="detail-card-label">五行</dt>
                <dd class="detail-card-value">{{ almanacInfo.wuXing }}</dd>
              </div>
              <div class="detail-card detail-card-full is-highlighted">
                <dt class="detail-card-label">彭祖百忌</dt>
                <dd class="detail-card-value">{{ almanacInfo.pengZu }}</dd>
              </div>
              <div class="detail-card detail-card-full is-highlighted">
                <dt class="detail-card-label">冲煞</dt>
                <dd class="detail-card-value">{{ almanacInfo.chong }} (煞{{ almanacInfo.sha }})</dd>
              </div>
            </dl>
          </div>
          
          <!-- 十二时辰吉凶 -->
          <div class="shichen-section">
            <div class="shichen-compact">
              <span 
                v-for="(sc, idx) in shichenInfo" 
                :key="sc.name" 
                class="shichen-tag"
                :class="{ 'is-ji': sc.isYellowRoad, 'is-xiong': !sc.isYellowRoad, 'is-current': sc.isCurrent, 'is-active': hoveredShichen === idx }"
                @mouseenter="hoveredShichen = idx"
                @mouseleave="hoveredShichen = -1"
              >{{ sc.name[0] }}{{ sc.luck }}</span>
            </div>
            <transition name="shichen-detail-fade">
              <div v-if="hoveredShichen >= 0" class="shichen-detail" :key="hoveredShichen">
                <div class="shichen-detail-header">
                  <span class="shichen-detail-name">{{ shichenInfo[hoveredShichen].name }}</span>
                  <span class="shichen-detail-time">{{ shichenInfo[hoveredShichen].timeRange }}</span>
                  <span class="shichen-detail-luck" :class="{ 'is-ji': shichenInfo[hoveredShichen].isYellowRoad, 'is-xiong': !shichenInfo[hoveredShichen].isYellowRoad }">{{ shichenInfo[hoveredShichen].isYellowRoad ? '黄道' : '黑道' }}</span>
                </div>
                <div class="shichen-detail-body">
                  <span class="shichen-detail-item"><span class="shichen-detail-label">干支</span>{{ shichenInfo[hoveredShichen].ganZhi }}</span>
                  <span class="shichen-detail-item"><span class="shichen-detail-label">神煞</span>{{ shichenInfo[hoveredShichen].god }}</span>
                </div>
                <div v-if="shichenInfo[hoveredShichen].recommends.length" class="shichen-detail-row is-yi">
                  <span class="shichen-detail-label">宜</span>
                  <span>{{ shichenInfo[hoveredShichen].recommends.join(' ') }}</span>
                </div>
                <div v-if="shichenInfo[hoveredShichen].avoids.length" class="shichen-detail-row is-ji">
                  <span class="shichen-detail-label">忌</span>
                  <span>{{ shichenInfo[hoveredShichen].avoids.join(' ') }}</span>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </aside>
    </div>

    <!-- 节日弹出卡片 -->
    <Teleport to="body">
      <div v-if="showFestivalCard && selectedFestival" 
           class="festival-card" 
           :class="{ 'show-above': festivalCardPosition.showAbove }"
           :style="{ left: festivalCardPosition.x + 'px', top: festivalCardPosition.y + 'px' }"
           @click.stop
      >
        <div class="festival-card-name">{{ selectedFestival.name }}</div>
        <div class="festival-card-date">{{ selectedFestival.dateStr }}</div>
        <div v-if="getFestivalDescription(selectedFestival.name)" class="festival-card-desc">
          {{ getFestivalDescription(selectedFestival.name) }}
        </div>
        <div class="festival-card-countdown">
          <template v-if="selectedFestival.countdown.text">{{ selectedFestival.countdown.text }}</template>
          <template v-else>
            <span class="countdown-num">{{ selectedFestival.countdown.num }}</span>
            <span class="countdown-unit">{{ selectedFestival.countdown.unit }}</span>
          </template>
        </div>
        <button class="festival-card-btn" @click="openBaikeLink(selectedFestival.name)">
          <ExternalLink :size="14" />
          查看百度百科
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.calendar-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  user-select: none;
  --rest-color: #ef4444;
  --work-color: #6b7280;
}

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background-color: var(--header-bg);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 2px 4px rgba(0,0,0,0.02);
}

.year-month {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--primary-color);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s;
  margin-right: 4px;
}

.year-month:hover {
  background-color: var(--hover-bg);
}

.year-month.active {
  background-color: var(--primary-color);
  color: #ffffff;
}

.day-diff {
  font-size: 0.85rem;
  color: var(--accent-color);
  margin-left: 8px;
  padding: 2px 8px;
  background-color: var(--hover-bg);
  border-radius: 4px;
}

.current-info {
  position: relative;
  display: flex;
  align-items: center;
}

.picker-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--panel-bg);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 200;
  min-width: 120px;
  border: 1px solid var(--border-color);
}

.year-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 8px;
  overflow: hidden;
}

.month-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 8px;
}

.picker-item {
  padding: 8px 12px;
  text-align: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
  font-size: 0.9rem;
  color: var(--text-color);
}

.picker-item:hover {
  background-color: var(--hover-bg);
}

.picker-item.active {
  background-color: var(--primary-color);
  color: #ffffff;
  font-weight: 600;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn, .text-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--primary-color);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover, .text-btn:hover {
  background-color: var(--hover-bg);
  border-color: var(--primary-color);
}

.icon-btn.active, .icon-btn:hover {
  background-color: var(--hover-bg);
  border-color: var(--primary-color);
}

.theme-trigger {
  /* 统一使用 icon-btn 的颜色定义 */
}

.theme-picker {
  position: relative;
  display: flex;
  align-items: center;
}

.theme-options {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  background: var(--panel-bg);
  padding: 8px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 100;
  border: 1px solid var(--border-color);
  min-width: 140px;
}

.color-mode-switch {
  display: flex;
  gap: 4px;
  padding: 2px;
  background: var(--hover-bg);
  border-radius: 8px;
  margin-bottom: 4px;
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--secondary-text);
  transition: all 0.2s;
}

.mode-btn:hover {
  background: rgba(255,255,255,0.1);
}

.mode-btn.active {
  background: var(--panel-bg);
  color: var(--primary-color);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* 移除悬停触发逻辑 */
.theme-picker::after {
  display: none;
}

/* 移除悬停显示逻辑 */
.theme-options:hover {
  /* 保持显示由 v-if 控制 */
}

.theme-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--dot-bg, #ccc);
  flex-shrink: 0;
}

.theme-option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.2s;
  white-space: nowrap;
}

.theme-option-item:hover {
  background-color: var(--hover-bg);
}

.theme-name {
  font-size: 0.85rem;
  color: var(--text-color);
}

.theme-dot:hover {
  transform: scale(1.15);
}

.theme-dot.active {
  border: 2px solid white;
  box-shadow: 0 0 0 2px var(--saved-primary-color);
}

.settings-wrapper {
  position: relative;
}

.settings-panel {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  width: 200px;
  background: var(--panel-bg);
  border-radius: 12px;
  padding: 16px;
  z-index: 300;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.version-badge {
  font-size: 0.65rem;
  font-weight: 500;
  padding: 1px 6px;
  background: var(--bg-color);
  border: 1px solid var(--accent-color);
  border-radius: 4px;
  color: var(--accent-color);
  letter-spacing: 0;
}

.settings-footer {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px dashed var(--bg-color);
  text-align: center;
}

.slogan {
  font-size: 0.75rem;
  color: var(--accent-color);
  font-style: italic;
  opacity: 0.8;
  position: relative;
  display: inline-block;
}

.slogan::before, .slogan::after {
  content: '"';
  font-family: serif;
  opacity: 0.5;
  font-size: 1.2rem;
  line-height: 1;
  vertical-align: middle;
  color: var(--primary-color);
}

.slogan::before { margin-right: 2px; }
.slogan::after { margin-left: 2px; }

.setting-options {
  display: flex;
  background: var(--hover-bg);
  padding: 3px;
  border-radius: 8px;
}

.option-btn {
  flex: 1;
  border: none;
  background: none;
  padding: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 6px;
  color: var(--secondary-text);
  transition: all 0.2s;
}

.option-btn.active {
  background: var(--panel-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.settings-separator {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-color);
  opacity: 0.8;
}

.about-icon {
  color: var(--accent-color);
  opacity: 0.8;
}

.about-item.link-item {
  cursor: pointer;
  transition: opacity 0.2s;
}

.about-item.link-item:hover {
  opacity: 0.8;
}

.about-item.link-item:hover .link-text {
  color: var(--primary-color);
  text-decoration: underline;
}

.link-text {
  transition: color 0.2s;
}

.icon-btn.active {
  background-color: var(--hover-bg);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.shadow-lg {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.calendar-grid-wrapper {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.week-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--primary-color);
}

.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, 1fr);
  flex: 1;
  gap: 4px;
}

.day-cell {
  background-color: var(--cell-bg);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.day-cell:hover {
  background-color: var(--hover-bg);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.05);
}

.day-cell.selected {
  border-color: var(--primary-color);
  background-color: var(--hover-bg);
}

.day-cell.today {
  background-color: var(--primary-color);
  box-shadow: 0 4px 12px var(--primary-color);
  z-index: 1;
}

.day-cell.today .solar-day,
.day-cell.today .lunar-day {
  color: #ffffff !important;
}

.day-cell.other-month {
  opacity: 0.3;
}

.solar-day {
  font-size: 1.1rem;
  font-weight: 500;
  margin-bottom: 2px;
}

.day-cell.weekend .solar-day {
  color: var(--rest-color);
}

.lunar-day {
  font-size: 0.75rem;
  color: var(--secondary-text);
}

.lunar-day.festival {
  color: var(--accent-color);
  font-weight: 500;
}

.holiday-tag {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 0.65rem;
  padding: 1px 3px;
  border-radius: 3px;
  line-height: 1;
}

.holiday-tag.rest {
  background-color: var(--rest-color);
  color: white;
}

.holiday-tag.work {
  background-color: var(--work-color);
  color: white;
}

.almanac-panel {
  width: 280px;
  background-color: var(--panel-bg);
  border-left: none;
  box-shadow: -1px 0 0 var(--almanac-soft-line);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  --almanac-shadow: 0 2px 6px var(--almanac-shadow-color);
}

.almanac-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--almanac-line);
  position: relative;
}

.big-day {
  font-size: 3rem;
  font-weight: 700;
  line-height: 1;
  color: var(--almanac-gold);
  text-shadow: 0 2px 12px var(--almanac-text-shadow-color);
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.solar-full {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-color);
}

.lunar-full {
  font-size: 0.88rem;
  color: var(--secondary-text);
}

.almanac-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.almanac-board {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: 12px;
  overflow: hidden;
  background: var(--almanac-board-bg);
  box-shadow: none;
}

.yi-ji {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: none;
}

.yi-ji .item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  min-height: 70px;
  background: transparent;
}

.yi-ji .item + .item {
  border-left: none;
}

.yi-ji .label { 
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--almanac-gold);
  flex-shrink: 0;
  font-weight: 600;
  border: 1px solid currentColor;
  background: transparent;
  padding: 0;
  font-size: 0.72rem;
  line-height: 1;
  margin-bottom: 2px;
}

.yi .label {
  color: var(--almanac-gold);
}

.ji .label {
  color: var(--secondary-text);
}

.yi-ji .content {
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--text-color);
  letter-spacing: 0.01em;
  writing-mode: horizontal-tb;
  display: block;
  max-height: none;
  overflow: visible;
  align-self: stretch;
}

.yi .content {
  color: var(--almanac-gold);
}

.ji .content {
  color: var(--text-color);
}

.other-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
  font-size: 0.85rem;
  margin: 0;
}

.detail-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
  min-height: auto;
  padding: 6px 9px 7px;
  background: transparent;
  border: none;
}

.detail-card.is-compact {
  min-height: 56px;
}

.detail-card.is-highlighted {
  background: transparent;
  box-shadow: inset 1px 0 0 var(--almanac-gold-soft);
}

.detail-card-full {
  grid-column: 1 / -1;
}

.detail-card-ganzhi {
  min-height: 50px;
  background: var(--almanac-ganzhi-bg);
}

.detail-card:nth-child(odd):not(.detail-card-full) {
  background: var(--almanac-ganzhi-bg);
  border-radius: 8px;
}

.detail-card-label {
  font-size: 0.72rem;
  line-height: 1.2;
  color: var(--almanac-gold-soft);
  letter-spacing: 0.04em;
}

.detail-card-value {
  margin: 0;
  color: var(--secondary-text);
  font-weight: 500;
  font-size: 0.84rem;
  line-height: 1.34;
  word-break: break-word;
}

/* 十二时辰吉凶 */
.shichen-section {
  padding-top: 10px;
  border-top: none;
  border-radius: 0;
  overflow: visible;
  background: transparent;
  margin-top: 6px;
}

.shichen-compact {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
  padding: 0;
  background: transparent;
}

.shichen-tag {
  display: block;
  font-size: 0.74rem;
  text-align: center;
  padding: 6px 0 7px;
  border-radius: 0;
  line-height: 1.28;
  cursor: default;
  transition: background-color 0.15s ease, color 0.15s ease;
  border: none;
  background: var(--panel-bg);
}

.shichen-tag.is-ji {
  color: var(--almanac-gold);
  background-color: var(--almanac-luck-ji-bg);
  font-weight: 600;
}

.shichen-tag.is-xiong {
  color: var(--secondary-text);
  background-color: var(--almanac-board-bg);
}

.shichen-tag.is-current {
  font-weight: 700;
  background-color: var(--almanac-board-bg);
  outline: 1px solid var(--almanac-gold);
  outline-offset: -1px;
}

.shichen-tag.is-active {
  font-weight: 700;
}

.shichen-tag.is-active.is-ji {
  background-color: var(--almanac-board-bg);
}

.shichen-tag.is-active.is-xiong {
  background-color: var(--panel-bg);
}

/* 时辰详情面板 */
.shichen-detail {
  margin-top: 0;
  padding: 7px 9px;
  background: var(--almanac-detail-bg);
  border-top: none;
  border-radius: 0;
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--text-color, #374151);
}

.shichen-detail-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--almanac-soft-line);
}

.shichen-detail-name {
  font-weight: 600;
}

.shichen-detail-time {
  font-size: 0.72rem;
  color: var(--secondary-text, #9ca3af);
}

.shichen-detail-luck {
  font-size: 0.7rem;
  padding: 0 5px;
  border-radius: 3px;
  margin-left: auto;
}

.shichen-detail-luck.is-ji {
  color: var(--almanac-gold);
  background: var(--almanac-luck-ji-bg);
}

.shichen-detail-luck.is-xiong {
  color: var(--text-color);
  background: var(--almanac-luck-xiong-bg);
}

.shichen-detail-body {
  display: flex;
  gap: 12px;
  margin-bottom: 2px;
}

.shichen-detail-item {
  display: flex;
  gap: 4px;
}

.shichen-detail-label {
  color: var(--secondary-text, #9ca3af);
  flex-shrink: 0;
}

.shichen-detail-row {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.shichen-detail-row.is-yi {
  color: var(--almanac-gold);
}

.shichen-detail-row.is-ji {
  color: var(--text-color);
}

/* 时辰详情展开动画 */
.shichen-detail-fade-enter-active,
.shichen-detail-fade-leave-active {
  transition: opacity 0.15s ease;
}

.shichen-detail-fade-enter-from,
.shichen-detail-fade-leave-to {
  opacity: 0;
}

/* 节日显示标签式开关 */
.festival-header {
  cursor: pointer;
  user-select: none;
}

.festival-count {
  font-size: 0.7rem;
  padding: 1px 6px;
  background: var(--hover-bg);
  border-radius: 10px;
  color: var(--accent-color);
  margin-left: auto;
}

.expand-icon {
  font-size: 0.6rem;
  color: var(--secondary-text);
  margin-left: 6px;
}

.festival-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.festival-tag {
  padding: 4px 10px;
  font-size: 0.75rem;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--hover-bg);
  color: var(--secondary-text);
  border: 1px solid transparent;
}

.festival-tag:hover {
  border-color: var(--primary-color);
}

.festival-tag.active {
  background: var(--primary-color);
  color: #ffffff;
}

/* 黄历详情中的节日显示 */
.festival-section {
  padding: 12px 0;
  border-bottom: none;
}

.festival-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.festival-item {
  padding: 4px 12px;
  font-size: 0.85rem;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 15%, transparent);
  color: var(--accent-color);
}

.festival-item:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  background: color-mix(in srgb, var(--primary-color) 25%, transparent);
}

/* 节日类型标签 - 统一使用主题色（在 .festival-item 中定义） */

/* 节日倒数面板 */
.festival-list-wrapper {
  position: relative;
}

.festival-list-panel {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  width: 230px;
  max-height: 400px;
  background: var(--panel-bg);
  border-radius: 12px;
  z-index: 300;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.festival-list-title {
  padding: 12px 16px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-color);
  border-bottom: 1px solid var(--border-color);
  background: var(--panel-bg);
}

.festival-list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.festival-month-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.festival-month-header {
  padding: 0 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--secondary-text);
}

.festival-month-card {
  background: var(--cell-bg);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.festival-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  transition: background-color 0.2s;
  border-top: 1px solid var(--border-color);
}

.festival-list-item:first-child {
  border-top: none;
}

.festival-list-item:hover {
  background: var(--hover-bg);
}

.festival-item-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.festival-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.festival-item-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-color);
}

.festival-item-date {
  font-size: 0.75rem;
  color: var(--secondary-text);
}

.festival-rest-badge {
  font-size: 0.6rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: #3b82f6;
  color: white;
}

.festival-item-countdown {
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-color);
  min-width: 45px;
  text-align: right;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
}

.countdown-num {
  font-size: 1rem;
  font-weight: 600;
}

.countdown-unit {
  font-size: 0.7rem;
  font-weight: 400;
  margin-left: 1px;
  opacity: 0.8;
}

.festival-item-type {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--primary-color) 20%, transparent);
  color: var(--accent-color);
}

/* 节日类型标签样式 - 统一使用主题色（在 .festival-item-type 中定义） */
</style>

<style>
/* 节日弹出卡片样式（非scoped，因为使用了Teleport） */
.festival-card {
  position: fixed;
  transform: translateX(-50%);
  background: var(--panel-bg, #ffffff);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  z-index: 1000;
  min-width: 180px;
  max-width: 240px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.06));
  animation: festivalCardIn 0.2s ease-out;
}

@keyframes festivalCardIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.festival-card::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid var(--panel-bg, #ffffff);
}

/* 向上弹出时的样式 */
.festival-card.show-above {
  transform: translateX(-50%) translateY(-100%);
}

.festival-card.show-above::before {
  top: auto;
  bottom: -6px;
  border-bottom: none;
  border-top: 6px solid var(--panel-bg, #ffffff);
}

.festival-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.festival-card-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-color, #1f2937);
}

.festival-card-type {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 8px;
  white-space: nowrap;
  background: color-mix(in srgb, var(--primary-color) 20%, transparent);
  color: var(--accent-color);
}

.festival-card-date {
  font-size: 0.85rem;
  color: var(--secondary-text, #6b7280);
  margin-bottom: 4px;
}

.festival-card-desc {
  font-size: 0.8rem;
  color: var(--secondary-text, #6b7280);
  line-height: 1.5;
  margin: 8px 0;
  padding: 8px;
  background: var(--hover-bg, rgba(0,0,0,0.03));
  border-radius: 6px;
}

.festival-card-countdown {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--accent-color, #b45309);
  margin-bottom: 12px;
  display: flex;
  align-items: baseline;
}

.festival-card-countdown .countdown-num {
  font-size: 1.1rem;
  font-weight: 600;
}

.festival-card-countdown .countdown-unit {
  font-size: 0.75rem;
  font-weight: 400;
  margin-left: 2px;
  opacity: 0.8;
}

.festival-card-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: var(--primary-color, #A3D5E0);
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.festival-card-btn:hover {
  opacity: 0.9;
  transform: scale(1.02);
}

/* 深色模式适配 - 通过 .dark-mode 类控制 */
.dark-mode .festival-card {
  background: #1e1e1e;
  border-color: rgba(255,255,255,0.08);
}

.dark-mode .festival-card::before {
  border-bottom-color: #1e1e1e;
}

.dark-mode .festival-card-name {
  color: #e5e7eb;
}

.dark-mode .festival-card-date {
  color: #9ca3af;
}

.dark-mode .festival-card-countdown {
  color: var(--accent-color, #E9BB4E);
}
</style>
