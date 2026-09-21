const fs = require("fs");
const path = require("path");
const { getInstalledApps } = require("../utils/getApps/index");
const {
  deriveInstallDir,
  findLaunchExecutable,
  matchDataDirectoryName,
  normalizeWindowsPath,
  resolveProductLaunchCandidates
} = require("../utils/getApps/win");
const { XMLParser } = require("fast-xml-parser");

// 需要识别的 IDE（模块级常量，避免每次初始化重复构建）
const TARGET_APP_NAME_LIST = [
  "IntelliJ IDEA",
  "PyCharm",
  "PhpStorm",
  "GoLand",
  "Rider",
  "CLion",
  "RustRover",
  "WebStorm",
  "RubyMine",
  "DataGrip",
  "ReSharper",
  "Fleet",
  "Aqua"
];

const TARGET_APP_REGEX = new RegExp(
  TARGET_APP_NAME_LIST.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|"),
  "i"
);

// recentProjects.xml 解析器（模块级复用）
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["entry", "map"].includes(name)
});

// IDE 扫描结果缓存（ZTools dbStorage）：避免每次进入插件都全量扫描
// - 缓存超过 TTL：同步全量扫描
// - 缓存未过期但已较旧：先用缓存渲染，再后台刷新供下次使用
// v2：通道信息新增 Windows 安装目录/启动命令来源，且需让旧版本写入的空结果立即失效
const CHANNELS_CACHE_KEY = "channels.v2";
const CHANNELS_CACHE_TTL = 5 * 60 * 1000;
const CHANNELS_BACKGROUND_REFRESH_AFTER = 30 * 1000;

/**
 * 初始化服务
 */
class InitService {
  // 软件列表
  channels = {};

  // 最近打开项目列表
  recentProjects = {};

  /**
   * 初始化入口
   */
  async init() {
    await this.#init_config();
    await this.#init_recentProjects();
  }

  /**
   * 初始化配置（优先使用缓存，避免每次进入插件都全量扫描）
   */
  async #init_config() {
    const cached = readChannelsCache();
    if (cached) {
      this.channels = cached.channels;
      // 缓存较旧时后台刷新，本次先用缓存快速渲染
      if (Date.now() - cached.scannedAt > CHANNELS_BACKGROUND_REFRESH_AFTER) {
        refreshChannelsCacheInBackground();
      }
      return;
    }
    this.channels = await scanChannels();
    writeChannelsCache(this.channels);
  }

  /**
   * 初始化项目列表
   */
  async #init_recentProjects() {
    for (let displayName of Object.keys(this.channels)) {
      this.recentProjects[displayName] = readRecentProjects(
        displayName,
        this.channels[displayName]
      );
    }
  }
}

/**
 * 扫描本机已安装的 IDE（较慢，结果会被缓存）
 * @returns A Promise with channels：{ [IDE 名]: 通道信息 }
 */
async function scanChannels() {
  const channels = {};
  // Windows 的 appIdentifier 是注册表子键名，MSI 注册项就是 GUID（{...}），不能按占位符过滤
  const requireRealIdentifier = !window.ztools.isWindows();
  // 按名称只取目标 IDE（mac 端在读取 Info.plist / mdls 之前完成过滤，避免全量扫描）
  const appList = (
    await getInstalledApps((appName) => TARGET_APP_REGEX.test(appName || ""))
  ).filter((app) => {
    if (!app?.appName?.trim()) {
      // 没有名字的条目无法展示，也无法据此定位安装目录
      return false;
    }
    if (!requireRealIdentifier) {
      return true;
    }
    return Boolean(app?.appIdentifier) && !app.appIdentifier.startsWith("{"); // 不是占位符
  });
  // 构建应用信息
  for (let targetApp of appList) {
    const channelInfo = buildChannelInfo(targetApp);
    if (channelInfo) {
      channels[channelInfo.displayName] = channelInfo;
    }
  }
  return channels;
}

/**
 * 读取 channels 缓存（ZTools dbStorage）
 * @returns { scannedAt: number, channels: object } | null；无缓存/已过期/宿主不支持时返回 null
 */
function readChannelsCache() {
  const dbStorage = getDbStorage();
  if (!dbStorage) {
    return null;
  }
  try {
    const cached = dbStorage.getItem(CHANNELS_CACHE_KEY);
    if (
      !cached ||
      !cached.channels ||
      !cached.scannedAt ||
      Date.now() - cached.scannedAt > CHANNELS_CACHE_TTL
    ) {
      return null;
    }
    return cached;
  } catch (error) {
    return null;
  }
}

/**
 * 写入 channels 缓存
 * @param channels 扫描结果
 */
function writeChannelsCache(channels) {
  const dbStorage = getDbStorage();
  if (!dbStorage) {
    return;
  }
  try {
    dbStorage.setItem(CHANNELS_CACHE_KEY, {
      scannedAt: Date.now(),
      channels: channels
    });
  } catch (error) {
    // 缓存写入失败不影响主流程
  }
}

/**
 * 缓存命中时后台刷新缓存，供下次进入插件使用
 */
function refreshChannelsCacheInBackground() {
  scanChannels()
    .then((channels) => writeChannelsCache(channels))
    .catch(() => {});
}

/**
 * 获取 ZTools 的键值存储（宿主未提供时返回 null）
 */
function getDbStorage() {
  try {
    return window.ztools && window.ztools.dbStorage
      ? window.ztools.dbStorage
      : null;
  } catch (error) {
    return null;
  }
}

/**
 * 构建单个 IDE 的通道信息（按平台分别定位安装目录 / 配置目录名 / 启动命令）
 * @param targetApp 应用数据
 * @returns 通道信息；无法定位时返回 null（macOS 缺少 product-info.json，Windows 拿不到安装目录与启动命令）
 */
function buildChannelInfo(targetApp) {
  try {
    if (window.ztools.isWindows()) {
      return buildWindowsChannelInfo(targetApp);
    }
    if (window.ztools.isMacOS()) {
      return buildMacChannelInfo(targetApp);
    }
    return null;
  } catch (error) {
    // 单个应用解析失败不影响其它应用
    console.error("init app failed:", targetApp.appName, error.message);
    return null;
  }
}

/**
 * macOS：安装目录即 .app 路径，配置目录名与启动命令来自 Contents/Resources/product-info.json
 * @param targetApp 应用数据
 * @returns 通道信息；缺少 product-info.json 或解析失败时返回 null
 */
function buildMacChannelInfo(targetApp) {
  const appName = targetApp.appName;
  const installLocation = targetApp.app_dir + "/" + appName;
  const appInfoFilePath =
    installLocation + "/Contents/Resources/product-info.json";
  if (!fs.existsSync(appInfoFilePath)) {
    return null;
  }
  let appInfoFileData = fs.readFileSync(appInfoFilePath);
  appInfoFileData = JSON.parse(appInfoFileData);
  return buildChannelResult(targetApp, {
    displayName: appName,
    installLocation: installLocation,
    dataDirectoryName: appInfoFileData.dataDirectoryName,
    launchCommand:
      installLocation +
      "/Contents/MacOS/" +
      appInfoFileData.launch[0].launcherPath.replace("../MacOS/", ""),
    logo_path: window.ztools.getFileIcon(installLocation) || ""
  });
}

/**
 * Windows：安装目录与启动命令来自「JetBrains 标准安装目录扫描 + 注册表」，
 * 逐级兜底（不再因为读不到 product-info.json 就丢弃整个 IDE）
 * @param targetApp 应用数据
 * @returns 通道信息；安装目录与启动命令都拿不到时返回 null
 */
function buildWindowsChannelInfo(targetApp) {
  const appName = targetApp.appName || "";
  const installDirCandidates = collectInstallDirCandidates(targetApp);
  // ① product-info.json：多候选安装目录依次探测，取第一个可读的
  let installLocation = "";
  let productInfo = null;
  for (const installDir of installDirCandidates) {
    const productInfoPath = path.join(installDir, "product-info.json");
    if (!fs.existsSync(productInfoPath)) {
      continue;
    }
    try {
      productInfo = JSON.parse(fs.readFileSync(productInfoPath, "utf8"));
      installLocation = installDir;
      break;
    } catch (error) {
      // 单个候选解析失败时继续尝试下一个候选
      console.error("read product-info failed:", productInfoPath, error.message);
    }
  }
  if (!installLocation) {
    installLocation = installDirCandidates[0] || "";
  }
  // ② 启动命令：product-info.json 的 Windows 启动项 → 注册表 DisplayIcon → 安装目录 bin\*.exe
  const launchCandidates = []
    .concat(resolveProductLaunchCandidates(installLocation, productInfo))
    .concat(targetApp.launchCandidates || [])
    .concat([targetApp.DisplayIcon || ""]);
  const launchCommand =
    findLaunchExecutable(launchCandidates, installDirCandidates) ||
    normalizeWindowsPath(launchCandidates.find((candidate) => candidate) || "");
  // ③ 配置目录名：product-info.json → 目录扫描结果 → 与 %APPDATA%\JetBrains 下的实际目录匹配
  let dataDirectoryName =
    (productInfo && productInfo.dataDirectoryName) ||
    targetApp.dataDirectoryName ||
    "";
  if (!dataDirectoryName) {
    dataDirectoryName = matchDataDirectoryName(
      appName,
      productInfo,
      getJetBrainsConfigRoot()
    );
  }
  if (!installLocation && !launchCommand) {
    console.error("[win] drop IDE:", appName, "(no install dir / launch command)");
    return null;
  }
  return buildChannelResult(targetApp, {
    displayName: appName,
    installLocation: installLocation,
    dataDirectoryName: dataDirectoryName,
    launchCommand: launchCommand,
    // Windows 下安装目录是普通目录，getFileIcon 只会返回系统默认文件夹图标，
    // 必须优先取启动器 exe 的图标（exe 图标即 IDE 图标）
    logo_path: window.ztools.getFileIcon(launchCommand || installLocation) || ""
  });
}

/**
 * 汇总通道信息（各平台公共字段）
 * @param targetApp 应用数据
 * @param base 平台相关的定位结果
 * @returns 通道信息
 */
function buildChannelResult(targetApp, base) {
  return {
    displayName: base.displayName,
    installLocation: base.installLocation,
    dataDirectoryName: base.dataDirectoryName || "",
    launchCommand: base.launchCommand || "",
    logo_path: base.logo_path || "",
    appVersion: targetApp.appVersion || "",
    appInstallDate: targetApp.appInstallDate || "",
    appSource: targetApp.appSource || "",
    appLastUsedDate: targetApp.appLastUsedDate || "",
    appLastUsedTimestamp: targetApp.appLastUsedTimestamp || 0,
    appUseCount: targetApp.appUseCount || 0
  };
}

/**
 * 收集 Windows 安装目录候选（去重保序：目录扫描 / 注册表 InstallLocation / 反推结果）
 * @param targetApp 应用数据
 * @returns 安装目录候选数组
 */
function collectInstallDirCandidates(targetApp) {
  const candidates = [];
  const pushCandidate = (value) => {
    const text = normalizeWindowsPath(value);
    if (!text) {
      return;
    }
    if (
      candidates.some((existed) => existed.toLowerCase() === text.toLowerCase())
    ) {
      return;
    }
    candidates.push(text);
  };
  for (const installDir of targetApp.installDirCandidates || []) {
    pushCandidate(installDir);
  }
  pushCandidate(targetApp.installDir);
  pushCandidate(targetApp.InstallLocation);
  // 兼容旧缓存：可能只存了注册表原值，这里再从 DisplayIcon / UninstallString 反推
  pushCandidate(deriveInstallDir(targetApp.DisplayIcon));
  pushCandidate(deriveInstallDir(targetApp.UninstallString));
  return candidates;
}

/**
 * JetBrains 配置根目录（Windows 下即 %APPDATA%\JetBrains）
 * @returns 目录路径；宿主不支持时返回 ""
 */
function getJetBrainsConfigRoot() {
  try {
    return path.join(window.ztools.getPath("appData"), "JetBrains");
  } catch (error) {
    return "";
  }
}

/**
 * 读取单个 IDE 的最近项目列表
 * @param displayName 通道名（IDE 名）
 * @param channel 通道信息
 * @returns 最近项目数组；文件不存在或解析失败时返回空数组
 */
function readRecentProjects(displayName, channel) {
  const recentProjectList = [];
  try {
    // 没有配置目录名时无法定位文件（Windows 上可能推导失败），直接返回空列表
    if (!channel || !channel.dataDirectoryName) {
      return recentProjectList;
    }
    const recentProjectsFile =
      window.ztools.getPath("appData") +
      "/JetBrains/" +
      channel.dataDirectoryName +
      "/options/recentProjects.xml";
    // 判断文件是否存在
    if (!fs.existsSync(recentProjectsFile)) {
      return recentProjectList;
    }

    // 展开为 home 绝对路径：execFile / open 不经过 shell，路径中的 ~ 不会被展开
    const homeDir = window.ztools.getPath("home");
    let recentProjectsFileData = fs.readFileSync(recentProjectsFile, "utf8");
    recentProjectsFileData = recentProjectsFileData.replaceAll(
      "$USER_HOME$",
      homeDir
    );

    // 采用node兼容方案；component/option 单节点时是对象、多节点时是数组，
    // 按结构遍历所有 map 下的 entry，不依赖节点顺序与固定下标
    const xmlDoc = XML_PARSER.parse(recentProjectsFileData);
    const xml_entry = collectProjectEntries(xmlDoc);

    for (let index = 0; index < xml_entry.length; index++) {
      let entry = xml_entry[index];
      // 缺失 RecentProjectMetaInfo 的 entry 用默认时间戳，保证项目仍可见
      const recentProjectMetaInfo =
        entry.value && entry.value.RecentProjectMetaInfo;
      let optionList = toNodeArray(
        recentProjectMetaInfo && recentProjectMetaInfo.option
      );
      let activationTimestamp = 0;
      let projectOpenTimestamp = 0;
      // 遍历 option 数组
      for (let i = 0; i < optionList.length; i++) {
        let option = optionList[i];
        // 选项属性用 @_ 前缀
        let optName = option["@_name"];
        let optValue = option["@_value"];
        if (optName === "activationTimestamp") {
          activationTimestamp = optValue;
        } else if (optName === "projectOpenTimestamp") {
          projectOpenTimestamp = optValue;
        }
      }
      recentProjectList.push({
        channel: displayName,
        icon: channel.logo_path,
        path: entry["@_key"],
        name: path.basename(entry["@_key"]),
        activationTimestamp: activationTimestamp,
        projectOpenTimestamp: projectOpenTimestamp
      });
    }
  } catch (error) {
    // 单个 IDE 的项目文件解析失败不影响其它 IDE
    console.error("read recent projects failed:", displayName, error.message);
  }
  return recentProjectList;
}

/**
 * XML 节点归一为数组（fast-xml-parser 对单节点返回对象、多节点返回数组）
 * @param value 节点值
 * @returns 节点数组；空值返回空数组
 */
function toNodeArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * 收集 recentProjects.xml 中所有项目 entry
 * 遍历所有 component/option/map，不依赖节点顺序与固定下标
 * @param xmlDoc 解析后的 XML 对象
 * @returns entry 节点数组
 */
function collectProjectEntries(xmlDoc) {
  const entries = [];
  const components = toNodeArray(
    xmlDoc && xmlDoc.application && xmlDoc.application.component
  );
  for (const component of components) {
    const options = toNodeArray(component && component.option);
    for (const option of options) {
      const maps = toNodeArray(option && option.map);
      for (const map of maps) {
        for (const entry of toNodeArray(map && map.entry)) {
          if (entry && entry["@_key"]) {
            entries.push(entry);
          }
        }
      }
    }
  }
  return entries;
}

exports.initService = new InitService();
