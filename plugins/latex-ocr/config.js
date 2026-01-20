const Environment = "release";

const Config = {
  release: {
    Version: new Date().getTime(),
    MainJS: {
      latex: "publish/latex.bundle.min.js",
      readme: "publish/readme.bundle.min.js",
      update: "publish/update.bundle.min.js",
      messageboard: "publish/messageboard.bundle.min.js",
    },
    Boot_OSS: "..",
    Hostname: "",
  },
};