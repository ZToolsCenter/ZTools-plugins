"use strict";
/**
 * Windows 已安装应用（JetBrains IDE）扫描
 *
 * 数据源策略（多源兜底：任一数据源失效都不会导致上层列表为空）
 * 1. 主：JetBrains 标准安装目录扫描（Toolbox / 独立安装包），直接读 product-info.json。
 *    不依赖注册表，也不受注册表值格式（缺字段 / 带引号 / 含 %VAR%）影响；
 * 2. 辅：注册表 Uninstall 项（HKLM / HKCU × 64 / 32 位视图），覆盖自定义安装目录。
 *    读到的路径统一归一化（去引号、去 ",0" 图标索引、展开 %VAR%、去尾部反斜杠），
 *    并补齐 installDirCandidates / launchCandidates 供上层兜底；
 * 3. 两个数据源的结果按安装目录合并去重，重复项互相补齐缺失字段。
 *
 * 说明：注册表子键名就是卸载项名称（≈ DisplayName），因此先按名称前置过滤再逐条读值，
 * 避免为几百个无关条目各拉起一次 reg.exe（旧实现全量并发读取，首次扫描会长时间白屏）。
 */
const fs = require("fs");
const path = require("path");
const { Registry } = require("./registry");

// 注册表卸载项位置（4 个 hive / 视图）
const REGISTRY_UNINSTALL_KEYS = [
	{hive: Registry.HKLM, key: "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"},
	{hive: Registry.HKLM, key: "\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"},
	{hive: Registry.HKCU, key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"},
	{hive: Registry.HKCU, key: "\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"}
];

// JetBrains 标准安装目录（以环境变量为起点）：
// Toolbox 为 <apps>\<产品>\ch-0\<build>\，独立安装包为 <JetBrains>\<产品 版本>\
const INSTALL_ROOT_PATHS = [
	["%LOCALAPPDATA%", "JetBrains", "Toolbox", "apps"],
	["%LOCALAPPDATA%", "Programs", "JetBrains"],
	["%ProgramFiles%", "JetBrains"],
	["%ProgramFiles(x86)%", "JetBrains"]
];

const PRODUCT_INFO_FILE = "product-info.json";
// 目录扫描深度：apps/<产品>/ch-0/<build>/product-info.json 需要 3 层
const DIRECTORY_SCAN_MAX_DEPTH = 3;
const DIRECTORY_SCAN_MAX_RESULTS = 40;
// 读注册表值的并发上限（避免瞬时拉起几百个 reg.exe）
const REGISTRY_CONCURRENCY = 8;
// 单次读注册表值的超时保护（进程异常时不至于卡住整个初始化）
const REGISTRY_READ_TIMEOUT = 10 * 1000;
// bin 目录里不属于启动器的可执行文件
const NON_LAUNCHER_EXE_PATTERN = /(uninstall|fsnotifier|restarter|elevator|repair|format|inspect|winpty|jbr|java)/i;
const ENV_VAR_PATTERN = /%([A-Za-z_][A-Za-z0-9_()]*)%/g;

/**
 * 扫描本机已安装的 JetBrains IDE
 * @param nameFilter 可选：应用名断言（上层只关心目标 IDE 时前置过滤，避免无谓的注册表读取）
 * @returns A Promise with app data list
 */
async function getInstalledApps (nameFilter) {
	const filter = typeof nameFilter === "function" ? nameFilter : null;
	// 1) 目录扫描（快、不依赖注册表）
	const directoryApps = [];
	collectInstallDirectoryApps(filter, directoryApps);
	// 2) 注册表补充；目录扫描已命中时只读名称匹配的条目，否则退回全量读取作为最后兜底
	const registryApps = await scanRegistryApps(filter, directoryApps.length === 0);
	return mergeAppCandidates(directoryApps.concat(registryApps));
}

exports.getInstalledApps = getInstalledApps;

/**
 * 目录扫描：遍历 JetBrains 标准安装目录，命中 product-info.json 即视为一个 IDE
 * @param filter 应用名断言
 * @param apps 结果数组（会被就地追加）
 * @returns 结果数组
 */
function collectInstallDirectoryApps (filter, apps) {
	const seen = new Set();
	for (const segments of INSTALL_ROOT_PATHS) {
		const root = path.join.apply(path, segments.map((segment) => expandEnvVariables(segment)));
		// 环境变量缺失时（如 32 位系统没有 ProgramFiles(x86)）跳过
		if (!root || root.indexOf("%") >= 0) {
			continue;
		}
		collectProductInfoApps(root, filter, apps, seen, 0);
	}
	return apps;
}

/**
 * 递归查找 product-info.json（深度受限，命中即返回，不再深入其子目录）
 */
function collectProductInfoApps (dir, filter, apps, seen, depth) {
	if (apps.length >= DIRECTORY_SCAN_MAX_RESULTS || depth > DIRECTORY_SCAN_MAX_DEPTH) {
		return;
	}
	const entries = readDirectoryEntries(dir);
	if (!entries) {
		return;
	}
	if (entries.indexOf(PRODUCT_INFO_FILE) >= 0) {
		const app = readProductInfoApp(dir, filter);
		const key = normalizePathKey(dir);
		if (app && !seen.has(key)) {
			seen.add(key);
			apps.push(app);
		}
		return;
	}
	if (depth === DIRECTORY_SCAN_MAX_DEPTH) {
		return;
	}
	for (const entry of entries) {
		const childPath = path.join(dir, entry);
		if (isDirectory(childPath)) {
			collectProductInfoApps(childPath, filter, apps, seen, depth + 1);
		}
	}
}

/**
 * 读取一个 IDE 安装目录的 product-info.json
 * @param installDir 安装目录（product-info.json 所在目录）
 * @param filter 应用名断言
 * @returns 应用数据；读取/解析失败或名称不匹配时返回 null
 */
function readProductInfoApp (installDir, filter) {
	const productInfoPath = path.join(installDir, PRODUCT_INFO_FILE);
	try {
		const productInfo = JSON.parse(fs.readFileSync(productInfoPath, "utf8"));
		const name = pickString(productInfo && productInfo.name);
		const version = pickString(productInfo && productInfo.version);
		// 与注册表 DisplayName 语义对齐：产品名 + 版本
		const appName = [name, version].filter(Boolean).join(" ") || path.basename(installDir);
		// product-info.json 是 JetBrains 产品标志（含 productCode / dataDirectoryName）
		if (!name && !pickString(productInfo && productInfo.dataDirectoryName)) {
			return null;
		}
		if (filter && !filter(appName)) {
			return null;
		}
		return {
			appName: appName,
			appVersion: version,
			appIdentifier: pickString(productInfo.productCode),
			appInstallDate: "",
			appSource: "install-dir",
			InstallLocation: installDir,
			DisplayIcon: "",
			UninstallString: "",
			installDir: installDir,
			installDirCandidates: [installDir],
			launchCandidates: resolveProductLaunchCandidates(installDir, productInfo),
			productInfoPath: productInfoPath,
			dataDirectoryName: pickString(productInfo.dataDirectoryName)
		};
	} catch (error) {
		// 安装目录里的 product-info.json 不完整属正常现象（清理残留），不作为错误上报
		return null;
	}
}

/**
 * 由 product-info.json 推导启动命令候选（Windows 平台项优先）
 * @param installDir 安装目录
 * @param productInfo product-info.json 解析结果
 * @returns 候选可执行文件绝对路径数组（去重保序）
 */
function resolveProductLaunchCandidates (installDir, productInfo) {
	const candidates = [];
	if (!installDir) {
		return candidates;
	}
	const launchList = productInfo && Array.isArray(productInfo.launch) ? productInfo.launch : [];
	const windowsLaunchList = launchList.filter((entry) => entry && /^windows$/i.test(pickString(entry.os)));
	const orderedLaunchList = windowsLaunchList.length ? windowsLaunchList : launchList;
	for (const entry of orderedLaunchList) {
		const launcherPath = pickString(entry && entry.launcherPath);
		if (!launcherPath) {
			continue;
		}
		// 相对路径基准是 product-info.json 所在目录（Windows 下即安装根目录）
		pushUniquePath(candidates, path.resolve(installDir, launcherPath));
		// 兜底：个别版本写的是相对 bin 的路径
		pushUniquePath(candidates, path.resolve(installDir, "bin", path.basename(launcherPath)));
	}
	for (const executable of findBinExecutables(installDir)) {
		pushUniquePath(candidates, executable);
	}
	return candidates;
}

exports.resolveProductLaunchCandidates = resolveProductLaunchCandidates;

/**
 * 列出安装目录 bin 下可用的启动器（排除卸载器/辅助进程，64 位启动器优先）
 * @param installDir 安装目录
 * @returns 可执行文件绝对路径数组
 */
function findBinExecutables (installDir) {
	const binDir = path.join(installDir || "", "bin");
	const entries = readDirectoryEntries(binDir);
	if (!entries) {
		return [];
	}
	const executables = entries.filter((entry) => /\.exe$/i.test(entry) && !NON_LAUNCHER_EXE_PATTERN.test(entry));
	// 64 位启动器优先，其次名字更短者（idea64.exe 优于 idea-batch.exe 之类）
	executables.sort((first, second) => scoreExecutable(second) - scoreExecutable(first));
	return executables.map((entry) => path.join(binDir, entry));
}

exports.findBinExecutables = findBinExecutables;

/**
 * 启动器打分：64 位 +2，名字越短优先级越高
 */
function scoreExecutable (name) {
	const lengthScore = Math.max(0, 40 - String(name).length) / 100;
	return (/64\.exe$/i.test(name) ? 2 : 0) + lengthScore;
}

/**
 * 从候选列表里解析出可用的启动可执行文件
 * @param candidates 候选路径（可为 exe 路径，也可为安装目录）
 * @param installDirs 安装目录（候选都不可用时，在其 bin 下查找启动器）
 * @returns 实际存在的可执行文件绝对路径；都不可用时返回 ""（回退为第一个候选）
 */
function findLaunchExecutable (candidates, installDirs) {
	const list = [];
	for (const candidate of candidates || []) {
		pushUniquePath(list, normalizeWindowsPath(candidate));
	}
	for (const installDir of installDirs || []) {
		for (const executable of findBinExecutables(normalizeWindowsPath(installDir))) {
			pushUniquePath(list, executable);
		}
	}
	for (const candidate of list) {
		if (candidate && isFile(candidate)) {
			return candidate;
		}
	}
	return "";
}

exports.findLaunchExecutable = findLaunchExecutable;

/**
 * 定位 IDE 的配置目录名（dataDirectoryName）
 * 取不到 product-info.json 时，用「产品名 + 版本」与 %APPDATA%\JetBrains 下实际存在的目录匹配，
 * 且必须存在 options/recentProjects.xml 才采用（避免误配到同名的其它目录）
 * @param appName 应用名（形如 "IntelliJ IDEA Ultimate 2024.1"）
 * @param productInfo product-info.json 解析结果（可为 null）
 * @param configRoot JetBrains 配置根目录（%APPDATA%\JetBrains）
 * @returns 匹配到的目录名；无匹配返回 ""
 */
function matchDataDirectoryName (appName, productInfo, configRoot) {
	const entries = readDirectoryEntries(configRoot);
	if (!entries) {
		return "";
	}
	const expectedVersion = pickMajorMinorVersion(pickString(productInfo && productInfo.version) || appName);
	const productKeyword = normalizeKeyword(pickString(productInfo && productInfo.name) || appName);
	if (!productKeyword) {
		return "";
	}
	let matchedName = "";
	let matchedWithVersion = false;
	for (const entry of entries) {
		const configDir = path.join(configRoot, entry);
		if (!isDirectory(configDir) || !isFile(path.join(configDir, "options", "recentProjects.xml"))) {
			continue;
		}
		const dirKeyword = normalizeKeyword(stripVersionSuffix(entry));
		if (!dirKeyword || dirKeyword.length < 4) {
			continue;
		}
		if (productKeyword.indexOf(dirKeyword) < 0 && dirKeyword.indexOf(productKeyword) < 0) {
			continue;
		}
		const versionMatched = Boolean(expectedVersion) && pickMajorMinorVersion(entry) === expectedVersion;
		// 同产品多版本并存时优先版本一致的目录
		if (!matchedName || (versionMatched && !matchedWithVersion)) {
			matchedName = entry;
			matchedWithVersion = versionMatched;
		}
	}
	return matchedName;
}

exports.matchDataDirectoryName = matchDataDirectoryName;

/**
 * 路径归一化：去 ",0" 图标索引、去引号与命令后缀、展开 %VAR%、去尾部反斜杠
 * @param value 注册表原始值
 * @returns 归一化后的路径；空值返回 ""
 */
function normalizeWindowsPath (value) {
	let text = pickString(value);
	if (!text) {
		return "";
	}
	// DisplayIcon 形如 "C:\...\idea64.exe",0 或 C:\...\idea64.exe,0
	text = text.replace(/,\s*-?\d+\s*$/, "");
	// 带参数的命令行形如 "C:\...\Uninstall.exe" /S
	const quoted = /^"([^"]+)"/.exec(text);
	if (quoted) {
		text = quoted[1];
	}
	text = expandEnvVariables(text).trim();
	if (text.length >= 2 && text.charAt(0) === "\"" && text.charAt(text.length - 1) === "\"") {
		text = text.slice(1, -1).trim();
	}
	// 去掉尾部反斜杠（保留 "C:\" 这类根路径）
	return text.replace(/[\\/]+$/, "") || text;
}

exports.normalizeWindowsPath = normalizeWindowsPath;

/**
 * 展开 %VAR% 形式的环境变量（不认识的变量原样保留）
 */
function expandEnvVariables (value) {
	const text = String(value == null ? "" : value);
	if (text.indexOf("%") < 0) {
		return text;
	}
	return text.replace(ENV_VAR_PATTERN, (raw, name) => {
		if (process.env[name]) {
			return process.env[name];
		}
		const matchedKey = Object.keys(process.env).find((key) => key.toLowerCase() === String(name).toLowerCase());
		return matchedKey ? process.env[matchedKey] : raw;
	});
}

/**
 * 扫描注册表卸载项
 * @param filter 应用名断言（作用于子键名）
 * @param allowFullScan 名称未命中时是否退回全量读取
 * @returns A Promise with app data list
 */
async function scanRegistryApps (filter, allowFullScan) {
	const subKeyList = (await Promise.all(REGISTRY_UNINSTALL_KEYS.map(openRegistrySubKeys))).reduce(
		(result, keys) => result.concat(keys),
		[]
	);
	if (!subKeyList.length) {
		return [];
	}
	// 前置过滤：子键名就是卸载项名称（≈ DisplayName），先筛掉无关条目再逐条读值
	const matchedKeys = filter ? subKeyList.filter((subKey) => filter(lastKeySegment(subKey))) : subKeyList;
	if (matchedKeys.length) {
		return readRegistryApps(matchedKeys);
	}
	if (!allowFullScan) {
		return [];
	}
	// 最后兜底：子键名不含产品名时（如以 GUID 命名的卸载项）只能逐条读 DisplayName
	return readRegistryApps(subKeyList);
}

/**
 * 读取单个卸载项位置下的全部应用（兼容旧导出：入参为 Registry 实例）
 * @param registryKey Registry 实例
 * @returns A Promise with app data list
 */
async function getApps (registryKey) {
	const subKeyList = await queryRegistrySubKeys(registryKey);
	return readRegistryApps(subKeyList);
}

exports.getApps = getApps;

/**
 * 打开一个卸载项位置并读取其子键（构造失败或读取失败都返回空数组，不影响其它数据源）
 * @param options { hive, key }
 * @returns A Promise with Registry 实例数组
 */
function openRegistrySubKeys (options) {
	try {
		return queryRegistrySubKeys(new Registry({hive: options.hive, key: options.key}));
	} catch (error) {
		return Promise.resolve([]);
	}
}

/**
 * 读取卸载项子键列表
 * @param registryKey Registry 实例
 * @returns A Promise with Registry 实例数组（失败返回空数组）
 */
function queryRegistrySubKeys (registryKey) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (keys) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(Array.isArray(keys) ? keys : []);
		};
		try {
			registryKey.keys((error, keys) => finish(keys));
		} catch (error) {
			finish([]);
		}
	});
}

/**
 * 并发读取多个卸载项（并发上限 8）
 * @param subKeyList Registry 实例数组
 * @returns A Promise with app data list
 */
async function readRegistryApps (subKeyList) {
	const apps = await mapWithConcurrency(subKeyList, REGISTRY_CONCURRENCY, (subKey) => readRegistryApp(subKey));
	return apps.filter(Boolean);
}

/**
 * 读取单个卸载项（兼容旧导出）
 * @param registryKey Registry 实例
 * @returns A Promise with 应用数据；读不到名称时返回 null
 */
async function getAppData (registryKey) {
	return readRegistryApp(registryKey);
}

exports.getAppData = getAppData;

/**
 * 读取单个卸载项的应用数据
 * @param registryKey Registry 实例
 * @returns A Promise with 应用数据；读取失败或缺少 DisplayName 时返回 null
 */
function readRegistryApp (registryKey) {
	const app = {};
	try {
		app.appIdentifier = lastKeySegment(registryKey);
	} catch (error) {
		app.appIdentifier = "";
	}
	return withTimeout(
		new Promise((resolve) => {
			try {
				registryKey.values((error, items) => {
					applyRegistryValues(app, items);
					resolve(finalizeRegistryApp(app));
				});
			} catch (error) {
				resolve(finalizeRegistryApp(app));
			}
		}),
		REGISTRY_READ_TIMEOUT,
		null
	);
}

/**
 * 把注册表值映射到应用字段（只取用得到的值，避免把整份注册表数据带进缓存）
 */
function applyRegistryValues (app, items) {
	if (!Array.isArray(items)) {
		return;
	}
	for (const item of items) {
		if (!item || typeof item.name !== "string") {
			continue;
		}
		const value = typeof item.value === "string" ? item.value : "";
		switch (item.name) {
			case "DisplayName":
				app.appName = value.trim();
				break;
			case "DisplayVersion":
				app.appVersion = value.trim();
				break;
			// 这三个字段是定位安装目录与启动命令的唯一来源，必须归一化（去引号 / 去 ",0" / 展开 %VAR%）
			case "InstallLocation":
				app.InstallLocation = normalizeWindowsPath(value);
				break;
			case "DisplayIcon":
				app.DisplayIcon = normalizeWindowsPath(value);
				break;
			case "UninstallString":
				app.UninstallString = normalizeWindowsPath(value);
				break;
			case "InstallDate":
				app.appInstallDate = formatInstallDate(value);
				break;
			case "Publisher":
				app.appPublisher = value.trim();
				break;
			default:
				break;
		}
	}
}

/**
 * 归一化后的注册表应用数据：补齐安装目录候选与启动命令候选
 * @param app 原始字段
 * @returns 应用数据；缺少 DisplayName 时返回 null
 */
function finalizeRegistryApp (app) {
	const appName = pickString(app.appName);
	if (!appName) {
		return null;
	}
	const installDirCandidates = [];
	// InstallLocation 缺失或不可用时的兜底：由 DisplayIcon / UninstallString 反推安装目录
	pushUniquePath(installDirCandidates, pickString(app.InstallLocation));
	pushUniquePath(installDirCandidates, deriveInstallDir(pickString(app.DisplayIcon)));
	pushUniquePath(installDirCandidates, deriveInstallDir(pickString(app.UninstallString)));
	const installDir = installDirCandidates[0] || "";
	const launchCandidates = [];
	pushUniquePath(launchCandidates, isExecutablePath(app.DisplayIcon) ? app.DisplayIcon : "");
	for (const executable of findBinExecutables(installDir)) {
		pushUniquePath(launchCandidates, executable);
	}
	return {
		appName: appName,
		appVersion: pickString(app.appVersion),
		appIdentifier: pickString(app.appIdentifier),
		appInstallDate: pickString(app.appInstallDate),
		appSource: "registry",
		InstallLocation: pickString(app.InstallLocation),
		DisplayIcon: pickString(app.DisplayIcon),
		UninstallString: pickString(app.UninstallString),
		installDir: installDir,
		installDirCandidates: installDirCandidates,
		launchCandidates: launchCandidates,
		productInfoPath: "",
		dataDirectoryName: ""
	};
}

/**
 * 由可执行文件路径反推 IDE 安装目录（形如 <安装目录>\bin\xxx.exe → <安装目录>）
 * @param executablePath 可执行文件路径
 * @returns 安装目录；无法反推时返回 ""
 */
function deriveInstallDir (executablePath) {
	const text = pickString(executablePath);
	if (!text || !isExecutablePath(text)) {
		return "";
	}
	const parentDir = path.dirname(text);
	if (/^bin$/i.test(path.basename(parentDir))) {
		return path.dirname(parentDir);
	}
	return parentDir;
}

exports.deriveInstallDir = deriveInstallDir;

/**
 * 合并多数据源的应用候选：按安装目录去重，重复项互相补齐缺失字段
 * @param appList 应用候选（目录扫描在前，注册表在后）
 * @returns 合并后的应用候选
 */
function mergeAppCandidates (appList) {
	const mergedApps = [];
	const indexByKey = new Map();
	for (const app of appList) {
		if (!app || !pickString(app.appName)) {
			continue;
		}
		const key = normalizePathKey(app.installDir) || "name:" + app.appName.toLowerCase();
		const existedIndex = indexByKey.get(key);
		if (existedIndex === undefined) {
			indexByKey.set(key, mergedApps.length);
			mergedApps.push(app);
			continue;
		}
		mergeAppCandidate(mergedApps[existedIndex], app);
	}
	return mergedApps;
}

/**
 * 用补充数据填充应用缺失的字段（已有值不覆盖）
 */
function mergeAppCandidate (target, source) {
	for (const field of ["appIdentifier", "appVersion", "appInstallDate", "InstallLocation", "DisplayIcon", "UninstallString", "productInfoPath", "dataDirectoryName"]) {
		if (!pickString(target[field]) && pickString(source[field])) {
			target[field] = source[field];
		}
	}
	if (!target.installDir && source.installDir) {
		target.installDir = source.installDir;
	}
	target.installDirCandidates = mergePathLists(target.installDirCandidates, source.installDirCandidates);
	target.launchCandidates = mergePathLists(target.launchCandidates, source.launchCandidates);
	return target;
}

/**
 * 合并两个路径列表（去重保序）
 */
function mergePathLists (first, second) {
	const merged = [];
	for (const value of (first || []).concat(second || [])) {
		pushUniquePath(merged, value);
	}
	return merged;
}

/**
 * 注册表子键名（= 卸载项名称）
 * @param registryKey Registry 实例
 * @returns 子键最后一段；取不到返回 ""
 */
function lastKeySegment (registryKey) {
	const keyPath = registryKey && typeof registryKey.key === "string" ? registryKey.key : "";
	const segments = keyPath.split("\\");
	return segments[segments.length - 1] || "";
}

/**
 * 安装时间归一化：注册表常见 20240115，统一成 YYYY-MM-DD
 */
function formatInstallDate (value) {
	const text = pickString(value);
	const matched = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
	return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : text;
}

/**
 * 取「主版本.次版本」（2026.2.2 → 2026.2），用于配置目录名匹配
 */
function pickMajorMinorVersion (value) {
	const matched = /(\d{4}\.\d+)/.exec(String(value == null ? "" : value));
	return matched ? matched[1] : "";
}

/**
 * 目录名去版本后缀（IntelliJIdea2026.2 → IntelliJIdea）
 */
function stripVersionSuffix (value) {
	return String(value == null ? "" : value).replace(/[\d.]+$/, "");
}

/**
 * 关键字归一化：去掉版本号/非字母数字，转小写（"IntelliJ IDEA Ultimate 2024.1" → "intellijideaultimate"）
 */
function normalizeKeyword (value) {
	return String(value == null ? "" : value)
		.replace(/[\d.]+/g, " ")
		.replace(/[^a-zA-Z]/g, "")
		.toLowerCase();
}

/**
 * 读目录（失败返回 null，且跳过隐藏条目）
 */
function readDirectoryEntries (dir) {
	try {
		if (!dir || !fs.existsSync(dir)) {
			return null;
		}
		return fs.readdirSync(dir).filter((name) => name && name.charAt(0) !== ".");
	} catch (error) {
		return null;
	}
}

function isDirectory (targetPath) {
	try {
		return fs.statSync(targetPath).isDirectory();
	} catch (error) {
		return false;
	}
}

function isFile (targetPath) {
	try {
		return fs.statSync(targetPath).isFile();
	} catch (error) {
		return false;
	}
}

/**
 * 是否形如可执行文件路径（排除只有图标名或空值的情况）
 */
function isExecutablePath (value) {
	return /\.exe$/i.test(pickString(value));
}

/**
 * 路径列表去重（Windows 大小写不敏感）
 */
function pushUniquePath (list, value) {
	const text = pickString(value);
	if (!text) {
		return;
	}
	const key = normalizePathKey(text);
	for (const existed of list) {
		if (normalizePathKey(existed) === key) {
			return;
		}
	}
	list.push(text);
}

/**
 * 路径归一化 key（用于去重）
 * 统一分隔符后再比较：注册表值可能混用 \ 与 /，目录扫描则是本机分隔符
 */
function normalizePathKey (targetPath) {
	const text = pickString(targetPath);
	if (!text) {
		return "";
	}
	return path
		.normalize(text)
		.replace(/[\\/]+/g, "/")
		.replace(/\/+$/, "")
		.toLowerCase();
}

/**
 * 取字符串值
 */
function pickString (value) {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 给 Promise 加超时保护
 * @param promise 目标 Promise
 * @param timeout 超时毫秒
 * @param fallback 超时后的返回值
 */
function withTimeout (promise, timeout, fallback) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(fallback), timeout);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(fallback);
			}
		);
	});
}

/**
 * 带并发上限的 map（与 mac.js 同款实现：避免同时拉起过多子进程）
 * @param items 待处理数组
 * @param limit 并发上限
 * @param mapper 处理函数
 * @returns A Promise with 处理结果数组（顺序与入参一致）
 */
async function mapWithConcurrency (items, limit, mapper) {
	const results = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers = [];
	for (let i = 0; i < workerCount; i++) {
		workers.push((async () => {
			while (nextIndex < items.length) {
				const index = nextIndex++;
				results[index] = await mapper(items[index], index);
			}
		})());
	}
	await Promise.all(workers);
	return results;
}
