# 匯率換算

ZTools 插件。識別碼 `exchange-rates`，顯示名稱「匯率換算」，作者 Kazma258。

在搜尋框輸入「匯率」「貨幣」「錢」或 `money` 即可打開。選定一筆基準金額後，比較清單裡的貨幣會一起換算。

## 功能

- 基準列與比較列的金額都可以修改。在比較列確認一筆金額時，該貨幣成為新的基準，並仍留在比較列。
- 小數位數從 0 到 11。趨勢層的匯率固定顯示 6 位小數。
- 匯率資料為 Frankfurter v2 的日更中間價。更新時間顯示資料裡的觀測日。
- 深色模式第一次跟隨 ZTools 主題，手動切換後記住選擇。
- 已廢棄貨幣的勾選只影響選擇清單，不移除已經加入的列。

## 開發

需要 Node.js 20 或更新版本。

```bash
npm install
npm run dev
npm run check
npm run build
```

`npm run dev` 會在 `http://localhost:5173` 提供介面。ZTools 開發模式讀取根目錄 `plugin.json` 的 `development.main`。

`npm run build` 的成品在 `dist/`。根目錄 `plugin.json` 的 `main` 指向 `dist/index.html`，插件中心的打包腳本會把這個目錄打成發布包。`dist/plugin.json` 裡的入口則是 `index.html`、`preload.js` 和 `logo.png`。

## 授權

MIT。見 [LICENSE](LICENSE)。

## 發布前仍待補充

這些項目需要你本人完成，這次沒有代做：

- 在本機 ZTools 客戶端載入並走一次主要功能。
- 準備截圖或 GIF，放到發布說明。
- 安裝 `@ztools-center/plugin-cli` 後，在乾淨的工作區執行 `ztools publish`。
- 到 Pull Request 勾選自檢清單，並把 Draft 改成 Ready for review。
- 若要替換現在的純色 `logo.png`，換成你的圖檔即可。
