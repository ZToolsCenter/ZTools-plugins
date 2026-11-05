const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const { parse, compileScript } = require('vue/compiler-sfc')
const { createRenderer, h, markRaw, nextTick } = require('vue')

const cache = new Map()
function loadSource(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  let source = fs.readFileSync(filename, 'utf8')
  if (filename.endsWith('.vue')) {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    source = compileScript(descriptor, { id: path.basename(filename), inlineTemplate: true }).content
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: `${filename}.ts`,
  }).outputText
  const module = { exports: {} }
  cache.set(filename, module)
  const localRequire = (specifier) => specifier.startsWith('.')
    ? loadSource(path.resolve(path.dirname(filename), specifier.endsWith('.vue') ? specifier : `${specifier}.ts`))
    : require(specifier)
  new Function('require', 'exports', 'module', compiled)(localRequire, module.exports, module)
  return module.exports
}
const order = loadSource(path.join(__dirname, '..', 'src', 'workspaceOrder.ts'))
const drag = loadSource(path.join(__dirname, '..', 'src', 'workspaceDrag.ts'))
const Tree = loadSource(path.join(__dirname, '..', 'src', 'components', 'WorkspaceTree.vue')).default
const note = (relativePath) => ({ kind: 'note', name: relativePath.split('/').at(-1).replace(/\.md$/, ''), relativePath, modifiedAt: 1, size: 0 })
const folder = (relativePath, children = []) => ({ kind: 'directory', name: relativePath.split('/').at(-1), relativePath, children })
const paths = (entries) => entries.map((entry) => entry.relativePath)
const key = (id, directory) => `tree-order:${JSON.stringify([id, directory])}`

function storage() {
  const records = new Map()
  const writes = []
  const api = {
    getItem: (key) => structuredClone(records.get(key)),
    setItem: (key, value) => { records.set(key, structuredClone(value)); writes.push(key) },
  }
  global.window = { ztools: { dbStorage: api } }
  return { records, writes, api }
}

test('default sorting is non-mutating; custom sorting permits mixed types and survives reopening', () => {
  const { writes } = storage()
  const entries = [note('B.md'), folder('Dir'), note('A.md')]
  assert.deepEqual(paths(order.sortWorkspaceEntries('w', entries)), ['Dir', 'A.md', 'B.md'])
  assert.deepEqual(paths(entries), ['B.md', 'Dir', 'A.md'])
  assert.equal(order.reorderWorkspaceEntry('w', entries, 'B.md', 'Dir', 'before'), true)
  assert.deepEqual(paths(order.sortWorkspaceEntries('w', entries)), ['B.md', 'Dir', 'A.md'])
  assert.deepEqual(order.loadDirectoryOrder('w', ''), ['B.md', 'Dir', 'A.md'])
  assert.deepEqual(writes, [key('w', '')])
  assert.deepEqual(paths(order.sortWorkspaceEntries('other', entries)), ['Dir', 'A.md', 'B.md'])
})

test('new files append; scans retain missing files and restore their positions without rewriting storage', () => {
  const { records, writes } = storage()
  records.set(key('w', ''), ['B.md', 'missing.md', 'A.md'])
  const entries = [note('A.md'), note('C.md'), note('B.md'), folder('New')]
  assert.deepEqual(paths(order.sortWorkspaceEntries('w', entries)), ['B.md', 'A.md', 'New', 'C.md'])
  assert.deepEqual(writes, [])
  order.reorderWorkspaceEntry('w', entries, 'C.md', 'B.md', 'before')
  assert.deepEqual(order.loadDirectoryOrder('w', ''), ['C.md', 'B.md', 'missing.md', 'A.md', 'New'])
  assert.deepEqual(paths(order.sortWorkspaceEntries('w', [...entries, note('missing.md')])), ['C.md', 'B.md', 'missing.md', 'A.md', 'New'])
})

test('per-directory keys isolate changes; rereading accepts a remotely selected whole order', () => {
  const { records, writes } = storage()
  const entries = [folder('Dir', [note('Dir/A.md'), note('Dir/B.md')]), note('A.md')]
  order.reorderWorkspaceEntry('w', entries, 'Dir/B.md', 'Dir/A.md', 'before')
  assert.deepEqual(writes, [key('w', 'Dir')])
  records.set(key('w', 'Dir'), ['Dir/A.md', 'Dir/B.md'])
  assert.deepEqual(paths(order.sortWorkspaceEntries('w', entries)[0].children), ['Dir/A.md', 'Dir/B.md'])
  assert.deepEqual(writes, [key('w', 'Dir')])
  for (const [source, target] of [['A.md', 'Dir/A.md'], ['missing.md', 'A.md'], ['A.md', 'A.md']]) {
    assert.equal(order.reorderWorkspaceEntry('w', entries, source, target, 'after'), false)
  }
  assert.deepEqual(writes, [key('w', 'Dir')])
})

test('corrupt records cannot introduce entries or paths and fall back to default ordering', () => {
  const { records } = storage()
  const entries = [note('B.md'), note('A.md')]
  for (const value of [null, {}, 'wrong', [42, '../B.md', '/B.md', 'C:/B.md', 'dir/B.md']]) {
    records.set(key('w', ''), value)
    assert.deepEqual(paths(order.sortWorkspaceEntries('w', entries)), ['A.md', 'B.md'])
  }
  records.set(key('w', ''), ['B.md', 'B.md', 'A.md'])
  assert.deepEqual(order.loadDirectoryOrder('w', ''), ['B.md', 'A.md'])
})

test('renaming preserves a custom position and migrates descendant records including absent children', () => {
  const { records } = storage()
  const entries = [folder('Dir', [folder('Dir/Sub'), note('Dir/A.md')]), note('Z.md')]
  records.set(key('w', ''), ['Z.md', 'New', 'Dir'])
  records.set(key('w', 'Dir'), ['Dir/A.md', 'Dir/Sub', 'Dir/absent.md'])
  records.set(key('w', 'Dir/Sub'), ['Dir/Sub/B.md', 'Dir/Sub/A.md'])
  order.replaceWorkspaceOrderPath('w', entries, 'Dir', 'New')
  assert.deepEqual(order.loadDirectoryOrder('w', ''), ['Z.md', 'New'])
  assert.deepEqual(order.loadDirectoryOrder('w', 'New'), ['New/A.md', 'New/Sub', 'New/absent.md'])
  assert.deepEqual(order.loadDirectoryOrder('w', 'New/Sub'), ['New/Sub/B.md', 'New/Sub/A.md'])
  assert.deepEqual(order.loadDirectoryOrder('w', 'Dir'), [])
  assert.deepEqual(order.loadDirectoryOrder('w', 'Dir/Sub'), [])
})

test('moving removes the old slot, appends after existing target children and keeps nested order', () => {
  const { records } = storage()
  const entries = [folder('From', [folder('From/Sub', [note('From/Sub/A.md')])]), folder('To', [note('To/Z.md'), note('To/A.md')])]
  records.set(key('w', 'From'), ['From/Sub'])
  records.set(key('w', 'From/Sub'), ['From/Sub/missing.md', 'From/Sub/A.md'])
  records.set(key('w', 'To'), ['To/Z.md'])
  order.replaceWorkspaceOrderPath('w', entries, 'From/Sub', 'To/Sub')
  assert.deepEqual(order.loadDirectoryOrder('w', 'From'), [])
  assert.deepEqual(order.loadDirectoryOrder('w', 'To'), ['To/Z.md', 'To/A.md', 'To/Sub'])
  assert.deepEqual(order.loadDirectoryOrder('w', 'To/Sub'), ['To/Sub/missing.md', 'To/Sub/A.md'])
})

test('read and write errors propagate; failed reads do not partially migrate records', () => {
  const { records, writes, api } = storage()
  records.set(key('w', ''), ['Dir', 'A.md'])
  const entries = [folder('Dir'), note('A.md')]
  api.setItem = () => { throw new Error('storage full') }
  assert.throws(() => order.reorderWorkspaceEntry('w', entries, 'A.md', 'Dir', 'before'), /storage full/)
  assert.deepEqual(records.get(key('w', '')), ['Dir', 'A.md'])
  const get = api.getItem
  api.getItem = (name) => { if (name === key('w', 'Dir')) throw new Error('read failed'); return get(name) }
  assert.throws(() => order.replaceWorkspaceOrderPath('w', entries, 'Dir', 'New'), /read failed/)
  assert.deepEqual(writes, [])
})

// Run real compiled tree handlers and recursive event forwarding using Vue's renderer.
class Node {
  constructor(tag, text = '') { this.tag = tag; this.text = text; this.children = []; this.parent = null; this.props = {}; markRaw(this) }
  getBoundingClientRect() { return { top: 0, height: 40 } }
  dispatch(name, clientY = 20) {
    const event = { currentTarget: this, target: this, clientY, preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {} } }
    for (const handler of [this.props[`on${name}`]].flat()) handler?.(event)
  }
}
function mountTree(t, entries) {
  const root = new Node('root')
  const events = { reorder: [], move: [] }
  const remove = (node) => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null }
  const renderer = createRenderer({
    createElement: (tag) => new Node(tag), createText: (text) => new Node('#text', text), createComment: () => new Node('#comment'),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, previous, value) => { node.props[key] = value },
    insert: (node, parent, anchor) => { remove(node); parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, node); node.parent = parent },
    remove, parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  })
  const app = renderer.createApp({ render: () => h(Tree, {
    entries, activePath: null, selectedPath: '', createParentPath: '', createKind: null, createName: '', createError: '',
    renamePath: null, renameName: '', renameError: '', openMenuPath: null, pinnedPaths: [], hiddenGlobalPaths: [], globalNoteSearchEnabled: false,
    onRequestReorder: (...args) => events.reorder.push(args), onRequestMove: (...args) => events.move.push(args),
  }) })
  app.mount(root)
  t.after(() => { drag.endWorkspaceDrag(); app.unmount() })
  const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean)
  return { events, find: (predicate) => find(root, predicate) }
}

test('real tree drop handlers distinguish insertion and moving, forward nested events, and clear indicators', async (t) => {
  storage()
  const tree = mountTree(t, [folder('Dir', [note('Dir/A.md'), note('Dir/B.md')]), note('A.md')])
  const directoryRow = tree.find((node) => node.tag === 'summary')
  drag.beginWorkspaceDrag('A.md')
  directoryRow.dispatch('Dragover', 2)
  await nextTick()
  assert.match(directoryRow.props.class, /tree-row--insert-before/)
  directoryRow.dispatch('Drop', 2)
  assert.deepEqual(tree.events.reorder, [['A.md', 'Dir', 'before']])
  assert.deepEqual(tree.events.move, [])
  await nextTick()
  assert.doesNotMatch(directoryRow.props.class, /tree-row--insert/)
  drag.beginWorkspaceDrag('A.md')
  directoryRow.dispatch('Drop', 20)
  assert.deepEqual(tree.events.move, [['A.md', 'Dir']])
  const noteRow = tree.find((node) => node.tag === 'button' && node.props.title === 'Dir/B.md').parent
  drag.beginWorkspaceDrag('Dir/A.md')
  noteRow.dispatch('Drop', 38)
  assert.deepEqual(tree.events.reorder.at(-1), ['Dir/A.md', 'Dir/B.md', 'after'])
  drag.beginWorkspaceDrag('A.md')
  noteRow.dispatch('Drop', 2)
  assert.equal(tree.events.reorder.length, 2)
  assert.equal(drag.getWorkspaceDragPath(), '')
})

test('self drops and moving a folder into a descendant are rejected', (t) => {
  storage()
  const tree = mountTree(t, [folder('Dir', [folder('Dir/Sub')])])
  const rows = []
  tree.find((node) => { if (node.tag === 'summary') rows.push(node); return false })
  drag.beginWorkspaceDrag('Dir')
  rows[0].dispatch('Drop', 2)
  drag.beginWorkspaceDrag('Dir')
  rows[1].dispatch('Drop', 20)
  assert.deepEqual(tree.events, { reorder: [], move: [] })
})
