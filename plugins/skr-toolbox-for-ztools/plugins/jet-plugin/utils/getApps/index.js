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
	console.log({"用户目录": users})
	for (let user of users) {
		if ("Shared" == user) {
			continue
		}
		if (user.startsWith(".")) {
			continue;
		}
		console.log("/Users/" + user + "/Applications")
		let path = "/Users/" + user + "/Applications";
        if(!fs.existsSync(path)){
            console.debug("用户应用目录不存在：" + path)
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
	return application_arr;
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
