(() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const pairScreen = document.querySelector("#pairScreen"), chatApp = document.querySelector("#chatApp");
  const messagesEl = document.querySelector("#messages"), pairError = document.querySelector("#pairError");
  const pairCode = document.querySelector("#pairCode"), pairButton = document.querySelector("#pairButton"), manualPairForm = document.querySelector("#manualPairForm");
  const autoPairPanel = document.querySelector("#autoPairPanel"), autoPairCode = document.querySelector("#autoPairCode"), autoPairTitle = document.querySelector("#autoPairTitle"), autoPairStatus = document.querySelector("#autoPairStatus"), autoPairError = document.querySelector("#autoPairError"), retryChatButton = document.querySelector("#retryChatButton"), manualPairButton = document.querySelector("#manualPairButton");
  const autoPairBadge = autoPairPanel.querySelector(".auto-pair__badge"), autoPairSteps = [...document.querySelectorAll(".auto-step")];
  const progress = document.querySelector("#progress"), progressBar = progress.querySelector("i");
  const SESSION_KEY = "deviceLinkSession", TRUSTED_DEVICE_KEY = "deviceLinkTrustedDevice";
  const persistentStorage = browserStorage("localStorage"), transientStorage = browserStorage("sessionStorage");
  const storedDeviceId = storageGet(persistentStorage, "deviceLinkDeviceId"), deviceId = storedDeviceId || randomDeviceId();
  if (!storedDeviceId) storageSet(persistentStorage, "deviceLinkDeviceId", deviceId);
  const defaultName = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "iPhone / iPad" : /Android/i.test(navigator.userAgent) ? "Android 手机" : "浏览器设备";
  document.querySelector("#deviceName").value = storageGet(persistentStorage, "deviceLinkDeviceName") || defaultName;
  const reduceMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const AUTO_PAIR_TIMING = Object.freeze({
    recognitionHold: 420,
    digitInterval: 100,
    verificationMinimum: 650,
    successHold: 900
  });
  let pairing, token, key, socket, reconnectTimer, scannedPairingContext, manualFallbackMessage = "", recoveryTrustedSaved = true, autoPairingAttempted = false, ownDeviceId = deviceId, currentConversationId = `device:${deviceId}`, messageMap = /* @__PURE__ */ new Map();
  function browserStorage(name) {
    try {
      return window[name];
    } catch {
      return null;
    }
  }
  function storageGet(storage, name) {
    try {
      return storage?.getItem(name) || "";
    } catch {
      return "";
    }
  }
  function storageSet(storage, name, value) {
    try {
      storage?.setItem(name, value);
      return Boolean(storage);
    } catch {
      return false;
    }
  }
  function storageRemove(storage, name) {
    try {
      storage?.removeItem(name);
    } catch {
    }
  }
  function randomDeviceId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function bytesToB64(bytes) {
    let s = "";
    new Uint8Array(bytes).forEach((b) => s += String.fromCharCode(b));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64ToBytes(value) {
    const b = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b + "=".repeat((4 - b.length % 4) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  function hasWebCrypto() {
    return Boolean(crypto.subtle);
  }
  async function deriveKey(secret, code, salt, iterations) {
    if (!hasWebCrypto()) return deviceLinkCryptoFallback.pbkdf2Sha256(enc.encode(`${secret}:${code}`), b64ToBytes(salt), iterations);
    const material = await crypto.subtle.importKey("raw", enc.encode(`${secret}:${code}`), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(salt), iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function hmacProof(secret, code, state) {
    if (!hasWebCrypto()) {
      const bits2 = await deriveKey(secret, code, state.salt, state.iterations);
      return bytesToB64(deviceLinkCryptoFallback.hmacSha256(bits2, enc.encode(`device-link-pair-v1:${state.sessionId}:${state.challenge}`)));
    }
    const material = await crypto.subtle.importKey("raw", enc.encode(`${secret}:${code}`), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(state.salt), iterations: state.iterations }, material, 256);
    const hkey = await crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return bytesToB64(await crypto.subtle.sign("HMAC", hkey, enc.encode(`device-link-pair-v1:${state.sessionId}:${state.challenge}`)));
  }
  async function trustedDeviceProof(secret, state) {
    const secretBytes = b64ToBytes(secret);
    if (secretBytes.length !== 32) throw new Error("已保存的设备凭据无效");
    const message = enc.encode(`device-link-resume-v1:${state.challengeId}:${state.challenge}`);
    if (!hasWebCrypto()) return bytesToB64(deviceLinkCryptoFallback.hmacSha256(secretBytes, message));
    const hkey = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return bytesToB64(await crypto.subtle.sign("HMAC", hkey, message));
  }
  async function importSessionKey(value) {
    const bytes = b64ToBytes(value);
    return hasWebCrypto() ? crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]) : bytes;
  }
  function nodeEnvelope(iv, webCryptoBody) {
    const body = new Uint8Array(webCryptoBody), tag = body.slice(body.length - 16), ciphertext = body.slice(0, -16), out = new Uint8Array(28 + ciphertext.length);
    out.set(iv);
    out.set(tag, 12);
    out.set(ciphertext, 28);
    return out;
  }
  function webCryptoEnvelope(nodeBytes) {
    const bytes = new Uint8Array(nodeBytes), ciphertext = bytes.slice(28), tag = bytes.slice(12, 28), body = new Uint8Array(ciphertext.length + 16);
    body.set(ciphertext);
    body.set(tag, ciphertext.length);
    return { iv: bytes.slice(0, 12), body };
  }
  async function encryptRaw(bytes, aad, usingKey = key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    if (hasWebCrypto()) {
      const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, usingKey, bytes);
      return nodeEnvelope(iv, body);
    }
    return nodeEnvelope(iv, deviceLinkCryptoFallback.encrypt(usingKey, iv, new Uint8Array(bytes), enc.encode(aad)));
  }
  async function decryptRaw(bytes, aad, usingKey = key) {
    const envelope = webCryptoEnvelope(bytes);
    if (hasWebCrypto()) return crypto.subtle.decrypt({ name: "AES-GCM", iv: envelope.iv, additionalData: enc.encode(aad) }, usingKey, envelope.body);
    return deviceLinkCryptoFallback.decrypt(usingKey, envelope.iv, envelope.body, enc.encode(aad));
  }
  async function encryptJson(value, aad) {
    return bytesToB64(await encryptRaw(enc.encode(JSON.stringify(value)), aad));
  }
  async function decryptJson(value, aad, usingKey = key) {
    return JSON.parse(dec.decode(await decryptRaw(b64ToBytes(value), aad, usingKey)));
  }
  async function encryptChunk(bytes, aad) {
    return encryptRaw(bytes, aad);
  }
  async function decryptChunk(bytes, aad) {
    return decryptRaw(bytes, aad);
  }
  function authHeaders(extra = {}) {
    return { ...extra, Authorization: `Bearer ${token}` };
  }
  function showToast(text) {
    const el = document.querySelector("#toast");
    el.textContent = text;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }
  async function copyText(value) {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("浏览器不允许复制，请长按文字手动复制");
  }
  function formatSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1073741824) return `${(size / 1048576).toFixed(1)} MB`;
    return `${(size / 1073741824).toFixed(1)} GB`;
  }
  function readPairingContextFromUrl() {
    const scannedUrl = new URL(location.href);
    const fragment = new URLSearchParams(scannedUrl.hash.slice(1));
    return {
      secret: fragment.get("pair"),
      autoCode: fragment.get("code") || "",
      automatic: fragment.get("auto") === "1",
      requestedSessionId: scannedUrl.searchParams.get("pairing"),
      hasQrCredential: fragment.has("pair") || fragment.has("code") || fragment.has("auto")
    };
  }
  function capturePairingContextFromUrl() {
    const context = readPairingContextFromUrl();
    if (!context.hasQrCredential) return context;
    scannedPairingContext = context;
    history.replaceState(null, "", location.pathname);
    return context;
  }
  function getPairingContext() {
    return scannedPairingContext || readPairingContextFromUrl();
  }
  function readStoredJson(storage, name) {
    try {
      return JSON.parse(storageGet(storage, name) || "null");
    } catch {
      storageRemove(storage, name);
      return null;
    }
  }
  function saveSession(pkg) {
    token = pkg.token;
    ownDeviceId = pkg.deviceId;
    currentConversationId = `device:${ownDeviceId}`;
    storageSet(transientStorage, SESSION_KEY, JSON.stringify({ token: pkg.token, sessionKey: pkg.sessionKey, deviceId: pkg.deviceId, serverDeviceId: pkg.serverDeviceId, expiresAt: pkg.expiresAt }));
  }
  function clearSession() {
    storageRemove(transientStorage, SESSION_KEY);
    token = void 0;
    key = void 0;
  }
  function showPairing(message = "") {
    clearTimeout(reconnectTimer);
    reconnectTimer = void 0;
    socket = void 0;
    chatApp.style.display = "none";
    pairScreen.style.display = "grid";
    showManualPairing(message);
  }
  function showManualPairing(message = "") {
    autoPairPanel.hidden = true;
    autoPairPanel.classList.remove("is-complete", "is-failed", "is-recovering");
    manualPairForm.hidden = false;
    retryChatButton.hidden = true;
    manualPairButton.hidden = true;
    autoPairError.textContent = "";
    pairError.textContent = message;
  }
  function messageTime(value) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }
  function setMessages(items) {
    for (const item of items) messageMap.set(item.id, item);
    renderMessages();
  }
  function renderMessages() {
    messagesEl.replaceChildren();
    const visible = [...messageMap.values()].filter((message) => message.conversationId === currentConversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = currentConversationId === "shared" ? "共享会话还没有消息<br>这里的内容对所有已授权设备可见" : "单独会话还没有消息<br>这里的内容只在本设备与电脑间可见";
      messagesEl.append(empty);
      return;
    }
    for (const message of visible) {
      const row = document.createElement("article");
      row.className = `row ${message.senderId === ownDeviceId ? "outgoing" : "incoming"}`;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      if (message.senderId !== ownDeviceId) {
        const sender = document.createElement("div");
        sender.className = "sender";
        sender.textContent = message.senderName;
        bubble.append(sender);
      }
      if (message.text) {
        const text = document.createElement("div");
        text.className = "text";
        if (message.kind === "link" && /^https?:\/\//.test(message.text)) {
          const link = document.createElement("a");
          link.href = message.text;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = message.text;
          text.append(link);
        } else text.textContent = message.text;
        bubble.append(text);
      }
      for (const attachment of message.attachments || []) {
        const file = document.createElement("div");
        file.className = "file";
        const icon = document.createElement("div");
        icon.className = "file-icon";
        icon.textContent = attachment.mime.startsWith("image/") ? "▧" : "◇";
        const info = document.createElement("div");
        const name = document.createElement("div");
        name.className = "file-name";
        name.textContent = attachment.name;
        const size = document.createElement("div");
        size.className = "file-size";
        size.textContent = formatSize(attachment.size);
        info.append(name, size);
        const download = document.createElement("button");
        download.className = "download";
        download.textContent = "下载";
        download.onclick = () => downloadAttachment(attachment);
        file.append(icon, info, download);
        bubble.append(file);
      }
      const meta = document.createElement("div");
      meta.className = "meta";
      const time = document.createElement("span");
      time.textContent = messageTime(message.createdAt);
      meta.append(time);
      if (message.text) {
        const copy = document.createElement("button");
        copy.className = "mini";
        copy.textContent = "复制";
        copy.onclick = async () => {
          try {
            await copyText(message.text);
            showToast("已复制");
          } catch (error) {
            showToast(error.message);
          }
        };
        meta.append(copy);
      }
      bubble.append(meta);
      row.append(bubble);
      messagesEl.append(row);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  async function fetchWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok || response.status < 500) return response;
        response.body?.cancel();
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    throw lastError || new Error("网络暂时不可用，请重试");
  }
  let downloadDbPromise;
  function downloadDb() {
    if (!globalThis.indexedDB) throw new Error("当前浏览器不支持超大文件磁盘暂存");
    return downloadDbPromise || (downloadDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("device-link-downloads", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("chunks", { keyPath: "key" });
        store.createIndex("downloadId", "downloadId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }
  async function stageDownloadChunk(downloadId, index, bytes) {
    const db = await downloadDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("chunks", "readwrite");
      transaction.objectStore("chunks").put({ key: [downloadId, index], downloadId, index, createdAt: Date.now(), blob: new Blob([bytes]) });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async function stagedDownloadChunks(downloadId) {
    const db = await downloadDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("chunks").objectStore("chunks").index("downloadId").getAll(downloadId);
      request.onsuccess = () => resolve(request.result.sort((a, b) => a.index - b.index).map((item) => item.blob));
      request.onerror = () => reject(request.error);
    });
  }
  async function clearStagedDownload(downloadId) {
    const db = await downloadDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("chunks", "readwrite"), request = transaction.objectStore("chunks").index("downloadId").openKeyCursor(IDBKeyRange.only(downloadId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          transaction.objectStore("chunks").delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async function clearOldStagedDownloads() {
    if (!globalThis.indexedDB) return;
    const db = await downloadDb(), cutoff = Date.now() - 24 * 60 * 60 * 1e3;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("chunks", "readwrite"), request = transaction.objectStore("chunks").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (cursor.value.createdAt < cutoff) cursor.delete();
          cursor.continue();
        }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async function loadPairing() {
    pairing = await fetchJson("/api/pairing", { cache: "no-store" });
    document.querySelector("#serverName").textContent = pairing.deviceName;
    return pairing;
  }
  async function refreshPairing() {
    try {
      await loadPairing();
      pairError.textContent = "";
    } catch (error) {
      pairError.textContent = error.message;
    }
  }
  function pause(ms) {
    return reduceMotion || ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
  }
  function setAutoPairStep(index, status) {
    autoPairStatus.textContent = status;
    autoPairSteps.forEach((step, stepIndex) => {
      step.classList.toggle("is-complete", stepIndex < index);
      step.classList.toggle("is-active", stepIndex === index);
      if (stepIndex === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  }
  function prepareAutoPairing(code) {
    const length = /^\d{6,12}$/.test(code) ? code.length : 6;
    manualPairForm.hidden = true;
    autoPairPanel.hidden = false;
    autoPairPanel.classList.remove("is-complete", "is-failed", "is-recovering");
    autoPairBadge.textContent = "↗";
    autoPairTitle.textContent = "已识别二维码";
    autoPairError.textContent = "";
    retryChatButton.hidden = true;
    manualPairButton.hidden = true;
    autoPairCode.style.setProperty("--code-columns", String(Math.min(length, 6)));
    autoPairCode.setAttribute("aria-label", `正在读取 ${length} 位一次性扫码授权码`);
    autoPairCode.replaceChildren(...Array.from({ length }, () => {
      const digit = document.createElement("span");
      digit.className = "auto-code__digit";
      digit.setAttribute("aria-hidden", "true");
      return digit;
    }));
    setAutoPairStep(0, "正在确认要连接的电脑");
  }
  async function animateAutoPairCode(code) {
    pairCode.value = "";
    const digits = [...autoPairCode.children];
    for (let index = 0; index < code.length; index++) {
      pairCode.value += code[index];
      digits[index].textContent = code[index];
      digits[index].classList.add("is-filled");
      await pause(AUTO_PAIR_TIMING.digitInterval);
    }
  }
  async function establishPairing(code) {
    const { secret, requestedSessionId } = getPairingContext();
    const latestPairing = await loadPairing();
    const hasQrContext = Boolean(secret || requestedSessionId);
    let pairingSecret = latestPairing.manualKey, mode = "manual";
    if (hasQrContext) {
      if (!requestedSessionId) throw new Error("二维码缺少配对会话标识，请重新扫描最新二维码");
      if (!secret) throw new Error("二维码缺少一次性连接密钥，请重新扫描");
      if (requestedSessionId !== latestPairing.sessionId) throw new Error("配对信息已过期，请在电脑端刷新二维码");
      pairingSecret = secret;
      mode = "qr";
    } else if (!pairingSecret) throw new Error("电脑端暂不支持手动连接，请刷新配对信息");
    const matchingCode = String(code || "").trim();
    if (!/^\d{6,12}$/.test(matchingCode)) throw new Error("请输入 6–12 位数字匹配码");
    const name = document.querySelector("#deviceName").value.trim() || defaultName;
    const proof = await hmacProof(pairingSecret, matchingCode, latestPairing);
    const pairKey = await deriveKey(pairingSecret, matchingCode, latestPairing.salt, latestPairing.iterations);
    const result = await fetchJson("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: latestPairing.sessionId, mode, proof, deviceName: name, deviceId, platform: navigator.platform || "browser" }) });
    const pkg = await decryptJson(result.package, `pair:${latestPairing.sessionId}`, pairKey);
    saveSession(pkg);
    key = await importSessionKey(pkg.sessionKey);
    storageSet(persistentStorage, "deviceLinkDeviceName", name);
    const trustedSaved = !pkg.resumeSecret || storageSet(persistentStorage, TRUSTED_DEVICE_KEY, JSON.stringify({ deviceId: pkg.deviceId, resumeSecret: pkg.resumeSecret, serverDeviceId: pkg.serverDeviceId }));
    if (mode === "qr") scannedPairingContext = void 0;
    pairCode.value = "";
    return { trustedSaved };
  }
  async function openSavedChat(trustedSaved) {
    try {
      await openChat();
    } catch (error) {
      if (error.status !== 401) throw error;
      clearSession();
      if (!await resumeTrustedDevice()) throw error;
      await openChat();
    }
    if (!trustedSaved) showToast("浏览器禁止保存设备授权，下次访问需要重新配对");
  }
  function showPairedRecovery(error, trustedSaved = true) {
    recoveryTrustedSaved = trustedSaved;
    manualPairForm.hidden = true;
    autoPairPanel.hidden = false;
    autoPairPanel.classList.remove("is-failed");
    autoPairPanel.classList.add("is-complete", "is-recovering");
    autoPairBadge.textContent = "↻";
    autoPairTitle.textContent = "设备已授权";
    autoPairStatus.textContent = "进入会话时网络暂时不可用";
    autoPairError.textContent = `连接信息已安全保留：${error.message}`;
    manualFallbackMessage = error.message;
    manualPairButton.hidden = error.status !== 401;
    retryChatButton.hidden = false;
  }
  async function pair() {
    pairError.textContent = "";
    pairButton.disabled = true;
    pairButton.textContent = "正在建立连接…";
    let paired;
    try {
      paired = await establishPairing(pairCode.value);
      await openSavedChat(paired.trustedSaved);
    } catch (error) {
      if (paired) showPairedRecovery(error, paired.trustedSaved);
      else pairError.textContent = error.message;
    } finally {
      pairButton.disabled = false;
      pairButton.textContent = "安全连接";
    }
  }
  async function autoConnectFromQr() {
    const context = getPairingContext();
    if (autoPairingAttempted || !context.automatic) return false;
    autoPairingAttempted = true;
    if (autoPairPanel.hidden) prepareAutoPairing(context.autoCode);
    let paired;
    try {
      if (!context.secret || !context.requestedSessionId || !/^\d{6,12}$/.test(context.autoCode)) {
        throw new Error("二维码缺少自动连接信息，请重新扫描电脑端最新二维码");
      }
      await pause(AUTO_PAIR_TIMING.recognitionHold);
      setAutoPairStep(1, "正在读取一次性扫码授权码");
      await animateAutoPairCode(context.autoCode);
      setAutoPairStep(2, "正在校验并建立加密连接");
      [paired] = await Promise.all([
        establishPairing(context.autoCode),
        pause(AUTO_PAIR_TIMING.verificationMinimum)
      ]);
      autoPairPanel.classList.add("is-complete");
      autoPairBadge.textContent = "✓";
      autoPairTitle.textContent = "连接完成";
      setAutoPairStep(3, "安全连接已建立，正在进入会话");
      await pause(AUTO_PAIR_TIMING.successHold);
      await openSavedChat(paired.trustedSaved);
      return true;
    } catch (error) {
      if (paired) {
        showPairedRecovery(error, paired.trustedSaved);
        return false;
      }
      manualFallbackMessage = error.message;
      autoPairPanel.classList.add("is-failed");
      autoPairBadge.textContent = "!";
      autoPairTitle.textContent = "自动连接未完成";
      autoPairStatus.textContent = "请重新扫码，或改为手动输入";
      autoPairError.textContent = error.message;
      manualPairButton.hidden = false;
      return false;
    }
  }
  async function restoreSession() {
    try {
      const saved = readStoredJson(transientStorage, SESSION_KEY);
      if (!saved || new Date(saved.expiresAt) <= /* @__PURE__ */ new Date()) return false;
      if (saved.serverDeviceId && pairing.serverDeviceId && saved.serverDeviceId !== pairing.serverDeviceId) return false;
      saveSession(saved);
      key = await importSessionKey(saved.sessionKey);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }
  async function resumeTrustedDevice() {
    const trusted = readStoredJson(persistentStorage, TRUSTED_DEVICE_KEY);
    if (!trusted?.deviceId || !trusted?.resumeSecret) return false;
    if (trusted.serverDeviceId && pairing.serverDeviceId && trusted.serverDeviceId !== pairing.serverDeviceId) {
      storageRemove(persistentStorage, TRUSTED_DEVICE_KEY);
      return false;
    }
    try {
      const challenge = await fetchJson("/api/resume/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: trusted.deviceId }) });
      if (trusted.serverDeviceId && challenge.serverDeviceId !== trusted.serverDeviceId) throw new Error("连接的电脑已发生变化，请重新配对");
      const resumeKey = await importSessionKey(trusted.resumeSecret);
      const proof = await trustedDeviceProof(trusted.resumeSecret, challenge);
      const result = await fetchJson("/api/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: trusted.deviceId, challengeId: challenge.challengeId, proof }) });
      const pkg = await decryptJson(result.package, `resume:${trusted.deviceId}:${challenge.challengeId}`, resumeKey);
      saveSession(pkg);
      key = await importSessionKey(pkg.sessionKey);
      return true;
    } catch (error) {
      clearSession();
      if (error.status === 401 || error.status === 404) {
        storageRemove(persistentStorage, TRUSTED_DEVICE_KEY);
        return false;
      }
      throw error;
    }
  }
  async function openChat() {
    const chatTitle = document.querySelector("#chatTitle");
    chatTitle.textContent = pairing.deviceName || "设备互联";
    await loadMessages();
    pairScreen.style.display = "none";
    chatApp.style.display = "grid";
    chatTitle.focus({ preventScroll: true });
    connectSocket();
  }
  async function loadMessages() {
    const result = await fetchJson("/api/messages", { headers: authHeaders() });
    setMessages(await decryptJson(result.data, `messages:${ownDeviceId}`));
  }
  function scheduleTrustedReconnect(message) {
    clearSession();
    clearTimeout(reconnectTimer);
    const status = document.querySelector("#status");
    status.textContent = message;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = void 0;
      try {
        await loadPairing();
        if (!await resumeTrustedDevice()) return showPairing("设备授权已失效，请重新输入匹配码");
        await loadMessages();
        connectSocket();
      } catch {
        scheduleTrustedReconnect("连接暂时不可用，正在重试…");
      }
    }, 1800);
  }
  function connectSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = void 0;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    const status = document.querySelector("#status");
    socket.onopen = () => {
      status.textContent = "安全连接已建立";
      status.className = "status online";
    };
    socket.onclose = (event) => {
      status.className = "status";
      if (event.code === 4001) {
        scheduleTrustedReconnect("授权已过期，正在自动恢复…");
        return;
      }
      if (event.code === 4000) {
        clearSession();
        status.textContent = "此设备已在其他页面连接";
        showToast("当前连接已由另一页面接管");
        return;
      }
      if (event.code === 4003) {
        clearSession();
        showPairing("连接校验失败，请重新打开页面");
        return;
      }
      scheduleTrustedReconnect("连接已断开，正在自动恢复…");
    };
    socket.onmessage = async (event) => {
      try {
        const outer = JSON.parse(event.data), message = await decryptJson(outer.data, `ws:${ownDeviceId}`);
        if (message.type === "messages:sync") setMessages(message.data);
        if (message.type === "message:new") setMessages([message.data]);
      } catch {
        socket.close(4003, "Invalid encrypted message");
      }
    };
  }
  async function sendText() {
    const composer = document.querySelector("#composer"), text = composer.value.trim();
    if (!text || socket?.readyState !== 1) return;
    socket.send(JSON.stringify({ data: await encryptJson({ type: "send:text", data: { text, conversationId: currentConversationId } }, `ws:${ownDeviceId}`) }));
    composer.value = "";
  }
  async function uploadFile(file) {
    progress.style.display = "block";
    try {
      const created = await fetchJson("/api/transfers", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ data: await encryptJson({ name: file.name, size: file.size, mime: file.type || "application/octet-stream", conversationId: currentConversationId }, `transfer:new:${ownDeviceId}`) }) });
      const transfer = await decryptJson(created.data, `transfer:created:${ownDeviceId}`);
      let index = 0, offset = 0;
      while (offset < file.size) {
        const plain = await file.slice(offset, offset + transfer.chunkSize).arrayBuffer();
        const encrypted = await encryptChunk(plain, `transfer:${transfer.id}:${index}`);
        const response = await fetchWithRetry(`/api/transfers/${transfer.id}/${index}`, { method: "PUT", headers: authHeaders({ "Content-Type": "application/octet-stream" }), body: encrypted });
        const result = await response.json().catch(() => ({}));
        if (!response.ok && !(response.status === 409 && result.nextIndex === index + 1)) throw new Error(result.error || "文件分块发送失败");
        offset += plain.byteLength;
        index++;
        progressBar.style.width = `${Math.round(offset / file.size * 100)}%`;
      }
      await fetchJson(`/api/transfers/${transfer.id}/complete`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
      showToast(`${file.name} 已发送`);
    } finally {
      setTimeout(() => {
        progress.style.display = "none";
        progressBar.style.width = "0";
      }, 500);
    }
  }
  async function downloadAttachment(attachment) {
    progress.style.display = "block";
    let writable = null, downloadId = "";
    try {
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({ suggestedName: attachment.name });
        writable = await handle.createWritable();
      }
      const metaResult = await fetchJson(`/api/attachments/${attachment.id}/meta`, { headers: authHeaders() });
      const meta = await decryptJson(metaResult.data, `attachment:meta:${ownDeviceId}`), stageOnDisk = !writable && meta.size > 128 * 1024 * 1024;
      if (stageOnDisk) {
        if (!globalThis.indexedDB) throw new Error("当前浏览器无法安全暂存超大文件");
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.quota && (estimate.usage || 0) + meta.size > estimate.quota * 0.9) throw new Error("浏览器可用存储空间不足，无法暂存该文件");
        downloadId = `${attachment.id}:${Date.now()}`;
      }
      const chunks = [];
      for (let index = 0; index < meta.chunks; index++) {
        const response = await fetchWithRetry(`/api/attachments/${attachment.id}/chunks/${index}`, { headers: authHeaders() });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "下载失败");
        }
        const plain = await decryptChunk(await response.arrayBuffer(), `attachment:${attachment.id}:${index}`);
        if (writable) await writable.write(new Uint8Array(plain));
        else if (stageOnDisk) await stageDownloadChunk(downloadId, index, plain);
        else chunks.push(plain);
        progressBar.style.width = `${Math.round((index + 1) / Math.max(meta.chunks, 1) * 100)}%`;
      }
      if (writable) {
        await writable.close();
        writable = null;
      } else {
        const parts = stageOnDisk ? await stagedDownloadChunks(downloadId) : chunks, blob = new Blob(parts, { type: meta.mime }), url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url;
        link.download = meta.name;
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          if (downloadId) clearStagedDownload(downloadId).catch(() => {
          });
        }, 6e4);
      }
    } catch (error) {
      if (writable) try {
        await writable.abort();
      } catch {
      }
      ;
      if (downloadId) await clearStagedDownload(downloadId).catch(() => {
      });
      if (error.name !== "AbortError") showToast(error.message);
    } finally {
      setTimeout(() => {
        progress.style.display = "none";
        progressBar.style.width = "0";
      }, 500);
    }
  }
  async function init() {
    clearOldStagedDownloads().catch(() => {
    });
    try {
      const pairingContext = capturePairingContextFromUrl();
      if (pairingContext.automatic) {
        prepareAutoPairing(pairingContext.autoCode);
        await autoConnectFromQr();
        return;
      }
      showManualPairing();
      await loadPairing();
      if (await restoreSession()) {
        try {
          await openChat();
          return;
        } catch (error) {
          clearSession();
          if (error.status !== 401) throw error;
        }
      }
      if (await resumeTrustedDevice()) {
        await openChat();
        return;
      }
      await autoConnectFromQr();
    } catch (error) {
      pairError.textContent = error.message;
    }
  }
  document.querySelector("#pairButton").onclick = pair;
  manualPairButton.onclick = () => {
    scannedPairingContext = void 0;
    pairCode.value = "";
    showManualPairing(manualFallbackMessage);
    pairCode.focus();
  };
  retryChatButton.onclick = async () => {
    retryChatButton.disabled = true;
    retryChatButton.textContent = "正在重试…";
    autoPairError.textContent = "";
    try {
      await openSavedChat(recoveryTrustedSaved);
    } catch (error) {
      autoPairError.textContent = `仍无法进入会话：${error.message}`;
      if (error.status === 401) manualPairButton.hidden = false;
    } finally {
      retryChatButton.disabled = false;
      retryChatButton.textContent = "重试进入会话";
    }
  };
  document.querySelector("#conversationSelect").onchange = (e) => {
    currentConversationId = e.target.value === "shared" ? "shared" : `device:${ownDeviceId}`;
    renderMessages();
  };
  document.querySelector("#sendButton").onclick = sendText;
  document.querySelector("#composer").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };
  document.querySelector("#attachButton").onclick = () => document.querySelector("#fileInput").click();
  document.querySelector("#fileInput").onchange = async (e) => {
    for (const file of e.target.files || []) try {
      await uploadFile(file);
    } catch (error) {
      showToast(error.message);
    }
    e.target.value = "";
  };
  window.addEventListener("hashchange", refreshPairing);
  init();
})();
