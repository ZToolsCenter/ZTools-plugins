const resolveDbStorage = () => {
    const dbStorage = globalThis?.window?.ztools?.dbStorage;
    if (!dbStorage) {
        throw new Error('uTools dbStorage 不可用');
    }
    return dbStorage;
};

const getStorageItem = (key) => resolveDbStorage().getItem(key);

const setStorageItem = (key, value) => resolveDbStorage().setItem(key, value);

const removeStorageItem = (key) => resolveDbStorage().removeItem(key);

module.exports = {
    resolveDbStorage,
    getStorageItem,
    setStorageItem,
    removeStorageItem
};
