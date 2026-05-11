class TipsWindow {
    constructor() {
        this.tipsWindow = null;
    }


    async create(type) {
        this.tipsWindow = utools.createBrowserWindow(
            `page/Tips/successTips.html?type=${encodeURIComponent(type)}`,
            {
                width: 900,
                height: 700,
                frame: false,
                transparent: true,
                webPreferences: {
                    nodeIntegration: true,
                    devTools: true,
                },
                backgroundColor: "rgba(0,0,0,0)",
                // alwaysOnTop: true, // 窗口是否总是显示在其他窗口之前
                hasShadow: false,
                skipTaskbar: true,
                resizable: false,
            },
            () => {
                // 开发者工具
                // this.tipsWindow.webContents.openDevTools({ mode: 'detach' });
                this.tipsWindow.setSkipTaskbar(true);
                this.tipsWindow.setAlwaysOnTop(true, 'status')
            }
        );
    }


    async close() {
        this.tipsWindow.destroy();
        this.tipsWindow = null;
    }

    getStatus() {
        return this.tipsWindow.isDestroyed();
    }

}