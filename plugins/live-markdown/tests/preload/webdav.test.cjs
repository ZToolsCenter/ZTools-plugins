"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const webdavApi = require("../../preload/webdav-sync.cjs");

const pluginRoot = path.resolve(__dirname, "../..");
const testTmpDir = path.join(pluginRoot, ".cache", "test-tmp-webdav");

function createMockWebdavServer({ expectedUser = "harris", expectedPass = "secret-token" } = {}) {
  const collections = new Set(["/", "/dav", "/dav/"]);
  const files = new Map(); // pathname -> { content: string, mtimeMs: number, etag: string }

  const server = http.createServer((req, res) => {
    // Verify Basic Auth
    const authHeader = req.headers.authorization || "";
    const expectedAuth =
      "Basic " + Buffer.from(`${expectedUser}:${expectedPass}`, "utf8").toString("base64");
    if (authHeader !== expectedAuth) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="WebDAV"' });
      res.end("Unauthorized");
      return;
    }

    const parsedUrl = new URL(req.url, "http://127.0.0.1");
    const decodedPath = decodeURIComponent(parsedUrl.pathname);

    if (req.method === "MKCOL") {
      const colPath = decodedPath.endsWith("/") ? decodedPath : `${decodedPath}/`;
      if (collections.has(colPath)) {
        res.writeHead(405);
        res.end("Already Exists");
        return;
      }
      collections.add(colPath);
      res.writeHead(201);
      res.end("Created");
      return;
    }

    if (req.method === "PROPFIND") {
      const colPath = decodedPath.endsWith("/") ? decodedPath : `${decodedPath}/`;
      if (!collections.has(colPath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const responses = [
        `<D:response>
          <D:href>${colPath}</D:href>
          <D:propstat>
            <D:prop>
              <D:resourcetype><D:collection/></D:resourcetype>
            </D:prop>
            <D:status>HTTP/1.1 200 OK</D:status>
          </D:propstat>
        </D:response>`
      ];

      for (const [filePath, meta] of files.entries()) {
        if (filePath.startsWith(colPath)) {
          const rel = filePath.slice(colPath.length);
          if (rel && !rel.includes("/")) {
            const encodedFileHref =
              colPath + encodeURIComponent(rel);
            responses.push(
              `<D:response>
                <D:href>${encodedFileHref}</D:href>
                <D:propstat>
                  <D:prop>
                    <D:resourcetype/>
                    <D:getcontentlength>${Buffer.byteLength(meta.content, "utf8")}</D:getcontentlength>
                    <D:getlastmodified>${new Date(meta.mtimeMs).toUTCString()}</D:getlastmodified>
                    <D:getetag>"${meta.etag}"</D:getetag>
                  </D:prop>
                  <D:status>HTTP/1.1 200 OK</D:status>
                </D:propstat>
              </D:response>`
            );
          }
        }
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
          ${responses.join("\n")}
        </D:multistatus>`;
      res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
      res.end(xml);
      return;
    }

    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf8");
        const isUpdate = files.has(decodedPath);
        files.set(decodedPath, {
          content,
          mtimeMs: Date.now(),
          etag: `etag-${Date.now()}`
        });
        res.writeHead(isUpdate ? 204 : 201);
        res.end();
      });
      return;
    }

    if (req.method === "GET") {
      const record = files.get(decodedPath);
      if (!record) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Last-Modified": new Date(record.mtimeMs).toUTCString()
      });
      res.end(record.content, "utf8");
      return;
    }

    if (req.method === "DELETE") {
      files.delete(decodedPath);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return { server, collections, files };
}

test("preload WebDAV sync engine: connection test, MKCOL, PROPFIND, PUT, GET, DELETE, and bidirectional workspace sync", async () => {
  fs.rmSync(testTmpDir, { recursive: true, force: true });
  fs.mkdirSync(testTmpDir, { recursive: true });

  const { server, files } = createMockWebdavServer({
    expectedUser: "typora_user",
    expectedPass: "app_pass_123"
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const serverUrl = `http://127.0.0.1:${address.port}/dav/`;

  try {
    // 1. Test authentication failure (401)
    const badRes = await webdavApi.testWebdavConnection({
      enabled: true,
      serverUrl,
      username: "typora_user",
      password: "wrong_password",
      remotePath: "/TyporaNotes/"
    });
    assert.equal(badRes.ok, false);
    assert.equal(badRes.status, 401);

    // 2. Test valid connection & auto MKCOL
    const config = {
      enabled: true,
      serverUrl,
      username: "typora_user",
      password: "app_pass_123",
      remotePath: "/TyporaNotes/",
      autoSyncOnSave: true,
      syncDirection: "bidirectional"
    };

    const okRes = await webdavApi.testWebdavConnection(config);
    assert.equal(okRes.ok, true);
    assert.equal(okRes.fileCount, 0);

    // 3. Push a Markdown document to WebDAV
    const pushed = await webdavApi.pushWebdavDocument(
      config,
      "CloudNote.md",
      "# Cloud Note\n\nSynced via WebDAV PUT.\n"
    );
    assert.equal(pushed.ok, true);
    assert.equal(pushed.name, "CloudNote.md");

    // 4. List remote WebDAV files via PROPFIND
    const listed = await webdavApi.listWebdavFiles(config);
    assert.equal(listed.ok, true);
    assert.equal(listed.files.length, 1);
    assert.equal(listed.files[0].name, "CloudNote.md");

    // 5. Pull remote document into memory & local directory
    const pulled = await webdavApi.pullWebdavDocument(
      config,
      "CloudNote.md",
      testTmpDir
    );
    assert.equal(pulled.ok, true);
    assert.match(pulled.content, /Synced via WebDAV PUT/);
    assert.ok(pulled.path && fs.existsSync(pulled.path));

    // 6. Bidirectional workspace sync (local has LocalOnly.md, remote has RemoteOnly.md)
    fs.writeFileSync(
      path.join(testTmpDir, "LocalOnly.md"),
      "# Local Only\n\nCreated locally.\n",
      "utf8"
    );
    files.set("/dav/TyporaNotes/RemoteOnly.md", {
      content: "# Remote Only\n\nCreated on cloud.\n",
      mtimeMs: Date.now() + 5000,
      etag: "remote-etag-1"
    });

    const syncRes = await webdavApi.syncWorkspaceWithWebdav(config, {
      localDir: testTmpDir,
      direction: "bidirectional"
    });
    assert.equal(syncRes.ok, true);
    assert.ok(syncRes.uploaded.includes("LocalOnly.md"));
    assert.ok(syncRes.downloaded.includes("RemoteOnly.md"));
    assert.ok(Array.isArray(syncRes.downloadedPaths));
    assert.ok(
      syncRes.downloadedPaths.includes(path.join(testTmpDir, "RemoteOnly.md"))
    );
    assert.ok(fs.existsSync(path.join(testTmpDir, "RemoteOnly.md")));
    assert.equal(syncRes.remoteFiles.length, 3);

    // 6b. Regression test: parsePropfindXml without <D:getlastmodified> sets mtimeMs = 0 (not Date.now())
    const xmlWithoutMtime = `<?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:">
        <D:response>
          <D:href>/dav/TyporaNotes/NoTimestamp.md</D:href>
          <D:propstat>
            <D:prop>
              <D:resourcetype/>
              <D:getcontentlength>42</D:getcontentlength>
            </D:prop>
          </D:propstat>
        </D:response>
      </D:multistatus>`;
    const parsedNoMtime = webdavApi.parsePropfindXml(
      xmlWithoutMtime,
      "/dav/TyporaNotes/"
    );
    assert.equal(parsedNoMtime.length, 1);
    assert.equal(parsedNoMtime[0].name, "NoTimestamp.md");
    assert.equal(parsedNoMtime[0].mtimeMs, 0);
    assert.equal(parsedNoMtime[0].hasValidMtime, false);

    // 7. Delete remote document
    const delRes = await webdavApi.deleteWebdavDocument(config, "CloudNote.md");
    assert.equal(delRes.ok, true);
    const afterDel = await webdavApi.listWebdavFiles(config);
    assert.equal(afterDel.files.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  }
});
