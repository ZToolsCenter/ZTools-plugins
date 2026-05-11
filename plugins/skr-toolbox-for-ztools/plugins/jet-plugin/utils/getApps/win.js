"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppData = exports.getApps = exports.getInstalledApps = void 0;
const registry_1 = require("./registry");
function getInstalledApps() {
    return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
        let HKLM_SOFTWARE_Microsoft = [];
        let HKLM_SOFTWARE_Wow6432Node_Microsoft = [];
        let HKCU_SOFTWARE_Microsoft = [];
        let HKCU_SOFTWARE_Wow6432Node_Microsoft = [];
        try {
            HKLM_SOFTWARE_Microsoft = yield getApps(new registry_1.Registry({
                hive: registry_1.Registry.HKLM,
                key: "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            }));
        }
        catch (err) {
            console.error("HKLM_SOFTWARE_Microsoft err", err);
        }
        try {
            HKLM_SOFTWARE_Wow6432Node_Microsoft = yield getApps(new registry_1.Registry({
                hive: registry_1.Registry.HKLM,
                key: "\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            }));
        }
        catch (err) {
            console.error("HKLM_SOFTWARE_Wow6432Node_Microsoft err", err);
        }
        try {
            HKCU_SOFTWARE_Microsoft = yield getApps(new registry_1.Registry({
                hive: registry_1.Registry.HKCU,
                key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            }));
        }
        catch (err) {
            console.error("HKCU_SOFTWARE_Microsoft err", err);
        }
        try {
            HKCU_SOFTWARE_Wow6432Node_Microsoft = yield getApps(new registry_1.Registry({
                hive: registry_1.Registry.HKCU,
                key: "\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            }));
        }
        catch (err) {
            console.error("HKCU_SOFTWARE_Wow6432Node_Microsoft err", err);
        }
        resolve([
            ...HKLM_SOFTWARE_Microsoft,
            ...HKLM_SOFTWARE_Wow6432Node_Microsoft,
            ...HKCU_SOFTWARE_Microsoft,
            ...HKCU_SOFTWARE_Wow6432Node_Microsoft,
        ].filter((app) => {
            return {
                "app":app.appName,
                // todo
                "dir":""
            }
        }));
    }));
}
exports.getInstalledApps = getInstalledApps;
function getApps(regKey) {
    return new Promise((resolve) => {
        try {
            regKey.keys(function (err, key) {
                if (err) {
                    console.error(err);
                    resolve([]);
                }
                if (key) {
                    const getAppItems = key.map((o) => {
                        return getAppData(o);
                    });
                    Promise.all(getAppItems).then((res) => {
                        resolve(res);
                    });
                }
                else {
                    resolve([]);
                }
            });
        }
        catch (err) {
            console.error("getAppItems err", err);
            resolve([]);
        }
    });
}
exports.getApps = getApps;
function getAppData(appKey) {
    return new Promise((resolve) => {
        let app = {};
        try {
            let keyArr = appKey.key.split("\\");
            app.appIdentifier = keyArr[keyArr.length - 1];
            appKey.values((e, items) => {
                if (items) {
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].value) {
                            app[items[i].name] = items[i].value;
                        }
                        if (items[i].name === "DisplayName") {
                            app.appName = items[i].value;
                        }
                        if (items[i].name === "DisplayVersion") {
                            app.appVersion = items[i].value;
                        }
                        if (items[i].name === "InstallDate") {
                            app.appInstallDate = items[i].value;
                        }
                        if (items[i].name === "Publisher") {
                            app.appPublisher = items[i].value;
                        }
                    }
                }
                resolve(app);
            });
        }
        catch (err) {
            resolve(app);
        }
    });
}
exports.getAppData = getAppData;
