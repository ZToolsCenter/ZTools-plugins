// 本地验证 preload.js（模拟 ztools 全局环境）
const path = require("path");

// 模拟 ZTools 环境
global.window = {
  ztools: {
    onPluginEnter: () => {},
    showNotification: (body, title) => console.log(`[NOTIFY] ${title}: ${body}`),
  },
};
global.ztools = global.window.ztools;

require(path.join(__dirname, "..", "public", "preload.js"));
const m = global.window.miseManager;

(async () => {
  console.log("=== 1. getSystemInfo ===");
  const info = await m.getSystemInfo();
  console.log(JSON.stringify(info, null, 2));

  console.log("\n=== 2. getInstalledTools ===");
  const ls = await m.getInstalledTools();
  console.log("ok:", ls.ok, "| tools:", ls.tools.length);
  ls.tools.forEach((t) =>
    console.log(`  ${t.name.padEnd(10)} active=${t.activeVersion || "—"} count=${t.installCount}`)
  );

  console.log("\n=== 3. getToolInfo(node) ===");
  const ti = await m.getToolInfo("node");
  console.log("ok:", ti.ok, "| text:", ti.text.split("\n")[0]);

  console.log("\n=== 4. getRemoteVersions(node) ===");
  const rv = await m.getRemoteVersions("node");
  console.log("ok:", rv.ok, "| count:", rv.versions.length, "| latest:", rv.versions.slice(-3));

  console.log("\n=== 5. getOutdated ===");
  const od = await m.getOutdated();
  console.log("ok:", od.ok, "| list:", od.list);

  console.log("\n=== 6. getRegistry ===");
  const rg = await m.getRegistry();
  console.log("ok:", rg.ok, "| count:", rg.tools.length, "| sample:", rg.tools[0]?.name);

  console.log("\n=== 7. getConfigFiles ===");
  const cf = await m.getConfigFiles();
  console.log("ok:", cf.ok, "| files:", cf.files);

  console.log("\n=== 8. readConfigFile(全局配置) ===");
  const rc = m.readConfigFile(info.configPath);
  console.log("ok:", rc.ok, "| head:", (rc.content || "").split("\n").slice(0, 5).join("\n"));

  console.log("\n=== 9. projects 持久化 ===");
  console.log("load:", m.projects.load());
  m.projects.add({ path: "C:/fake/proj", name: "fake" });
  console.log("after add:", m.projects.load().length);
  m.projects.remove("C:/fake/proj");
  console.log("after remove:", m.projects.load().length);

  console.log("\n=== 10. openInstallDir(node, 22.23.2) ===");
  console.log("exists:", m.openInstallDir("node", "22.23.2"));

  console.log("\n✅ 全部验证完成");
})().catch((e) => {
  console.error("❌ 验证失败:", e);
  process.exit(1);
});
