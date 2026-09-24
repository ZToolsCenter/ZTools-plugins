var petWindow = null;

window.exports = {
  "start-pet": {
    mode: "none",
    args: {
      enter: function () {
        if (petWindow && !petWindow.isDestroyed()) {
          ztools.outPlugin();
          return;
        }
        ztools.hideMainWindow();
        var display = ztools.getPrimaryDisplay();
        var sw = display.bounds.width;
        var sh = display.bounds.height;
        var w = 200;
        var h = 200;
        petWindow = ztools.createBrowserWindow("pet/index.html", {
          x: sw - w,
          y: sh - h,
          width: w,
          height: h,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          hasShadow: false,
          backgroundColor: "#00000000",
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
          },
        });
ztools.outPlugin();

      },
    },
  },
};
