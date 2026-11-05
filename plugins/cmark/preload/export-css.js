/**
 * 导出文档样式（浅/深两套）
 * preload.js 与 preload/services.js 共用同一份，避免两套实现漂移
 */
/* 导出文档样式：浅/深两套，跟随当前主题。
 * 之前只写了寥寥几条规则 —— 导出后标题层级、表格、代码高亮、高亮标记全丢；
 * 深色主题下更是浅色壳配深色文字，几乎不可读。 */
function exportDocCss(theme) {
  const dark = theme === 'dark'
  const c = dark
    ? { bg: '#0d1117', fg: '#e6edf3', muted: '#8b949e', bd: '#30363d', codeBg: '#161b22',
        th: '#161b22', markBg: '#6b5200', markFg: '#ffe08a', accent: '#58a6ff',
        kw: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', fn: '#d2a8ff', vr: '#ffa657', cm: '#8b949e', tag: '#7ee787' }
    : { bg: '#ffffff', fg: '#1f2328', muted: '#57606a', bd: '#d0d7de', codeBg: '#f6f8fa',
        th: '#f6f8fa', markBg: '#fff3b8', markFg: '#6b4a00', accent: '#0969da',
        kw: '#cf222e', str: '#0a3069', num: '#0550ae', fn: '#8250df', vr: '#953800', cm: '#6e7781', tag: '#116329' }
  return [
    ':root{color-scheme:' + (dark ? 'dark' : 'light') + '}',
    'body{margin:0;background:' + c.bg + ';color:' + c.fg + ';font:16px/1.75 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}',
    '.markdown-body{box-sizing:border-box;max-width:980px;margin:0 auto;padding:45px}',
    '@media (max-width:767px){.markdown-body{padding:18px}}',
    '.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:1.4em 0 .6em;font-weight:600;line-height:1.3}',
    '.markdown-body h1{font-size:2em}.markdown-body h2{font-size:1.5em}.markdown-body h3{font-size:1.25em}',
    '.markdown-body h4{font-size:1em}.markdown-body h5{font-size:.9em}',
    '.markdown-body h6{font-size:.85em;color:' + c.muted + '}',
    '.markdown-body h1,.markdown-body h2{border-bottom:1px solid ' + c.bd + ';padding-bottom:.3em}',
    '.markdown-body p{margin:0 0 .85em}',
    '.markdown-body ul,.markdown-body ol{margin:0 0 .85em;padding-left:1.6em}',
    '.markdown-body li{margin:.25em 0}',
    '.markdown-body li>input[type=checkbox]{margin-right:.4em}',
    '.markdown-body hr{height:1px;border:0;background:' + c.bd + ';margin:1.6em 0}',
    '.markdown-body a{color:' + c.accent + ';text-decoration:none}',
    '.markdown-body blockquote{margin:0 0 .85em;padding:.2em 1em;color:' + c.muted + ';border-left:3px solid ' + c.bd + '}',
    '.markdown-body code{background:' + c.codeBg + ';border-radius:4px;padding:.2em .4em;font-size:.9em;font-family:"Cascadia Code",Consolas,"Courier New",monospace}',
    '.markdown-body pre{background:' + c.codeBg + ';border-radius:8px;padding:14px 16px;overflow:auto;line-height:1.6}',
    '.markdown-body pre code{background:none;padding:0;font-size:.9em}',
    '.markdown-body table{border-collapse:collapse;margin:0 0 1em;display:block;overflow:auto}',
    '.markdown-body th,.markdown-body td{border:1px solid ' + c.bd + ';padding:6px 12px}',
    '.markdown-body th{background:' + c.th + ';font-weight:600}',
    '.markdown-body img{max-width:100%}',
    '.markdown-body mark{background:' + c.markBg + ';color:' + c.markFg + ';border-radius:3px;padding:0 2px}',
    '.markdown-body .token.comment,.markdown-body .token.prolog,.markdown-body .token.doctype,.markdown-body .token.cdata{color:' + c.cm + '}',
    '.markdown-body .token.punctuation{color:' + c.fg + '}',
    '.markdown-body .token.keyword,.markdown-body .token.atrule{color:' + c.kw + '}',
    '.markdown-body .token.string,.markdown-body .token.char,.markdown-body .token.attr-name{color:' + c.str + '}',
    '.markdown-body .token.number,.markdown-body .token.boolean,.markdown-body .token.constant,.markdown-body .token.property{color:' + c.num + '}',
    '.markdown-body .token.function,.markdown-body .token.class-name{color:' + c.fn + '}',
    '.markdown-body .token.variable,.markdown-body .token.regex,.markdown-body .token.important{color:' + c.vr + '}',
    '.markdown-body .token.tag,.markdown-body .token.inserted{color:' + c.tag + '}',
  ].join('\n')
}

function exportDocColors(theme) {
  return theme === 'dark'
    ? { bg: '#0d1117', fg: '#e6edf3' }
    : { bg: '#ffffff', fg: '#1f2328' }
}

module.exports = { exportDocCss, exportDocColors }
