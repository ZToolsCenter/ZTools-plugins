const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function loadImageSizeMetadata() {
  const filename = path.join(__dirname, '..', 'src', 'imageSizeMetadata.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    module.exports,
    require,
    module,
    filename,
    path.dirname(filename),
  )
  return module.exports
}

const {
  IMAGE_WIDTH_MAX,
  clearMarkdownImageWidth,
  findMarkdownImageIndex,
  getMarkdownImages,
  removeMarkdownImage,
  setMarkdownImageWidth,
} = loadImageSizeMetadata()

test('adds, replaces, and removes adjacent image-width metadata without changing standard Markdown', () => {
  const markdown = '![说明](relative/path.png?version=1#preview)'
  const added = setMarkdownImageWidth(markdown, 0, 640)
  assert.equal(added, '![说明](relative/path.png?version=1#preview)<!-- znotes:image-width=640 -->')
  assert.equal(getMarkdownImages(added)[0].width, 640)

  const updated = setMarkdownImageWidth(added, 0, 480)
  assert.equal(updated, '![说明](relative/path.png?version=1#preview)<!-- znotes:image-width=480 -->')
  assert.equal(clearMarkdownImageWidth(updated, 0), markdown)
})

test('updates only the selected image when a note has multiple images', () => {
  const markdown = [
    '![第一](one.png)<!-- znotes:image-width=200 -->',
    '',
    '![第二](two.png)',
  ].join('\n')
  const changed = setMarkdownImageWidth(markdown, 1, 300)
  assert.equal(changed, [
    '![第一](one.png)<!-- znotes:image-width=200 -->',
    '',
    '![第二](two.png)<!-- znotes:image-width=300 -->',
  ].join('\n'))
  assert.equal(clearMarkdownImageWidth(changed, 0), [
    '![第一](one.png)',
    '',
    '![第二](two.png)<!-- znotes:image-width=300 -->',
  ].join('\n'))
})

test('ignores malformed width values but can replace or clear their adjacent zNotes comment', () => {
  const markdown = '![图](a.png)<!-- znotes:image-width=wide -->'
  assert.equal(getMarkdownImages(markdown)[0].width, null)
  assert.equal(setMarkdownImageWidth(markdown, 0, 320), '![图](a.png)<!-- znotes:image-width=320 -->')
  assert.equal(clearMarkdownImageWidth(markdown, 0), '![图](a.png)')
})

test('does not treat regular links or image-looking code as editable images', () => {
  const markdown = [
    '[普通链接](photo.png)',
    '`![行内](inline.png)`',
    '```md',
    '![代码块](fenced.png)',
    '```',
    '![真实图片](real.png)',
  ].join('\n')
  assert.deepEqual(getMarkdownImages(markdown).map(({ alt, src }) => ({ alt, src })), [{ alt: '真实图片', src: 'real.png' }])
})

test('finds image indexes by source and alt, including duplicate sources', () => {
  const markdown = '![a](same.png)\n![b](same.png)\n![c](other.png)'
  assert.equal(findMarkdownImageIndex(markdown, { src: 'same.png', alt: 'b' }), 1)
  assert.equal(findMarkdownImageIndex(markdown, { src: 'same.png', occurrence: 1 }), 1)
  assert.equal(findMarkdownImageIndex(markdown, { src: 'missing.png' }), null)
})

test('rejects unsafe width and image index values', () => {
  const markdown = '![图](a.png)'
  assert.throws(() => setMarkdownImageWidth(markdown, 0, 0), RangeError)
  assert.throws(() => setMarkdownImageWidth(markdown, 0, IMAGE_WIDTH_MAX + 1), RangeError)
  assert.throws(() => setMarkdownImageWidth(markdown, 1, 100), RangeError)
})

test('removes an image and its adjacent width metadata in one operation', () => {
  const markdown = '前文 ![图](a.png)<!-- znotes:image-width=320 --> 后文'
  assert.equal(removeMarkdownImage(markdown, 0), '前文  后文')
  assert.equal(removeMarkdownImage('![图](a.png)\n下一行', 0), '\n下一行')
})
