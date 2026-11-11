const fs = require('node:fs')
const { pipeline } = require('node:stream/promises')
const NodeID3 = require('node-id3')
const FlacProcessor = require('../../upstream/common/utils/musicMeta/flac-metadata/index.cjs')
// Resolve ESM while the trusted executor preload is initializing, before UI callbacks.
const metadataModule = import('music-metadata')

/** Executes only against the caller-created private copy, in an isolated host executor. */
async function write({ filePath, ext, meta, cover }) {
  const { parseFile } = await metadataModule
  const before = await parseFile(filePath)
  if (ext === '.mp3') {
    const tags = { title: meta.title, artist: meta.artist, album: meta.album, unsynchronisedLyrics: { language: 'zho', text: meta.lyrics } }
    if (cover) tags.image = { mime: cover.mime, type: { id: 3, name: 'front cover' }, description: '', imageBuffer: Buffer.from(cover.data) }
    const result = NodeID3.update(tags, filePath)
    if (result !== true) throw result instanceof Error ? result : new Error('MP3 标签写入失败')
  } else {
    const processor = new FlacProcessor()
    const data = { vorbis: { vendor: 'LX Music ZTools', comments: Object.entries(meta).map(([key, value]) => `${key.toUpperCase()}=${value}`) } }
    if (cover) data.picture = { pictureType: 3, mimeType: cover.mime, description: '', width: cover.width, height: cover.height, bitsPerPixel: cover.mime === 'image/png' ? 32 : 24, colors: 0, pictureData: Buffer.from(cover.data) }
    processor.writeMeta(data)
    const output = filePath + '.flac-writing'
    try {
      await pipeline(fs.createReadStream(filePath), processor, fs.createWriteStream(output, { flags: 'wx' }))
      await fs.promises.rename(output, filePath)
    } finally { await fs.promises.rm(output, { force: true }) }
  }
  const after = await parseFile(filePath)
  // Empty ID3 frames may be omitted by the writer/parser; absent and empty are
  // the same requested value, while nonempty text must still match exactly.
  const title = after.common.title ?? ''
  const album = after.common.album ?? ''
  if (title !== (meta.title ?? '') || album !== (meta.album ?? '') || !after.format.duration || before.format.duration && Math.abs(after.format.duration - before.format.duration) > 0.05) throw new Error('标签回读或音频时长验证失败')
  const handle = await fs.promises.open(filePath, 'r+')
  try { await handle.sync() } finally { await handle.close() }
  return { duration: after.format.duration, title, album }
}
module.exports = { write }
