/**
 * 语言自动检测单元测试（roadmap 任务 INT-001）。
 *
 * 覆盖 `src/core/langdetect.ts` 的两级检测优先级链：
 * - `detectLanguage`：扩展名矩阵（每个语言 ≥1 用例）、大小写不敏感、
 *   无扩展名 / 隐藏文件、未知扩展名 → 内容启发式兜底、扩展名优先于内容；
 * - 内容启发式：JSON 对象/数组、XML、HTML、CSS、YAML、Python、Go、Java、
 *   JavaScript、Markdown、SQL、C++ 的特征样例，以及置信度顺序歧义
 *   （同时像 JSON 和 JS 时 JSON 赢）；
 * - `detectLanguagePair`：文件名优先于内容（.py 文件内容像 JS → python）、
 *   单侧文件名命中、全无文件名时逐侧内容 + 合并采样兜底、两侧文件名冲突
 *   时左优先（既定约定，见 detectLanguagePair JSDoc）。
 */
import { describe, expect, it } from 'vitest'
import { detectLanguage, detectLanguagePair } from '../../src/core/langdetect'

/* -------------------------------------------------------------------------- */
/* detectLanguage：扩展名矩阵（每语言 ≥1 用例 + 大小写 + 边界）                   */
/* -------------------------------------------------------------------------- */

describe('detectLanguage 扩展名映射', () => {
  // [用例标签, 文件名, 期望语言]；覆盖 LANGUAGE_OPTIONS 全部 12 个语言包 id
  const cases: Array<[string, string, string]> = [
    ['js', 'app.js', 'javascript'],
    ['mjs', 'server.mjs', 'javascript'],
    ['cjs', 'index.cjs', 'javascript'],
    ['ts', 'main.ts', 'typescript'],
    ['tsx', 'Comp.tsx', 'typescript'],
    ['mts', 'mod.mts', 'typescript'],
    ['py', 'main.py', 'python'],
    ['java', 'App.java', 'java'],
    ['go', 'main.go', 'go'],
    ['sql', 'query.sql', 'sql'],
    ['json', 'data.json', 'json'],
    ['yaml', 'config.yaml', 'yaml'],
    ['yml', 'config.yml', 'yaml'],
    ['html', 'index.html', 'html'],
    ['htm', 'page.htm', 'html'],
    ['css', 'style.css', 'css'],
    ['xml', 'config.xml', 'xml'],
    ['md', 'README.md', 'markdown'],
    ['markdown', 'doc.markdown', 'markdown'],
    ['cpp', 'main.cpp', 'cpp'],
    ['cc', 'util.cc', 'cpp'],
    ['cxx', 'impl.cxx', 'cpp'],
    ['h', 'header.h', 'cpp'],
    ['hpp', 'lib.hpp', 'cpp'],
  ]

  it.each(cases)('%s → %s', (_label, filename, expected) => {
    expect(detectLanguage(filename)).toBe(expected)
  })

  it('扩展名大小写不敏感（含完整路径与混合分隔符）', () => {
    expect(detectLanguage('MAIN.PY')).toBe('python')
    expect(detectLanguage('Style.CSS')).toBe('css')
    expect(detectLanguage('C:\\work\\data.JSON')).toBe('json')
    expect(detectLanguage('/usr/local/app/Main.GO')).toBe('go')
  })

  it('无扩展名 / 隐藏文件 → 无文件名命中（无内容时 plaintext）', () => {
    expect(detectLanguage('Makefile')).toBe('plaintext')
    expect(detectLanguage('.gitignore')).toBe('plaintext')
    expect(detectLanguage('Dockerfile', undefined)).toBe('plaintext')
  })

  it('无任何输入 → plaintext', () => {
    expect(detectLanguage()).toBe('plaintext')
    expect(detectLanguage('', '')).toBe('plaintext')
    expect(detectLanguage(undefined, '   \n  ')).toBe('plaintext')
  })
})

describe('detectLanguage：扩展名优先于内容启发式', () => {
  it('扩展名命中时内容不参与判定（内容与扩展名不一致也信扩展名）', () => {
    expect(detectLanguage('app.js', 'totally not js at all')).toBe('javascript')
    expect(detectLanguage('a.py', 'function f() { return 1 }')).toBe('python')
  })

  it('未知扩展名 → 内容启发式兜底', () => {
    expect(detectLanguage('data.csv', '{"a": 1}')).toBe('json')
    expect(detectLanguage('notes.bak', 'const x = 1;')).toBe('javascript')
  })

  it('无扩展名 → 内容启发式兜底', () => {
    expect(detectLanguage('Pipfile', 'import os')).toBe('python')
  })
})

/* -------------------------------------------------------------------------- */
/* detectLanguage：内容启发式（置信度顺序，首个命中）                             */
/* -------------------------------------------------------------------------- */

describe('detectLanguage 内容启发式', () => {
  it('JSON：对象与数组（trim 容忍首尾空白）', () => {
    expect(detectLanguage(undefined, '{"name": "a", "n": 1}')).toBe('json')
    expect(detectLanguage(undefined, '[1, 2, 3]')).toBe('json')
    expect(detectLanguage(undefined, '\n  {\n    "a": 1\n  }\n')).toBe('json')
  })

  it('JSON 不做 parse 校验但要求首尾形态（残缺 JSON 不命中）', () => {
    expect(detectLanguage(undefined, '{"a": 1')).not.toBe('json')
  })

  it('XML：<?xml 声明 与 <tag> 形态 + 闭合', () => {
    expect(detectLanguage(undefined, '<?xml version="1.0"?>\n<root><a/></root>')).toBe('xml')
    expect(detectLanguage(undefined, '<note id="1">\n  <body>hi</body>\n</note>')).toBe('xml')
  })

  it('HTML：<!DOCTYPE html 与 <html 开头', () => {
    expect(detectLanguage(undefined, '<!DOCTYPE html>\n<html><body></body></html>')).toBe('html')
    expect(detectLanguage(undefined, '<html lang="en">\n<body>x</body>\n</html>')).toBe('html')
  })

  it('CSS：规则块形态（含注释起始与选择器行）', () => {
    expect(detectLanguage(undefined, 'body {\n  color: red;\n}')).toBe('css')
    expect(
      detectLanguage(
        undefined,
        '/* theme */\n.app > .item, #id {\n  margin: 0 auto;\n  color: rgb(0, 0, 0);\n}\n',
      ),
    ).toBe('css')
  })

  it('YAML：行首 key: + 缩进结构', () => {
    expect(detectLanguage(undefined, 'name: demo\nversion: 1\nitems:\n  - a\n  - b\n')).toBe('yaml')
  })

  it('Python：def / import / from x import', () => {
    expect(detectLanguage(undefined, 'def greet(name):\n    return name\n')).toBe('python')
    expect(detectLanguage(undefined, 'import os\nimport sys\n')).toBe('python')
    expect(detectLanguage(undefined, 'from collections import OrderedDict\n')).toBe('python')
  })

  it('Go：package（无分号收尾）/ func', () => {
    expect(detectLanguage(undefined, 'package main\n\nimport "fmt"\n\nfunc main() {\n}\n')).toBe('go')
    expect(detectLanguage(undefined, 'func helper() int {\n\treturn 1\n}\n')).toBe('go')
  })

  it('Java：package 带分号 / public class（不被 Go 的 package 规则抢走）', () => {
    expect(
      detectLanguage(undefined, 'package com.example.app;\n\npublic class Main {\n}\n'),
    ).toBe('java')
    expect(detectLanguage(undefined, 'public class Foo {\n}\n')).toBe('java')
  })

  it('JavaScript：const/let/var/function 声明与箭头函数', () => {
    expect(detectLanguage(undefined, 'const x = 1;')).toBe('javascript')
    expect(detectLanguage(undefined, 'let y = 2')).toBe('javascript')
    expect(detectLanguage(undefined, 'function foo() {\n  return 1\n}')).toBe('javascript')
    expect(detectLanguage(undefined, 'const f = (x) => x')).toBe('javascript')
  })

  it('Markdown：标题 + 代码围栏（两者同时出现）', () => {
    expect(
      detectLanguage(undefined, '# Title\n\nIntro text.\n\n```\nplain fenced line\n```\n'),
    ).toBe('markdown')
  })

  it('SQL：行首 DML/DDL 关键字（大小写不敏感）', () => {
    expect(detectLanguage(undefined, 'SELECT *\nFROM users\nWHERE id = 1\n')).toBe('sql')
    expect(detectLanguage(undefined, 'insert into t(a) values (1);\n')).toBe('sql')
    expect(detectLanguage(undefined, 'create table t (id int);\n')).toBe('sql')
  })

  it('C/C++：#include 预处理指令', () => {
    expect(detectLanguage(undefined, '#include <stdio.h>\n\nint main() {\n  return 0;\n}\n')).toBe(
      'cpp',
    )
    expect(detectLanguage(undefined, '#include "util.hpp"\n')).toBe('cpp')
  })

  it('歧义消解：同时像 JSON 和 JS 的对象字面量 → JSON 赢（置信度顺序第一）', () => {
    expect(detectLanguage(undefined, '{"a": 1}')).toBe('json')
    expect(detectLanguage(undefined, '["x", "y"]')).toBe('json')
  })

  it('普通散文 / 未命中任何特征 → plaintext 兜底', () => {
    expect(detectLanguage(undefined, 'just some plain text\nnothing special')).toBe('plaintext')
    expect(detectLanguage(undefined, 'HOME=/usr/bin')).toBe('plaintext')
  })
})

/* -------------------------------------------------------------------------- */
/* detectLanguagePair：文件名优先 + 左优先约定                                   */
/* -------------------------------------------------------------------------- */

describe('detectLanguagePair', () => {
  it('文件名优先于内容：.py 文件内容像 JS → python', () => {
    expect(detectLanguagePair('script.py', '', 'const x = 1;', '')).toBe('python')
  })

  it('左侧文件名命中（内容启发式被跳过）', () => {
    expect(detectLanguagePair('main.go', '', 'def f():\n    pass\n', '')).toBe('go')
  })

  it('单侧文件名命中：左未命中时查右', () => {
    expect(detectLanguagePair('', 'main.go', 'const x = 1;', '')).toBe('go')
    expect(detectLanguagePair('notes.txt', 'style.css', 'x', 'y')).toBe('css')
  })

  it('两侧文件名冲突 → 左优先（既定约定，见 detectLanguagePair JSDoc）', () => {
    expect(detectLanguagePair('a.py', 'b.go', '', '')).toBe('python')
    expect(detectLanguagePair('a.go', 'b.py', '', '')).toBe('go')
  })

  it('全无文件名：内容启发式（左侧内容优先）', () => {
    expect(detectLanguagePair('', '', 'const x = 1;', '{"a": 1}')).toBe('javascript')
    expect(detectLanguagePair('', '', '', 'SELECT 1')).toBe('sql')
  })

  it('单侧内容均未命中时 → 合并采样兜底（左标题 + 右围栏构成 Markdown 特征）', () => {
    const left = '# 标题\n\n一些说明文字。\n'
    const right = '```\nplain fenced line\n```\n'
    // 单侧：左缺围栏、右缺标题，各自都判不出 Markdown
    expect(detectLanguage(left)).toBe('plaintext')
    expect(detectLanguage(right)).toBe('plaintext')
    expect(detectLanguagePair('', '', left, right)).toBe('markdown')
  })

  it('两侧全空 → plaintext', () => {
    expect(detectLanguagePair('', '', '', '')).toBe('plaintext')
  })
})
