// ONNX 子进程启动失败的诊断辅助（纯 CJS，不依赖 electron）。
//
// WHY THIS FILE: onnx_ocr_server.mjs 在模块顶层静态 import 'onnxruntime-node'，
// ESM 的静态 import 在模块求值前解析，原生模块加载失败（.node / .dll 缺失、
// VC++ 运行库缺失、架构不匹配）会在任何 try/catch 之前让进程直接退出 ——
// stdout 一个字节都没有，preload 只能报「服务启动失败」，真正的原因只留在
// stderr 里并被丢弃。本模块把 stderr 尾部与常见失败模式翻译成可执行的提示。
//
// 单独成模块是为了能在纯 Node 下单测：preload.js 顶层 require("electron")。

const path = require("node:path");

// onnxruntime-node 把平台二进制放在 bin/napi-v3/<platform>/<arch>/ 下，
// 安装时只保留当前平台那一份（见 preload.js 的 trimPlatformBin）。
const NATIVE_BIN_SEGMENTS = ["node_modules", "onnxruntime-node", "bin", "napi-v3"];

// onnxruntime.dll 的导入表实测依赖这三个（MSVC 2015-2022 x64 运行库）。
// 干净的系统/虚拟机镜像里 VCRUNTIME140_1.dll 经常缺失，表现为 LoadLibrary 失败。
const VC_RUNTIME_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

const VC_RUNTIME_HINT = "系统缺少 Microsoft Visual C++ 运行库（vc_redist.x64.exe）";

function nativeBinDir(runtimeDir, platform, arch) {
  return path.join(runtimeDir, ...NATIVE_BIN_SEGMENTS, String(platform), String(arch));
}

// 返回缺失的运行库文件名；existsSync 由调用方注入，便于单测。
function missingVcRuntimeDlls(systemRoot, existsSync) {
  if (!systemRoot) return [];
  return VC_RUNTIME_DLLS.filter((name) => {
    try {
      return !existsSync(path.join(systemRoot, "System32", name));
    } catch (_) {
      return false;
    }
  });
}

function isNativeLoadFailure(text) {
  return /ERR_DLOPEN_FAILED|The specified module could not be found|LoadLibrary|not a valid Win32 application|%1 is not a valid/i
    .test(String(text || ""));
}

// 取 stderr 有效尾部：去掉栈帧、Node 版本行等噪声，压缩成一行。
function tailSnippet(text, maxLen = 300) {
  const raw = String(text || "");
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const kept = lines.filter((line) => !/^at\s/.test(line)
    && !/^Node\.js v/.test(line)
    && !/^node:internal/.test(line));
  const text2 = (kept.length ? kept : lines).join(" ");
  if (!text2) return "";
  return text2.length > maxLen ? `…${text2.slice(-maxLen)}` : text2;
}

// 组装给用户看的启动失败信息：
//   <兜底文案>（退出码 N）｜<stderr 尾部>｜<可执行建议>
function startupErrorDetail(options) {
  const {
    stderrTail = "",
    exitCode = null,
    signal = null,
    platform = "",
    systemRoot = "",
    existsSync = null,
    fallback = "ONNX OCR 服务启动失败",
  } = options || {};

  const parts = [];
  if (exitCode !== null && exitCode !== undefined) parts.push(`退出码 ${exitCode}`);
  if (signal) parts.push(`信号 ${signal}`);

  const snippet = tailSnippet(stderrTail);
  if (snippet) parts.push(snippet);

  let message = parts.length ? `${fallback}（${parts.join("｜")}）` : fallback;

  // 只在原生模块确实加载失败、且确实是 Windows 时提示运行库，避免误导。
  if (platform === "win32" && isNativeLoadFailure(stderrTail) && typeof existsSync === "function") {
    const missing = missingVcRuntimeDlls(systemRoot, existsSync);
    if (missing.length) {
      message += `｜${VC_RUNTIME_HINT}：缺 ${missing.join(" / ")}`;
    }
  }
  return message;
}

module.exports = {
  VC_RUNTIME_DLLS,
  VC_RUNTIME_HINT,
  nativeBinDir,
  missingVcRuntimeDlls,
  isNativeLoadFailure,
  tailSnippet,
  startupErrorDetail,
};
