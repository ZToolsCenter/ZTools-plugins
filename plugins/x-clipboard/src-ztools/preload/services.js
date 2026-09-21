// x-clipboard 的 preload
//
// 这个插件只调用宿主注入的 window.ztools.* 公开接口，目前不需要额外的 node 能力。
// 之所以保留这个文件（而不是从 plugin.json 里删掉 preload 字段），是为了以后真要用
// node（例如把图片另存、导出历史）时，不用回头改 plugin.json —— 那时在这里往
// window.services 上挂东西即可。
//
// 注意：这个 preload 走 CommonJS —— 同目录的 package.json 里写了 "type": "commonjs"，
// 宿主按 CJS 解析它，别改成 ESM。

window.services = {}
