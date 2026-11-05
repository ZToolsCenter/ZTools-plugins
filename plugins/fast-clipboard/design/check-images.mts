import { normalizeRecord, base64ToDataUrl, bytesToDataUrl } from '../src/api.ts'

let pass = 0
let fail = 0

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log('  PASS  ' + name)
  } else {
    fail++
    console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : ''))
  }
}

const FAKE_B64 = 'iVBORw0KGgo' + 'A'.repeat(300)
const B64 = base64ToDataUrl(FAKE_B64)

console.log('\n--- 图片识别（宿主可能返回的各种形态）---')

// 0. 官方 clipboardManager 真实结构：imagePath + resolution + preview + appName
let r = normalizeRecord({
  id: 'a0', type: 'image', timestamp: 1750000000000, hash: 'h0',
  appName: 'Chrome', imagePath: 'C:\\Users\\dev\\AppData\\clipboard-images\\img_abc123.png',
  resolution: '1920 * 1080', preview: '[图片] 340KB'
})
check(
  '官方结构 imagePath → 图片',
  r?.kind === 'image' && r.content === 'C:\\Users\\dev\\AppData\\clipboard-images\\img_abc123.png',
  JSON.stringify(r && r.content)
)
check(
  '官方结构 resolution/appName 透传',
  r?.resolution === '1920 * 1080' && r?.appName === 'Chrome' && r?.preview === '[图片] 340KB',
  JSON.stringify(r && { resolution: r.resolution, appName: r.appName })
)
check('官方结构 timestamp 归一化', r?.createdAt === 1750000000000, String(r?.createdAt))

// 0b. 官方超大图片：无 imagePath 只有 preview → 占位但不丢记录
r = normalizeRecord({
  id: 'a0b', type: 'image', timestamp: 1750000000000, hash: 'h1',
  preview: '[图片] 过大未保存 (25.30MB)'
})
check(
  '官方超大图片 → 保留记录并用 preview 兜底',
  r !== null && r.kind === 'image' && r.content === '[图片] 过大未保存 (25.30MB)',
  JSON.stringify(r)
)

// 0c. 官方文件结构：files 为对象数组
r = normalizeRecord({
  id: 'a0c', type: 'file', timestamp: 1750000000000, hash: 'h2',
  files: [
    { path: 'E:\\docs\\设计稿.fig', name: '设计稿.fig', isDirectory: false, exists: true },
    { path: 'E:\\docs\\素材', name: '素材', isDirectory: true, exists: true }
  ],
  preview: '[文件] 设计稿.fig'
})
check(
  '官方 files 对象数组 → 提取 path',
  r?.kind === 'file' && r.files?.length === 2 && r.files[0] === 'E:\\docs\\设计稿.fig',
  JSON.stringify(r && r.files)
)

// 1. type=image + 裸 base64 放在 content
r = normalizeRecord({ id: 'a1', type: 'image', content: FAKE_B64 })
check('type=image + 裸 base64(content)', r?.kind === 'image' && r.content.startsWith('data:image/png;base64,'), JSON.stringify(r && r.kind))

// 2. type=image + data URL 放在 thumbnail
r = normalizeRecord({ id: 'a2', type: 'image', thumbnail: 'data:image/png;base64,iVBORw0KGgo=' })
check('type=image + dataURL(thumbnail)', r?.kind === 'image' && r.content === 'data:image/png;base64,iVBORw0KGgo=')

// 3. type=image + 二进制字节
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9])
r = normalizeRecord({ id: 'a3', type: 'image', image: pngBytes })
check('type=image + Uint8Array 字节', r?.kind === 'image' && r.content.startsWith('data:image/png;base64,'), JSON.stringify(r && r.content.slice(0, 30)))

// 4. type=image + 本地路径 Windows
r = normalizeRecord({ id: 'a4', type: 'image', path: 'D:\\cache\\shot.png' })
check('type=image + 本地路径(path)', r?.kind === 'image' && r.content === 'D:\\cache\\shot.png', JSON.stringify(r && r.content))

// 5. 没有 type，只有 dataUrl 字段
r = normalizeRecord({ id: 'a5', dataUrl: 'data:image/webp;base64,UklGRg==' })
check('无 type + dataUrl 字段', r?.kind === 'image' && r.content === 'data:image/webp;base64,UklGRg==')

// 6. type 简写成 img
r = normalizeRecord({ id: 'a6', type: 'img', source: 'https://a.com/x.png' })
check('type=img + 网络图片链接', r?.kind === 'image' && r.content === 'https://a.com/x.png')

// 7. type=image 但取不到任何内容 → 仍判为图片（占位，不丢记录）
r = normalizeRecord({ id: 'a7', type: 'image' })
check('type=image 但无内容 → 保留占位', r !== null && r.kind === 'image' && r.content === '', JSON.stringify(r))

// 8. file 类型不被图片逻辑抢走
r = normalizeRecord({ id: 'a8', type: 'file', files: ['D:\\a.png'] })
check('type=file + 图片文件 → 仍按文件', r?.kind === 'file' && r.files?.length === 1, JSON.stringify(r && r.kind))

console.log('\n--- 其他类型未被误伤 ---')

r = normalizeRecord({ id: 'b1', content: 'hello world' })
check('普通文本', r?.kind === 'text' && r.content === 'hello world')

r = normalizeRecord({ id: 'b2', content: 'https://vuejs.org/guide' })
check('链接', r?.kind === 'link')

r = normalizeRecord({ id: 'b3', content: 'const a = () => { return 1 }' })
check('代码', r?.kind === 'code')

r = normalizeRecord({ id: 'b4', content: '#5B8DEF' })
check('颜色', r?.kind === 'color')

r = normalizeRecord({ id: 'b5', type: 'file', files: ['D:\\a.txt', 'D:\\b.md'] })
check('多文件', r?.kind === 'file' && r.files?.length === 2)

console.log('\n--- 工具函数 ---')
check('base64 转 data URL(PNG)', B64 !== null && B64.startsWith('data:image/png;base64,'))
check('base64 非图片数据返回 null', base64ToDataUrl('这不是图片啊啊啊'.repeat(40)) === null)
check('字节按魔数判 JPEG', bytesToDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])).startsWith('data:image/jpeg'))

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
