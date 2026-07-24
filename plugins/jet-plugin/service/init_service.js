const fs = require("fs");
const { globalData } = require("../config/global_data");
const { getInstalledApps } = require("../utils/getApps/index");
const { XMLParser } = require("fast-xml-parser");

/**
 * 初始化服务
 */
class InitService {
  // 软件列表
  channels = {};

  // 最近打开项目列表
  recentProjects = {};

  /**
   * 初始化入口
   */
  async init() {
    await this.#init_config();
    await this.#init_recentProjects();
  }

  /**
   * 初始化配置
   */
  async #init_config() {
    let targetAppNameList = [
      "IntelliJ IDEA",
      "PyCharm",
      "PhpStorm",
      "GoLand",
      "Rider",
      "CLion",
      "RustRover",
      "WebStorm",
      "RubyMine",
      "DataGrip",
      "ReSharper",
      "Fleet",
      "Aqua"
    ];
    await getInstalledApps().then((appList) => {
      appList = appList
        .filter((app) => app.appName)
        .filter(
          (app) => app.appIdentifier && !app.appIdentifier.startsWith("{")
        );
      console.debug("appList:", appList);
      // 找到目标应用
      let targetAppList = [];
      for (const app of appList) {
        for (let targetAppName of targetAppNameList) {
          if (app.appName.indexOf(targetAppName) >= 0) {
            targetAppList.push(app);
            break;
          }
        }
      }

      // 构建应用信息
      for (let targetApp of targetAppList) {
        let appName = "";
        let installLocation = "";
        let appInfoFilePath = "";
        let dataDirectoryName = "";
        let launchCommand = "";
        let logo_path = "";
        if (window.ztools.isWindows()) {
          // windows
          appName = targetApp.appName;
          installLocation = targetApp.InstallLocation;
          appInfoFilePath = installLocation + "/product-info.json";
          if (!fs.existsSync(appInfoFilePath)) {
            console.debug("product-info.json文件不存在:" + appInfoFilePath);
            continue;
          }
          let appInfoFileData = fs.readFileSync(appInfoFilePath);
          appInfoFileData = JSON.parse(appInfoFileData);
          dataDirectoryName = appInfoFileData.dataDirectoryName;
          launchCommand = targetApp.DisplayIcon;
          logo_path = window.ztools.getFileIcon(launchCommand);
        } else if (window.ztools.isMacOS()) {
          // mac
          appName = targetApp.appName;
          installLocation = targetApp.app_dir + "/" + appName;
          appInfoFilePath =
            installLocation + "/Contents/Resources/product-info.json";
          if (!fs.existsSync(appInfoFilePath)) {
            console.debug("product-info.json文件不存在:" + appInfoFilePath);
            continue;
          }
          let appInfoFileData = fs.readFileSync(appInfoFilePath);
          appInfoFileData = JSON.parse(appInfoFileData);
          dataDirectoryName = appInfoFileData.dataDirectoryName;
          launchCommand =
            installLocation +
            "/Contents/MacOS/" +
            appInfoFileData.launch[0].launcherPath.replace("../MacOS/", "");
          logo_path = window.ztools.getFileIcon(installLocation);
        }

        let channelInfo = {
          displayName: appName,
          installLocation: installLocation,
          dataDirectoryName: dataDirectoryName,
          launchCommand: launchCommand,
          logo_path: logo_path
        };
        this.channels[appName] = channelInfo;
      }
      console.debug("channels:",this.channels);
    });
  }

  /**
   * 初始化项目列表
   */
  async #init_recentProjects() {
    console.debug("初始化最近项目列表");
    Object.keys(this.channels).forEach((displayName) => {
      let channel = this.channels[displayName];

      let recentProjectList = [];
      this.recentProjects[displayName] = recentProjectList;

      let recentProjectsFile =
        window.ztools.getPath("appData").replace("\ ", " ") +
        "/JetBrains/" +
        channel.dataDirectoryName +
        "/options/recentProjects.xml";
      console.debug("recentProjectsFile: " + recentProjectsFile);

      // 判断文件是否存在
      if (!fs.existsSync(recentProjectsFile)) {
        console.debug("文件不存在:" + recentProjectsFile);
        return;
      }

      let recentProjectsFileData = fs.readFileSync(recentProjectsFile);
      recentProjectsFileData = recentProjectsFileData.toString();
      recentProjectsFileData = recentProjectsFileData.replaceAll(
        "$USER_HOME$",
        "~"
      );

      // 采用node兼容方案
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        isArray: (name) => ["entry", "map"].includes(name)
      });
      const xmlDoc = parser.parse(recentProjectsFileData);
      let xml_entry = xmlDoc.application.component.option[0].map[0].entry;

      for (let index = 0; index < xml_entry.length; index++) {
        let entry = xml_entry[index];
        let entryKey = entry["@_key"];
        let valueNode = entry.value; // 不是 getElementsByTagName("value")[0]
        let recentProjectMetaInfo = valueNode.RecentProjectMetaInfo;
        let optionList = recentProjectMetaInfo.option; // 直接是数组
        let activationTimestamp = 0;
        let projectOpenTimestamp = 0;
        // 遍历 option 数组
        for (let i = 0; i < optionList.length; i++) {
          let option = optionList[i];
          // 选项属性用 @_ 前缀
          let optName = option["@_name"];
          let optValue = option["@_value"];
          if (optName === "activationTimestamp") {
            activationTimestamp = optValue;
          } else if (optName === "projectOpenTimestamp") {
            projectOpenTimestamp = optValue;
          }
        }
        // 修改属性：直接赋值，不是 setAttribute
        if (window.ztools.isWindows() && entryKey.startsWith("~")) {
          entry["@_key"] = entryKey.replace("~", window.ztools.getPath("home"));
        }
        recentProjectList[index] = {
          channel: displayName,
          icon: channel.logo_path,
          path: entry["@_key"],
          name: require("path").basename(entry["@_key"]),
          activationTimestamp: activationTimestamp,
          projectOpenTimestamp: projectOpenTimestamp
        };
      }
    });
    console.debug("初始化完成", this.recentProjects);
  }
}

exports.initService = new InitService();
