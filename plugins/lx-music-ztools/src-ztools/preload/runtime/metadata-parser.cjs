const path = require('node:path')
const metadata = require('music-metadata')
const lib = path.dirname(require.resolve('music-metadata'))
// Electron's shared renderer realm cannot resolve a new ESM filesystem import
// from a later UI callback. Resolve the library's own lazy loaders during preload.
const loaders = ['aiff/AiffLoader', 'apev2/Apev2Loader', 'asf/AsfLoader', 'dsdiff/DsdiffLoader',
  'dsf/DsfLoader', 'flac/FlacLoader', 'matroska/MatroskaLoader', 'mp4/Mp4Loader',
  'mpeg/MpegLoader', 'musepack/MusepackLoader', 'ogg/OggLoader', 'wav/WaveLoader', 'wavpack/WavPackLoader']
const ready = Promise.all(loaders.map(file => Object.values(require(path.join(lib, file + '.js')))[0].load()))
ready.catch(() => {})
module.exports = { ...metadata, ready, async parseFile(...args) { await ready; return metadata.parseFile(...args) } }
