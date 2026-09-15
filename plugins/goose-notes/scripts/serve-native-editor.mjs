import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("dist-native-editor");
const mockHost = process.argv.includes("--mock");
const portArgument = process.argv.find((argument) => /^\d+$/.test(argument));
const port = Number(portArgument ?? 6012);

if (!existsSync(join(root, "index.html"))) {
  throw new Error("dist-native-editor/index.html 不存在，请先生成 native-editor 产物。");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".otf", "font/otf"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const MOCK_HOST_SCRIPT = String.raw`
(() => {
  const parameters = new URLSearchParams(window.location.search);
  const state = parameters.get("state") || "blocks";
  const pageID = "mock://native-editor/preview.md";
  let revision = 1;
  let generation = 1;
  const messages = [];
  const storageKey = "native-editor-mock:" + state + ":markdown";
  const initialMarkdown = state === "repair"
    ? "> [!NOTE]\n> 这段 Markdown 需要确认修复后才能进入块编辑器。\n"
    : "# 生产编辑器验收\n\n这是由 goose-note 最新生成物直接运行的编辑器。\n\n## 核心能力\n\n- Markdown 是唯一正文来源\n- 保存、冲突与本地资源均由宿主桥接\n- 生成物只包含编辑器与配套能力\n";
  let markdown = sessionStorage.getItem(storageKey) || initialMarkdown;

  function envelope(requestID) {
    return { version: 1, requestID, pageID, revision };
  }

  function acknowledge(message, status, detail) {
    if (status === "saved") revision += 1;
    window.gooseEditor?.receiveAcknowledgement({
      ...envelope(message.requestID),
      status,
      message: detail,
    });
  }

  function receivePage({ advanceGeneration = false } = {}) {
    if (advanceGeneration) generation += 1;
    void window.gooseEditor?.receivePage({
      ...envelope(crypto.randomUUID()),
      generation,
      title: "preview.md",
      markdown,
      appearance: parameters.get("theme") === "dark" ? "dark" : "light",
      editorFont: "sans",
      fullWidth: parameters.get("fullWidth") === "true",
      reduceMotion: parameters.get("reduceMotion") === "true",
      increaseContrast: parameters.get("contrast") === "true",
    });
  }

  window.__nativeEditorMock = { messages, receivePage };
  window.webkit = {
    messageHandlers: {
      gooseNotes: {
        postMessage(message) {
          messages.push(structuredClone(message));
          if (message.type === "ready") {
            queueMicrotask(receivePage);
          } else if (message.type === "reloadRequest") {
            queueMicrotask(() => receivePage({ advanceGeneration: true }));
          } else if (message.type === "change") {
            window.setTimeout(() => {
              if (state === "error") acknowledge(message, "failed", "开发替身：模拟磁盘写入失败");
              else if (state === "conflict") acknowledge(message, "conflict", "开发替身：模拟文件版本冲突");
              else {
                markdown = message.markdown;
                sessionStorage.setItem(storageKey, markdown);
                acknowledge(message, "saved");
              }
            }, 180);
          } else if (message.type === "resolveLocalResource") {
            window.gooseEditor?.receiveLocalResource({
              ...envelope(message.requestID),
              status: "rejected",
              message: "开发替身未映射本地资源。",
            });
          } else if (message.type === "saveLocalAsset") {
            window.gooseEditor?.receiveLocalAsset({
              ...envelope(message.requestID),
              status: "rejected",
              message: "开发替身不写入本地文件。",
            });
          }
        },
      },
    },
  };
})();
`;

function resolveRequestPath(url = "/") {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relativePath = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
  const filePath = resolve(root, relativePath);
  return filePath === root || filePath.startsWith(`${root}${sep}`) ? filePath : null;
}

const server = createServer((request, response) => {
  const requestURL = new URL(request.url ?? "/", "http://localhost");
  if (requestURL.pathname === "/favicon.ico") {
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (mockHost && requestURL.pathname === "/__native-editor-mock-host.js") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
    response.end(MOCK_HOST_SCRIPT);
    return;
  }

  const filePath = resolveRequestPath(request.url);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
  };
  if (mockHost && filePath === join(root, "index.html")) {
    const html = readFileSync(filePath, "utf8").replace(
      '<script defer src="./assets/editor.js"></script>',
      '<script defer src="./__native-editor-mock-host.js"></script>\n    <script defer src="./assets/editor.js"></script>',
    );
    response.writeHead(200, headers);
    response.end(html);
    return;
  }

  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  const suffix = mockHost ? "?state=blocks" : "";
  process.stdout.write(`native-editor server: http://127.0.0.1:${port}/${suffix}\n`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
