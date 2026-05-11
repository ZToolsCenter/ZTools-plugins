function getProfilePathId() {
  return window.ztools.getNativeId() + ".profile";
}

class Setting {
  constructor() {
    this.code = "ch-setting";
    this.mode = "none";
  }

  enter(action) {
    let item = window.ztools.db.get(getProfilePathId());
    if (!item) item = { _id: getProfilePathId(), data: "" };

    item.data = action.payload[0].path;

    const result = window.ztools.db.put(item);
    if (result.ok) {
      window.ztools.showNotification("chrome history profile change success");
    } else {
      window.ztools.showNotification("失败: " + result.error);
    }

    window.ztools.redirect("ch", "");
  }
}

module.exports = {
  Setting,
  getProfilePathId,
};
