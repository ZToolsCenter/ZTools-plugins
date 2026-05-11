const { initService } = require("./init_service");
const { exec } = require("child_process");

/**
 * 搜索
 * @param channel
 * @param search
 */
function search(channel, search) {
  console.debug("init_data", initService.recentProjects);

  // 获取列表
  let recentProjectList = [];
  if (channel && initService.recentProjects[channel]) {
    recentProjectList = initService.recentProjects[channel];
  } else {
    // all 全部软件
    recentProjectList = Object.values(initService.recentProjects).flat();
  }
  console.debug("recentProjectList", recentProjectList);

  // 查询对应数据
  if (search && search !== "") {
    recentProjectList = recentProjectList.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase())
    );
  }

  // 排序
  recentProjectList = recentProjectList.sort((o, n) => {
    return n.projectOpenTimestamp - o.projectOpenTimestamp;
  });

  // 补充必要数据
  recentProjectList.forEach((item) => {
    item.title = item.name;
    item.description = item.path;
  });
  return recentProjectList;
}

/**
 * 从应用打开项目
 * @param channel
 * @param path
 */
function launchProjectFromApp(channel, path) {
  let channel_info = initService.channels[channel];
  // 启动路径中如果包含空格则会导致 启动失败 这里使用双引号 保证启动命令解析正确
  exec(`"${channel_info.launchCommand}"  ${path}`, (err, stdout, stderr) => {
    console.debug({ "launch app": { err, stdout, stderr } });
  });
}

exports.features = {
  all: {
    mode: "list",
    args: {
      // 进入插件应用时调用
      enter: (action, callbackSetList) => {
        // 每次进入时重新扫描项目列表
        if (window.ztools.isDev()) {
          window.ztools.zbrowser.devTools("undocked");
        }
        initService.init().then((res) => {
          let recentProjectList = search("", "");
          console.debug(recentProjectList);
          callbackSetList(recentProjectList);
        });
      },
      search: (action, searchWord, callbackSetList) => {
        let recentProjectList = search("", searchWord);
        callbackSetList(recentProjectList);
      },

      select: (action, itemData, callbackSetList) => {
        window.ztools.hideMainWindow();
        launchProjectFromApp(itemData.channel, itemData.path);
        window.ztools.outPlugin();
      },
      placeholder: "搜索项目（支持模糊匹配）"
    }
  }
};
