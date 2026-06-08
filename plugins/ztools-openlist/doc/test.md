# OpenList Plugin Test Guide

## 1. Build Check

Run:

```bash
npm run build
```

Expected result:

- `vue-tsc` passes.
- `vite build` completes successfully.
- Rollup warnings from dependencies are acceptable if the final build succeeds.

## 2. Start Development Server

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected result:

- Vite starts at `http://127.0.0.1:5173/`.
- `public/plugin.json` development entry points to the same URL.

Current development entry:

```json
{
  "development": {
    "main": "http://127.0.0.1:5173"
  }
}
```

## 3. Load In ZTools

The plugin must be tested inside ZTools for full functionality because file selection,
upload, download, and config persistence rely on `public/preload/services.js`.

Steps:

1. Open ZTools.
2. Load this plugin directory:

   ```text
   C:\Users\宫城楠木\Desktop\test\my-first-plugin
   ```

3. Open the plugin with one of these commands:

   - `openlist`
   - `OpenList`
   - `网盘`
   - `文件管理`

Expected result:

- The OpenList plugin UI opens.
- If opened in a normal browser instead of ZTools, the page should show a runtime hint.

## 4. Login Test

Inputs:

- OpenList base URL, for example `http://your-server:5244`
- Username
- Password

Steps:

1. Fill in the OpenList address, username, and password.
2. Click `登录`.

Expected result:

- Login succeeds.
- Token is saved automatically.
- The root directory `/` is loaded.
- File and folder rows appear in the table.

Failure checks:

- Confirm the OpenList URL has no typo.
- Confirm the OpenList service is reachable from the same machine.
- Confirm the username and password are valid.
- Check whether the OpenList server uses a reverse proxy path that must be included in the base URL.

## 5. Token Persistence Test

Steps:

1. Login successfully once.
2. Close the plugin window.
3. Open the plugin again from ZTools.

Expected result:

- The saved token is loaded.
- The root directory loads without entering the password again.

Alternative test:

1. Paste a valid token into the Token field.
2. Fill in the OpenList base URL.
3. Click `保存 Token`.

Expected result:

- The file list loads using the pasted token.

## 6. Directory Browsing Test

Steps:

1. Click a folder row.
2. Confirm the plugin enters that directory.
3. Click `上级`.
4. Click breadcrumb items.
5. Click `刷新`.

Expected result:

- Folder navigation updates the current path.
- Breadcrumbs navigate to the selected parent directory.
- Refresh reloads the current directory.
- The footer item count updates.

## 7. Upload Test

Use a small local test file first, for example a `.txt` file.

Steps:

1. Navigate to the target OpenList directory.
2. Click `上传`.
3. Select one or more local files.
4. Wait for the success message.
5. Confirm the uploaded files appear in the current directory.

Expected result:

- Upload succeeds through `PUT /api/fs/put`.
- The current directory refreshes after upload.

Failure checks:

- Confirm the current OpenList account has write permission.
- Confirm the target storage supports upload.
- Try with a small ASCII filename first.
- If upload fails behind a reverse proxy, check whether the proxy allows `PUT` requests and custom headers such as `File-Path`.

## 8. Download Test

Steps:

1. Select a normal file row.
2. Click `下载`.
3. Choose a local save path.
4. Confirm the file is saved.
5. Compare the downloaded file content with the original file.

Expected result:

- The plugin calls `/api/fs/get`.
- The returned `raw_url` is downloaded.
- The saved file is shown in the system file manager.

Failure checks:

- Confirm the selected item is a file, not a folder.
- Confirm `/api/fs/get` returns `raw_url`.
- If `raw_url` is relative, the plugin should resolve it against the OpenList base URL.

## 9. Regression Checklist

Before considering a change complete, verify:

- `npm run build` passes.
- ZTools can open the `openlist` feature.
- Login loads `/`.
- Folder navigation works.
- Upload works with a small file.
- Download works with the uploaded file.
- Reopening the plugin uses the saved token.

