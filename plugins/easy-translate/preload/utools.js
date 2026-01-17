modules.exports = {

  // 将 base64 编码数据转换为 Buffer 数据
  baseToBuffer(img) {
    return Buffer.from(img.replace(/^data:image\/png;base64,/, ''), 'base64')
  },

}
