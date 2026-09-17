"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.getWinInstalledApps = exports.getMacInstalledApps = exports.getInstalledApps = void 0;
const mac_1 = require("./mac");
const win_1 = require("./win");
const fs = require('fs')

function getInstalledApps () {
	if (process.platform === 'darwin') {
		return getInternalMacInstalledApps();
	} else if (process.platform === 'win32') {
		return (0, win_1.getInstalledApps)();
	} else {
		return new Promise((_resolve, reject) => {
			reject('Platform not supported');
		});
	}
}

async function getInternalMacInstalledApps () {
	let global_application_arr = []
	if (fs.existsSync("/Applications")) {
		global_application_arr = await (0, mac_1.getInstalledApps)("/Applications");
		global_application_arr.forEach(item => {
			item['app_dir'] = "/Applications"
		})
	}

	let system_application_arr = []
	if (fs.existsSync("/System/Applications")) {
		system_application_arr = await (0, mac_1.getInstalledApps)("/System/Applications");
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
		let target_user_applications_arr = await (0, mac_1.getInstalledApps)(path);
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
	return item;
}

exports.getInstalledApps = getInstalledApps;

function getMacInstalledApps (directory = "/Applications") {
	return (0, mac_1.getInstalledApps)(directory);
}

exports.getMacInstalledApps = getMacInstalledApps;

function getWinInstalledApps () {
	return (0, win_1.getInstalledApps)();
}

exports.getWinInstalledApps = getWinInstalledApps;
