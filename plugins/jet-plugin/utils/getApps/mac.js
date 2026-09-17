"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
const {execFile} = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * 数据源策略：Info.plist 为主、mdls 为辅
 * 1) 主：直接读 bundle 的 Contents/Info.plist（plutil），不依赖 Spotlight 索引，
 *    因此对未被索引的目录（如 home 未索引的机器）同样有效；
 * 2) 辅：mdls 定向属性查询，仅用于补充属性（最近使用时间、使用次数等），
 *    结果只存在于 Spotlight 索引中，拿不到时不影响主流程。
 */
const INFO_PLIST_KEYS = [
	"CFBundleIdentifier",
	"CFBundleShortVersionString",
	"CFBundleVersion",
	"CFBundleDisplayName",
	"CFBundleName"
];

// mdls 辅助属性：全部是标量属性，便于按行解析（排除多行字典类属性）
const MDLS_AUX_ATTRS = [
	"kMDItemCFBundleIdentifier",
	"kMDItemFSName",
	"kMDItemVersion",
	"kMDItemDateAdded",
	"kMDItemLastUsedDate",
	"kMDItemUseCount"
];

// mdls 按字母序输出属性，取排序最靠前的属性行作为「单个文件块的起始行」
const MDLS_BLOCK_DELIMITER = [...MDLS_AUX_ATTRS].sort()[0];

const QUERY_CONCURRENCY = 8;

/**
 * getInstalledApps
 * @param directory 应用目录
 * @returns A Promise with app data list
 */
async function getInstalledApps (directory) {
	const directoryContents = await getDirectoryContents(directory);
	// ls 结果里只把 .app bundle 当作应用，普通文件/文件夹直接跳过
	const appPaths = directoryContents.filter((item) => /\.app$/i.test(item));
	const appsFileInfo = await getAppsFileInfo(appPaths);
	return appsFileInfo
		.map((appFileInfo) => getAppData(appFileInfo))
		.filter((app) => app.appName);
}

exports.getInstalledApps = getInstalledApps;

/**
 * getDirectoryContents
 * @param directory
 * @returns A Promise with directory contents（目录下非隐藏条目的绝对路径）
 */
function getDirectoryContents (directory) {
	return new Promise((resolve, reject) => {
		fs.readdir(directory, (error, names) => {
			if (error) {
				reject(error);
				return;
			}
			// 与旧实现（ls，不带 -a）保持一致：跳过隐藏条目
			resolve(
				names
					.filter((name) => name && !name.startsWith("."))
					.map((name) => path.join(directory, name))
			);
		});
	});
}

exports.getDirectoryContents = getDirectoryContents;

/**
 * getAppSubDirectorys
 * @param stdout
 * @param directory
 * @returns Apps sub directorys
 */
function getAppsSubDirectory (stdout, directory) {
	let stdoutArr = stdout.split(/[(\r\n)\r\n]+/);
	stdoutArr = stdoutArr
		.filter((o) => o)
		.map((i) => {
			return `${directory}/${i}`;
		});
	return stdoutArr;
}

exports.getAppsSubDirectory = getAppsSubDirectory;

/**
 * getAppsFileInfo
 * @param appsFile bundle 绝对路径（数组或单个字符串）
 * @returns A Promise with all apps fileInfo data：
 *          [{path, name, plist: Info.plist 解析结果|null, mdls: mdls 辅助属性|null}]
 */
async function getAppsFileInfo (appsFile) {
	const appPaths = (Array.isArray(appsFile) ? appsFile : [appsFile])
		.filter((appPath) => typeof appPath === "string" && appPath && fs.existsSync(appPath));
	// mdls（一次进程）与 Info.plist 读取并行，缩短整体耗时
	const [mdlsInfoMap, plistList] = await Promise.all([
		queryMdlsAttributes(appPaths),
		mapWithConcurrency(appPaths, QUERY_CONCURRENCY, (appPath) => readInfoPlistValues(appPath))
	]);
	return appPaths.map((appPath, index) => {
		const name = path.basename(appPath);
		return {
			path: appPath,
			name: name,
			plist: plistList[index],
			mdls: mdlsInfoMap.get(name) || null
		};
	});
}

exports.getAppsFileInfo = getAppsFileInfo;

/**
 * getAppData
 * @param appFileInfo getAppsFileInfo 产出的单条信息（兼容旧格式：mdls 原始输出行数组）
 * @returns One app data
 */
function getAppData (appFileInfo) {
	// 兼容旧调用：旧版 getAppsFileInfo 返回的是 mdls 输出行数组
	if (Array.isArray(appFileInfo)) {
		return getAppDataFromMdlsLines(appFileInfo);
	}
	if (!appFileInfo || !appFileInfo.path) {
		return {};
	}

	const plist = appFileInfo.plist || {};
	const mdls = appFileInfo.mdls || {};
	const bundleName = appFileInfo.name || path.basename(appFileInfo.path);
	const plistName = pickString(plist.CFBundleDisplayName) || pickString(plist.CFBundleName);
	// appName 需要是 bundle 的目录名（调用方用它拼接应用路径），优先磁盘名，其次 Info.plist 名
	const appName = /\.app$/i.test(bundleName)
		? bundleName
		: (plistName ? (plistName.endsWith(".app") ? plistName : plistName + ".app") : "");

	// mdls 辅助属性：最近使用时间 / 使用次数（只存在于 Spotlight 索引中，取不到时给空值）
	const lastUsedTimestamp = parseMdlsUtcTimestamp(mdls.kMDItemLastUsedDate);
	const appData = {
		appName: appName,
		appPath: appFileInfo.path,
		appVersion: pickString(plist.CFBundleShortVersionString) || pickString(plist.CFBundleVersion) || mdls.kMDItemVersion || "",
		appIdentifier: pickString(plist.CFBundleIdentifier) || mdls.kMDItemCFBundleIdentifier || "",
		appInstallDate: readInstallDate(appFileInfo.path) || mdls.kMDItemDateAdded || "",
		appSource: appFileInfo.plist ? "Info.plist" : (Object.keys(mdls).length ? "mdls" : "filename"),
		appLastUsedDate: lastUsedTimestamp ? formatDate(new Date(lastUsedTimestamp)) : "",
		appLastUsedTimestamp: lastUsedTimestamp,
		appUseCount: Number(mdls.kMDItemUseCount) || 0
	};
	// mdls 辅助属性保留原有键名（已被主数据源填充的字段不覆盖）
	for (const key of Object.keys(mdls)) {
		if (mdls[key] && appData[key] === undefined) {
			appData[key] = mdls[key];
		}
	}
	return appData;
}

exports.getAppData = getAppData;

/**
 * 兼容旧调用：解析 mdls 原始输出行数组（旧版 getAppsFileInfo 的返回格式）
 * @param appFileInfo mdls 输出行数组
 * @returns One app data
 */
function getAppDataFromMdlsLines (appFileInfo) {
	const appData = {};
	const getKeyVal = (lineData) => {
		const lineDataArr = lineData.split("=");
		return {
			key: lineDataArr[0].trim().replace(/\"/g, ""),
			value: lineDataArr[1] ? lineDataArr[1].trim().replace(/\"/g, "") : "",
		};
	};
	appFileInfo
		.filter((line) => line)
		.forEach((line) => {
			if (!line.includes(" = ")) {
				return;
			}
			const appKeyVal = getKeyVal(line);
			if (appKeyVal.value) {
				appData[appKeyVal.key] = appKeyVal.value;
			}
			if (line.includes("kMDItemDisplayName")) {
				appData.appName = appKeyVal.value;
				if (appData.appName && !appData.appName.endsWith(".app")) {
					appData.appName = appData.appName + ".app";
				}
			}
			if (line.includes("kMDItemVersion")) {
				appData.appVersion = appKeyVal.value;
			}
			if (line.includes("kMDItemDateAdded")) {
				appData.appInstallDate = appKeyVal.value;
			}
			if (line.includes("kMDItemCFBundleIdentifier")) {
				appData.appIdentifier = appKeyVal.value;
			}
		});
	return appData;
}

/**
 * 读取 Info.plist（主数据源）
 * @param appPath bundle 绝对路径
 * @returns A Promise with Info.plist 键值对象；文件不存在或读取失败时返回 null
 */
async function readInfoPlistValues (appPath) {
	const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
	if (!fs.existsSync(infoPlistPath)) {
		return null;
	}
	// ① 整体转 JSON（一次进程，覆盖绝大多数 App）
	const jsonText = await runPlutil(["-convert", "json", "-o", "-", infoPlistPath]);
	if (jsonText) {
		try {
			const parsed = JSON.parse(jsonText);
			if (parsed && typeof parsed === "object") {
				return parsed;
			}
		} catch (error) {
			// 解析失败时落到 ② 兜底
		}
	}
	// ② 兜底：逐个键取原始值（Info.plist 含 <data>/<date> 时无法整体转 JSON）
	const picked = {};
	let pickedAny = false;
	for (const key of INFO_PLIST_KEYS) {
		const value = await runPlutil(["-extract", key, "raw", "-o", "-", infoPlistPath]);
		if (value !== null) {
			picked[key] = value;
			pickedAny = true;
		}
	}
	return pickedAny ? picked : null;
}

/**
 * 执行外部命令并返回 stdout（命令以非 0 退出时也返回已产出的 stdout）
 * @param command 命令
 * @param args 参数数组
 * @param maxBuffer 输出上限
 * @returns A Promise with 输出文本
 */
function runCommand (command, args, maxBuffer) {
	return new Promise((resolve) => {
		execFile(command, args, {encoding: "utf8", maxBuffer: maxBuffer}, (error, stdout) => {
			resolve(stdout ? String(stdout) : "");
		});
	});
}

/**
 * 执行 plutil 并返回 stdout
 * @param args plutil 参数
 * @returns A Promise with 输出文本；执行失败或无输出时返回 null
 */
async function runPlutil (args) {
	const text = (await runCommand("plutil", args, 8 * 1024 * 1024)).trim();
	return text || null;
}

/**
 * 批量查询 mdls 辅助属性（一次进程）
 * @param appPaths bundle 绝对路径数组
 * @returns A Promise with Map：key 为 bundle 文件名（kMDItemFSName），value 为属性字典
 */
async function queryMdlsAttributes (appPaths) {
	const mdlsInfoMap = new Map();
	if (!appPaths || !appPaths.length) {
		return mdlsInfoMap;
	}
	const args = [];
	for (const attr of MDLS_AUX_ATTRS) {
		args.push("-name", attr);
	}
	args.push(...appPaths);

	// 个别路径失败时 mdls 会返回非 0，但其余结果仍在 stdout 中
	const stdout = await runCommand("mdls", args, 32 * 1024 * 1024);
	if (!stdout) {
		return mdlsInfoMap;
	}

	const blocks = [];
	let currentBlock = null;
	for (const rawLine of String(stdout).split(/\r?\n/)) {
		const line = rawLine.trim();
		const separator = line.indexOf(" = ");
		if (separator < 0) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		const value = normalizeMdlsValue(line.slice(separator + 3));
		if (key === MDLS_BLOCK_DELIMITER) {
			currentBlock = {};
			blocks.push(currentBlock);
		}
		if (currentBlock && value) {
			currentBlock[key] = value;
		}
	}

	for (const block of blocks) {
		if (block.kMDItemFSName) {
			mdlsInfoMap.set(block.kMDItemFSName, block);
		}
	}
	return mdlsInfoMap;
}

/**
 * 归一化 mdls 属性值：去引号、去空白，(null) 视为空值
 * @param rawValue mdls 原始值
 * @returns 归一化后的字符串
 */
function normalizeMdlsValue (rawValue) {
	let value = String(rawValue).trim();
	if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
		value = value.slice(1, -1).trim();
	}
	return value === "(null)" ? "" : value;
}

/**
 * 解析 mdls 的 UTC 时间字符串（形如 "2026-09-11 09:25:56 +0000"）为毫秒时间戳
 * @param rawValue mdls 属性值
 * @returns 毫秒时间戳；解析失败返回 0
 */
function parseMdlsUtcTimestamp (rawValue) {
	const matched = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(rawValue || "").trim());
	if (!matched) {
		return 0;
	}
	const timestamp = Date.UTC(
		Number(matched[1]),
		Number(matched[2]) - 1,
		Number(matched[3]),
		Number(matched[4]),
		Number(matched[5]),
		Number(matched[6])
	);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * 安装时间：优先文件系统的创建时间（birthtime），拿不到时退回修改时间
 * @param appPath bundle 绝对路径
 * @returns 本地时间字符串 YYYY-MM-DD HH:mm:ss
 */
function readInstallDate (appPath) {
	try {
		const stat = fs.statSync(appPath);
		const birthtime = stat.birthtime;
		const date = birthtime && birthtime.getTime() > 0 ? birthtime : stat.mtime;
		return date ? formatDate(date) : "";
	} catch (error) {
		return "";
	}
}

/**
 * 格式化本地时间
 * @param date Date 对象
 * @returns YYYY-MM-DD HH:mm:ss
 */
function formatDate (date) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 取字符串值
 * @param value 任意值
 * @returns 去掉首尾空白的字符串，非字符串返回空串
 */
function pickString (value) {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 带并发上限的 map（避免同一时间拉起过多子进程）
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
