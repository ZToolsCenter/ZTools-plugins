"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

let runtimeRoot = null;
let externalRequire = null;

function configureRuntimeRoot(root) {
  runtimeRoot = path.resolve(root);
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const anchor = path.join(runtimeRoot, "package.json");
  if (!fs.existsSync(anchor)) fs.writeFileSync(anchor, '{"private":true,"type":"commonjs"}\n', { mode: 0o600 });
  externalRequire = createRequire(anchor);
  return runtimeRoot;
}

function localRequire(packageName) {
  try { return require(packageName); }
  catch (error) { if (error?.code !== "MODULE_NOT_FOUND") throw error; }
  return undefined;
}

function runtimeRequire(packageName) {
  const local = localRequire(packageName);
  if (local !== undefined) return local;
  if (externalRequire) {
    try { return externalRequire(packageName); }
    catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  const error = new Error(`转换运行时尚未安装：${packageName}`);
  error.code = "RUNTIME_PACKAGE_MISSING";
  error.details = { package: packageName };
  throw error;
}

function resolvePackageJson(packageName) {
  try { return require.resolve(`${packageName}/package.json`); } catch {}
  if (externalRequire) { try { return externalRequire.resolve(`${packageName}/package.json`); } catch {} }
  return null;
}

function localPackageVersion(packageName) {
  try { return JSON.parse(fs.readFileSync(require.resolve(`${packageName}/package.json`), "utf8")).version; } catch { return undefined; }
}

function runtimeResolve(specifier) {
  try { return require.resolve(specifier); } catch {}
  if (externalRequire) { try { return externalRequire.resolve(specifier); } catch {} }
  return null;
}

function runtimePackageVersion(packageName) {
  const packagePath = resolvePackageJson(packageName);
  if (!packagePath) return undefined;
  try { return JSON.parse(fs.readFileSync(packagePath, "utf8")).version; } catch { return undefined; }
}

function runtimePath(...parts) { return runtimeRoot ? path.join(runtimeRoot, ...parts) : undefined; }

module.exports = { configureRuntimeRoot, runtimeRequire, runtimeResolve, localPackageVersion, runtimePackageVersion, runtimePath, get runtimeRoot() { return runtimeRoot; } };
