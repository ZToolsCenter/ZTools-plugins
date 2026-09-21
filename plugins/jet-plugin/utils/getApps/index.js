"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.getInstalledApps = void 0;
const mac_1 = require("./mac");
const win_1 = require("./win");
const fs = require('fs')

function getInstalledApps (nameFilter) {
	const filter = typeof nameFilter === "function" ? nameFilter : null;
	if (process.platform === 'darwin') {
		return getInternalMacInstalledApps(filter);
	} else if (process.platform === 'win32') {
		// 名称前置过滤（注册表侧可借此跳过无关条目的读值），上层仍会再过滤一次，语义与 mac 一致
		return (0, win_1.getInstalledApps)(filter).then((apps) => filterAppsByName(apps.map(normalizeAppData), filter));
	} else {
		return new Promise((_resolve, reject) => {
			reject('Platform not supported');
		});
	}
}

async function getInternalMacInstalledApps (nameFilter) {
	let global_application_arr = []
	if (fs.existsSync("/Applications")) {
		global_application_arr = await (0, mac_1.getInstalledApps)("/Applications", nameFilter);
		global_application_arr.forEach(item => {
			item['app_dir'] = "/Applications"
		})
	}

	let system_application_arr = []
	if (fs.existsSync("/System/Applications")) {
		system_application_arr = await (0, mac_1.getInstalledApps)("/System/Applications", nameFilter);
		system_application_arr.forEach(item => {
			item['app_dir'] = "/System/Applications"
		})
	}

	let user_applications_arr = [];
	let users = fs.readdirSync("/Users")
	for (let user of users) {
		if ("Shared" == user) {
			continue
		}
		if (user.startsWith(".")) {
			continue;
		}
		let path = "/Users/" + user + "/Applications";
		if (!fs.existsSync(path)) {
			continue
		}
		let target_user_applications_arr = await (0, mac_1.getInstalledApps)(path, nameFilter);
		target_user_applications_arr.forEach(item => {
			item['app_dir'] = path
		})
		user_applications_arr = user_applications_arr.concat(target_user_applications_arr)
	}
	let application_arr = []
	application_arr = application_arr.concat(global_application_arr)
	application_arr = application_arr.concat(system_application_arr)
	application_arr = application_arr.concat(user_applications_arr)
	return application_arr.map(normalizeAppData);
}

/**
 * 统一各平台字段，避免上层（channels / UI）再处理 undefined
 * Windows 走注册表、没有 Spotlight，最近使用时间等字段给默认值
 * @param item 应用数据
 * @returns 补齐字段后的应用数据
 */
function normalizeAppData (item) {
	item.appName = item.appName || "";
	item.appVersion = item.appVersion || "";
	item.appIdentifier = item.appIdentifier || "";
	item.appInstallDate = item.appInstallDate || "";
	item.appSource = item.appSource || "registry";
	item.appLastUsedDate = item.appLastUsedDate || "";
	item.appLastUsedTimestamp = item.appLastUsedTimestamp || 0;
	item.appUseCount = item.appUseCount || 0;
	// Windows 侧安装目录 / 启动命令候选（mac 端无此概念，统一兜底为空）
	item.installDir = item.installDir || "";
	item.installDirCandidates = Array.isArray(item.installDirCandidates) ? item.installDirCandidates : [];
	item.launchCandidates = Array.isArray(item.launchCandidates) ? item.launchCandidates : [];
	item.productInfoPath = item.productInfoPath || "";
	item.dataDirectoryName = item.dataDirectoryName || "";
	return item;
}

exports.getInstalledApps = getInstalledApps;

/**
 * 按应用名过滤（上层只关心部分应用时，mac 端可前置过滤避免全量扫描）
 * @param apps 应用列表
 * @param filter 名称断言；为空时原样返回
 */
function filterAppsByName (apps, filter) {
	return filter ? apps.filter((app) => filter((app && app.appName) || "")) : apps;
}
