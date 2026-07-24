import {loadJsonStorage, saveJsonStorage} from "../../js/useStorage";

const settingsKey = 'settings'

export function saveSettings(settingsValue) {
    if (settingsValue == null || !settingsValue) {
        return;
    }

    saveJsonStorage(settingsKey, settingsValue);
}

export function loadSettings() {
    const initSettings = {
        "middleWithShift": false
    };
    return Object.assign(initSettings, loadJsonStorage(settingsKey) ?? {});
}