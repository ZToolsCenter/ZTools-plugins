/**
 * 浏览器端 node:fs 空壳。
 *
 * @earendil-works/pi-ai 的 provider-env.js 为 Bun sandbox 回退写了
 * `require("node:fs")` 读 /proc/self/environ。该路径仅在
 * process.versions.bun 且 process.env 为空时进入，浏览器永远不会走到。
 *
 * 但静态 require 会被 Vite/Rolldown 解析，从而打出
 * 「Module "node:fs" has been externalized for browser compatibility」警告。
 * 将 node:fs alias 到本模块后，构建期干净解析，运行时若误触则安全抛错。
 */

function unavailable(method: string): never {
  throw new Error(`node:fs.${method} is not available in the browser`);
}

export function readFileSync(): never {
  return unavailable("readFileSync");
}

export function existsSync(): boolean {
  return false;
}

export function writeFileSync(): never {
  return unavailable("writeFileSync");
}

export default {
  readFileSync,
  existsSync,
  writeFileSync,
};
