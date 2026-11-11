import { build } from 'esbuild'
await build({ entryPoints: { 'source-worker': 'src/source-worker.js', 'probe-worker': 'src/probe-worker.js' }, bundle: true, platform: 'browser',
  outdir: 'src-ztools/dist', format: 'iife', minify: false,
  alias: { stream: 'stream-browserify', events: 'events' }, define: { global: 'globalThis' },
  inject: ['src/worker-shims.js'],
  banner: { js: 'try {' }, footer: { js: '} catch(error) { postMessage({type:"error",error:String(error.stack || error)}) }' },
})
