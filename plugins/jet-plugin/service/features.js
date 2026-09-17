const { initService } = require("./init_service");
const { exec } = require("child_process");

/**
 * 搜索
 * @param channel
 * @param search
 */
function search(channel, search) {
  // 获取列表
  let recentProjectList = [];
  if (channel && initService.recentProjects[channel]) {
    recentProjectList = initService.recentProjects[channel];
  } else {
    // all 全部软件
    recentProjectList = Object.values(initService.recentProjects).flat();
  }

  // 查询对应数据
  if (search && search !== "") {
    recentProjectList = recentProjectList.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase())
    );
  }

  // 补充必要数据（IDE 信息来自 initService.channels）
  recentProjectList.forEach((item) => {
    const channelInfo = initService.channels[item.channel] || {};
    item.title = item.name;
    item.description = buildDescription(item, channelInfo);
    item.appSource = channelInfo.appSource || "";
    item.appLastUsedTimestamp = channelInfo.appLastUsedTimestamp || 0;
  });

  // 排序：项目打开时间优先，相同则按 IDE 最近使用时间
  recentProjectList = recentProjectList.sort((o, n) => {
    return (
      n.projectOpenTimestamp - o.projectOpenTimestamp ||
      n.appLastUsedTimestamp - o.appLastUsedTimestamp
    );
  });
  return recentProjectList;
}

/**
 * 列表副标题：项目路径 · IDE 名称 · IDE 最近使用时间
 * @param item 项目数据
 * @param channelInfo 对应 IDE 信息（initService.channels[channel]）
 */
function buildDescription(item, channelInfo) {
  const parts = [item.path];
  const ideName = (channelInfo.displayName || item.channel || "").replace(
    /\.app$/,
    ""
  );
  if (ideName) {
    parts.push(ideName);
  }
  if (channelInfo.appLastUsedDate) {
    parts.push(`最近使用 ${channelInfo.appLastUsedDate.slice(5, 16)}`);
  }
  return parts.join(" · ");
}

/**
 * 系统通知（宿主不支持时忽略）
 * @param message 通知内容
 */
function showNotification(message) {
  if (window.ztools && typeof window.ztools.showNotification === "function") {
    window.ztools.showNotification(message);
  }
}

/**
 * 从应用打开项目
 * @param channel
 * @param path
 */
function launchProjectFromApp(channel, path) {
  const channel_info = initService.channels[channel];
  if (!channel_info) {
    showNotification("未找到应用信息：" + channel);
    return;
  }
  // 应用路径与项目路径都可能包含空格，统一用双引号包裹，保证启动命令解析正确
  exec(`"${channel_info.launchCommand}" "${path}"`, (error) => {
    if (error) {
      console.error("launch project failed:", error.message);
      showNotification("启动失败：" + String(error.message).split("\n")[0]);
    }
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
        initService
          .init()
          .catch((error) => {
            // 初始化失败也要回调，避免插件空白
            console.error("init failed:", error && error.message);
          })
          .then(() => {
            callbackSetList(search("", ""));
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
