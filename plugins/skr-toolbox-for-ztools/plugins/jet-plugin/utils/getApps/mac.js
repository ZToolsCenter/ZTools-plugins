"use strict";
var __awaiter = (this && this.__awaiter) || function(thisArg, _arguments, P, generator) {
	function adopt (value) {
		return value instanceof P ? value : new P(function(resolve) {
			resolve(value);
		});
	}

	return new (P || (P = Promise))(function(resolve, reject) {
		function fulfilled (value) {
			try {
				step(generator.next(value));
			} catch (e) {
				reject(e);
			}
		}

		function rejected (value) {
			try {
				step(generator["throw"](value));
			} catch (e) {
				reject(e);
			}
		}

		function step (result) {
			result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
		}

		step((generator = generator.apply(thisArg, _arguments || [])).next());
	});
};
Object.defineProperty(exports, "__esModule", {value: true});
exports.getAppData = exports.getAppsFileInfo = exports.getAppsSubDirectory = exports.getDirectoryContents = exports.getInstalledApps = void 0;
const child_process_1 = require("child_process");

function getInstalledApps (directory) {
	return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
		try {
			const directoryContents = yield getDirectoryContents(directory);
			const appsFileInfo = yield getAppsFileInfo(directoryContents);
			resolve(appsFileInfo
				.map((appFileInfo) => getAppData(appFileInfo))
				.filter((app) => app.appName));
		} catch (error) {
			reject(error);
		}
	}));
}

exports.getInstalledApps = getInstalledApps;

/**
 * getDirectoryContents
 * @param directory
 * @returns A Promise with directory contents
 */
function getDirectoryContents (directory) {
	return new Promise((resolve, reject) => {
		(0, child_process_1.exec)(`ls "${directory}"`, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				try {
					resolve(getAppsSubDirectory(stdout, directory));
				} catch (err) {
					reject(err);
				}
			}
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
 * @param appsFile
 * @returns All apps fileInfo data
 */
function getAppsFileInfo (appsFile) {
	const runMdlsShell = (0, child_process_1.spawnSync)("mdls", appsFile, {
		encoding: "utf8",
	});
	const stdoutData = runMdlsShell.stdout;
	const allAppsFileInfoList = [];
	const stdoutDataArr = stdoutData.split(/[(\r\n)\r\n]+/);
	const splitIndexArr = [];
	for (let i = 0; i < stdoutDataArr.length; i++) {
		if (stdoutDataArr[i].includes("_kMDItemDisplayNameWithExtensions")) {
			splitIndexArr.push(i);
		}
	}
	for (let j = 0; j < splitIndexArr.length; j++) {
		allAppsFileInfoList.push(stdoutDataArr.slice(splitIndexArr[j], splitIndexArr[j + 1]));
	}
	return allAppsFileInfoList;
}

exports.getAppsFileInfo = getAppsFileInfo;

/**
 * getAppData
 * @param singleAppFileInfo
 * @returns One app data
 */
function getAppData (singleAppFileInfo) {
	const getKeyVal = (lineData) => {
		const lineDataArr = lineData.split("=");
		return {
			key: lineDataArr[0].trim().replace(/\"/g, ""),
			value: lineDataArr[1] ? lineDataArr[1].trim().replace(/\"/g, "") : "",
		};
	};
	const getAppInfoData = (appArr) => {
		let appData = {};
		appArr
			.filter((i) => i)
			.forEach((o) => {
				let appKeyVal = getKeyVal(o);
				if (appKeyVal.value) {
					appData[appKeyVal.key] = appKeyVal.value;
				}
				if (o.includes("kMDItemDisplayName")) {
					appData.appName = appKeyVal.value;
					if (!appData.appName.endsWith(".app")) {
						appData.appName = appData.appName + ".app"
					}
				}
				if (o.includes("kMDItemVersion")) {
					appData.appVersion = appKeyVal.value;
				}
				if (o.includes("kMDItemDateAdded")) {
					appData.appInstallDate = appKeyVal.value;
				}
				if (o.includes("kMDItemCFBundleIdentifier")) {
					appData.appIdentifier = appKeyVal.value;
				}
			});
		return appData;
	};
	return getAppInfoData(singleAppFileInfo);
}

exports.getAppData = getAppData;
