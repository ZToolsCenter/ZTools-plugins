"use strict";
const http = require('node:http');
function createE2EMockWebdavServer({ expectedUser = 'typora_e2e', expectedPass = 'pass_123' } = {}) {
  const collections = new Set(['/', '/dav', '/dav/', '/dav/TyporaNotes/']);
  const files = new Map([
    [
      '/dav/TyporaNotes/cloud-welcome.md',
      {
        content: '# Cloud Synced Heading\n\n> Synced directly from WebDAV Server.\n',
        mtimeMs: Date.now() - 10000,
        etag: 'etag-cloud-1'
      }
    ]
  ]);

  const server = http.createServer((req, res) => {
    const authHeader = req.headers.authorization || '';
    const expectedAuth =
      'Basic ' + Buffer.from(`${expectedUser}:${expectedPass}`, 'utf8').toString('base64');
    if (authHeader !== expectedAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="WebDAV"' });
      res.end('Unauthorized');
      return;
    }

    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(parsedUrl.pathname);

    if (req.method === 'MKCOL') {
      const colPath = decodedPath.endsWith('/') ? decodedPath : `${decodedPath}/`;
      collections.add(colPath);
      res.writeHead(201);
      res.end('Created');
      return;
    }

    if (req.method === 'PROPFIND') {
      const colPath = decodedPath.endsWith('/') ? decodedPath : `${decodedPath}/`;
      if (!collections.has(colPath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const responses = [
        `<D:response>
          <D:href>${colPath}</D:href>
          <D:propstat>
            <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
            <D:status>HTTP/1.1 200 OK</D:status>
          </D:propstat>
        </D:response>`
      ];
      for (const [filePath, meta] of files.entries()) {
        if (filePath.startsWith(colPath)) {
          const rel = filePath.slice(colPath.length);
          if (rel && !rel.includes('/')) {
            responses.push(
              `<D:response>
                <D:href>${colPath + encodeURIComponent(rel)}</D:href>
                <D:propstat>
                  <D:prop>
                    <D:resourcetype/>
                    <D:getcontentlength>${Buffer.byteLength(meta.content, 'utf8')}</D:getcontentlength>
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
      const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses.join('\n')}</D:multistatus>`;
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(xml);
      return;
    }

    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8');
        files.set(decodedPath, {
          content,
          mtimeMs: Date.now(),
          etag: `etag-${Date.now()}`
        });
        res.writeHead(201);
        res.end();
      });
      return;
    }

    if (req.method === 'GET') {
      const record = files.get(decodedPath);
      if (!record) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Last-Modified': new Date(record.mtimeMs).toUTCString()
      });
      res.end(record.content, 'utf8');
      return;
    }

    if (req.method === 'DELETE') {
      files.delete(decodedPath);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return { server, files };
}
module.exports = { createE2EMockWebdavServer };
