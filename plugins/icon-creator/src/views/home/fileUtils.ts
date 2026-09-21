// 把本地图片文件读取为 base64 dataURL。
// 相比临时 blob: URL，dataURI 会随 canvas.toObject() 的 JSON 一起持久化，
// 工程文件和 localStorage 草稿在页面刷新后仍能重新加载图片。
export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件内容失败'))
    reader.readAsDataURL(file)
  })
}
