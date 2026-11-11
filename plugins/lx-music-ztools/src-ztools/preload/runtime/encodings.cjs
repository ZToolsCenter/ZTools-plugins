const { createRequire } = require('node:module')
const iconv = require('iconv-lite')
const codecs = new Set([iconv, createRequire(require.resolve('node-id3'))('iconv-lite'), createRequire(require.resolve('needle'))('iconv-lite')])
// Resolve lazy encoding tables in the trusted preload, including dependencies'
// own iconv version. Later renderer callbacks cannot resolve new Node modules.
for (const codec of codecs) for (const encoding of ['utf8', 'utf16', 'utf16be', 'latin1', 'gbk']) codec.encode('', encoding)
module.exports = iconv
