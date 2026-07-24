import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import { open } from "lmdb";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "dist");
const home = os.homedir();
const modernRoot = path.join(home, ".ztools");
const legacyRoot = path.join(home, "Library", "Application Support", "ZTools");
const modernLayout = await fs
  .access(path.join(modernRoot, "version.json"))
  .then(() => true)
  .catch(() => false);
const dataRoot = modernLayout ? modernRoot : legacyRoot;
const target = path.join(dataRoot, "plugins", "image-batch-studio");
const dbPath = modernLayout
  ? path.join(dataRoot, "lmdb", "device")
  : path.join(dataRoot, "lmdb");
const pluginName = "image-batch-studio";

function parseJson(value) {
  if (!value) return null;
  return JSON.parse(value);
}

function nextRev(existingRev) {
  const current = Number.parseInt(String(existingRev || "").split("-")[0], 10);
  const sequence = Number.isFinite(current) ? current + 1 : 1;
  return `${sequence}-${crypto.randomBytes(16).toString("hex")}`;
}

function readMetaRev(metaValue) {
  if (!metaValue) return undefined;
  if (typeof metaValue === "string" && metaValue.startsWith("{")) {
    return JSON.parse(metaValue)._rev;
  }
  return metaValue;
}

function putZToolsDoc(env, mainDb, metaDb, key, data) {
  const id = `ZTOOLS/${key}`;
  const existingRev = readMetaRev(metaDb.get(id));
  const rev = nextRev(existingRev);
  env.transactionSync(() => {
    mainDb.putSync(id, JSON.stringify({ _id: id, data, _rev: rev }));
    metaDb.putSync(id, rev);
  });
}

function openZToolsDb() {
  const env = open({
    path: dbPath,
    mapSize: 2 * 1024 * 1024 * 1024,
    maxDbs: modernLayout ? 6 : 3,
    compression: false,
    encoding: "binary"
  });
  return {
    env,
    mainDb: env.openDB({ name: "main", encoding: "string" }),
    metaDb: env.openDB({ name: "meta", encoding: "string" })
  };
}

function buildPluginRecord(pluginConfig) {
  return {
    name: pluginConfig.name,
    title: pluginConfig.title,
    version: pluginConfig.version,
    description: pluginConfig.description || "",
    author: pluginConfig.author || "",
    homepage: pluginConfig.homepage || "",
    logo: pluginConfig.logo ? pathToFileURL(path.join(target, pluginConfig.logo)).href : "",
    main: pluginConfig.main,
    preload: pluginConfig.preload,
    features: Array.isArray(pluginConfig.features) ? pluginConfig.features : [],
    path: target,
    storageKind: "directory",
    isDevelopment: false,
    installedAt: new Date().toISOString(),
    installedFrom: "local"
  };
}

async function registerInstalledPlugin(pluginConfig) {
  const { env, mainDb, metaDb } = openZToolsDb();
  try {
    const doc = parseJson(mainDb.get("ZTOOLS/plugins"));
    const plugins = Array.isArray(doc?.data) ? doc.data : [];
    const filtered = plugins.filter((plugin) => plugin?.name !== pluginName);
    filtered.push(buildPluginRecord(pluginConfig));
    putZToolsDoc(env, mainDb, metaDb, "plugins", filtered);
    env.sync();
  } finally {
    env.close();
  }
}

await fs.access(path.join(source, "plugin.json"));
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, { recursive: true });
await registerInstalledPlugin(JSON.parse(await fs.readFile(path.join(target, "plugin.json"), "utf8")));
console.log(JSON.stringify({ target, dbPath, layout: modernLayout ? "3.x" : "legacy" }, null, 2));
