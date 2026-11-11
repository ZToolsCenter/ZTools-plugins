const path = require('node:path')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const HTMLPlugin = require('html-webpack-plugin')
const root = path.resolve(__dirname, '../..')
const lx = path.join(root, 'vendor/lx/src')
const adapter = name => path.join(root, 'src/ztools', name)
const alias = {
  '@root': lx, '@renderer': path.join(lx, 'renderer'), '@lyric': path.join(lx, 'renderer-lyric'), '@common': path.join(lx, 'common'), '@static': path.join(lx, 'static'),
  '@root/common/error$': adapter('errors.ts'),
  [path.join(lx, 'common/rendererIpc.ts')]: adapter('rendererIpc.ts'),
  '@common/rendererIpc$': adapter('rendererIpc.ts'), '@common/error$': adapter('errors.ts'),
  '@common/utils/electron$': adapter('electron.ts'), '@common/utils/nodejs$': adapter('nodejs.ts'),
  '@renderer/utils/request$': adapter('request.ts'), '@renderer/worker$': adapter('worker.ts'), '@renderer/worker/utils$': adapter('worker.ts'),
  'music-metadata$': adapter('metadata.ts'), 'electron-log/node$': adapter('logger.ts'),
  'node:os$': adapter('os.ts'), 'os$': adapter('os.ts'), 'node:path$': require.resolve('path-browserify'),
  'node:crypto$': require.resolve('crypto-browserify'), 'node:url$': adapter('url.ts'), 'url$': adapter('url.ts'),
  'zlib$': adapter('zlib.ts'),
  'dns$': adapter('dns.ts'),
}
// Exact module aliases must precede directory aliases such as @renderer.
const sortedAliases = Object.fromEntries(Object.entries(alias).sort(([a], [b]) => Number(b.endsWith('$')) - Number(a.endsWith('$'))))
const absoluteReplacements = new Map([
  ['common/rendererIpc', 'rendererIpc.ts'], ['common/error', 'errors.ts'],
  ['common/utils/electron', 'electron.ts'], ['common/utils/nodejs', 'nodejs.ts'],
  ['renderer/utils/request', 'request.ts'], ['renderer/worker', 'worker.ts'], ['renderer/worker/index', 'worker.ts'],
  ['renderer/worker/utils', 'worker.ts'], ['renderer/worker/utils/index', 'worker.ts'],
].map(([file, replacement]) => [path.join(lx, file), adapter(replacement)]))
for (const name of ['SettingHotKey', 'SettingUpdate', 'SettingAbout']) absoluteReplacements.set(path.join(lx, 'renderer/views/Setting/components', name + '.vue'), adapter(name + '.vue'))
const css = module => ['style-loader', { loader: 'css-loader', options: { esModule: false, modules: module ? { namedExport: false, exportLocalsConvention: 'camelCase' } : false } },
  { loader: 'postcss-loader', options: { postcssOptions: { ...require('./postcss.config.cjs'), config: false } } }]
module.exports = {
  mode: 'development', target: 'web', devtool: 'source-map',
  entry: { lx: adapter('entry.ts'), lyric: adapter('lyric-entry.ts') },
  output: { path: path.join(root, 'src-ztools/dist'), filename: '[name].js', publicPath: '', clean: false },
  resolve: { extensions: ['.ts', '.js', '.json'], alias: sortedAliases,
    modules: [path.join(root, 'node_modules'), 'node_modules'],
    fallback: { vm: false, crypto: require.resolve('crypto-browserify'), stream: require.resolve('stream-browserify'), buffer: require.resolve('buffer/'), events: require.resolve('events/'), path: require.resolve('path-browserify'), querystring: require.resolve('querystring-es3') } },
  module: { rules: [
    { test: /renderer[\\/]core[\\/]useApp[\\/](?:index|useSettingSync)\.ts$/, enforce: 'pre', use: path.join(__dirname, 'host-lifecycle-loader.cjs') },
    { test: /renderer[\\/]plugins[\\/]player[\\/]index\.ts$/, enforce: 'pre', use: path.join(__dirname, 'engine-routing-loader.cjs') },
    { test: /(?:core[\\/]player[\\/]action|usePreloadNextMusic)\.ts$/, enforce: 'pre', use: path.join(__dirname, 'media-proxy-loader.cjs') },
    { test: /ThemeEditModal[\\/]index\.vue$/, enforce: 'pre', use: path.join(__dirname, 'theme-editor-loader.cjs') },
    { test: /renderer[\\/]components[\\/](?:layout[\\/]PlayDetail[\\/]components[\\/]ControlBtns\.vue|common[\\/]SoundEffectBtn[\\/]index\.vue)$/, enforce: 'pre', use: path.join(__dirname, 'audio-routing-loader.cjs') },
    { test: /components[\\/]layout[\\/]Toolbar[\\/]SearchInput\.vue$/, enforce: 'pre', use: path.join(__dirname, 'search-input-loader.cjs') },
    { test: /useSettingSync\.ts$/, enforce: 'pre', use: path.join(__dirname, 'sync-settings-loader.cjs') },
    { test: /store[\\/]download[\\/]action\.ts$/, enforce: 'pre', use: path.join(__dirname, 'download-loader.cjs') },
    { test: /SettingBackup\.vue$/, enforce: 'pre', use: path.join(__dirname, 'backup-loader.cjs') },
    { test: /useMediaDevice\.ts$/, enforce: 'pre', use: path.join(__dirname, 'media-device-loader.cjs') },
    { test: /Setting(Basic|Play|Other|DesktopLyric)\.vue$/, enforce: 'pre', use: path.join(__dirname, 'host-settings-loader.cjs') },
    { test: /\.vue$/, loader: 'vue-loader', options: { compilerOptions: { whitespace: 'preserve' } } },
    { test: /\.ts$/, loader: 'ts-loader', options: { transpileOnly: true, appendTsSuffixTo: [/\.vue$/], configFile: path.join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, allowImportingTsExtensions: false, module: 'ESNext' } },
      parser: { worker: ['*audioContext.audioWorklet.addModule()', '...'] } },
    { test: /\.pug$/, loader: 'pug-plain-loader' },
    { test: /\.css$/, oneOf: [{ resourceQuery: /module/, use: css(true) }, { use: css(false) }] },
    { test: /\.less$/, oneOf: [{ resourceQuery: /module/, use: [...css(true), 'less-loader'] }, { use: [...css(false), 'less-loader'] }] },
    { test: /\.(png|jpe?g|gif|svg|woff2?|ttf|mp3|wav|flac|ogg)$/, type: 'asset/resource', generator: { filename: 'assets/[name]-[contenthash:8][ext]' } },
  ] },
  plugins: [new VueLoaderPlugin(), new HTMLPlugin({ filename: 'lx.html', template: path.join(lx, 'renderer/index.html'), chunks: ['lx'] }),
    new HTMLPlugin({ filename: 'lyric.html', template: path.join(lx, 'renderer-lyric/index.html'), chunks: ['lyric'] }),
    new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
      if (!resource.request?.startsWith('.')) return
      const original = path.resolve(resource.context, resource.request).replace(/\.(ts|js)$/, '')
      if (absoluteReplacements.has(original)) resource.request = absoluteReplacements.get(original)
    }),
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'], process: 'process/browser' }),
    new webpack.DefinePlugin({ 'process.platform': JSON.stringify('win32'), global: 'globalThis', __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false }),
    new webpack.NormalModuleReplacementPlugin(/^node:/, resource => { if (resource.request === 'node:path') resource.request = require.resolve('path-browserify'); else if (resource.request === 'node:crypto') resource.request = require.resolve('crypto-browserify'); else if (resource.request === 'node:os') resource.request = adapter('os.ts'); else if (resource.request === 'node:url') resource.request = adapter('url.ts') }),
  ],
  stats: { preset: 'errors-warnings', errorDetails: true },
}
