// format.js — SQL 格式化 & 压缩
// 纯手写，零依赖，支持 MySQL/PostgreSQL/标准 SQL
'use strict'

function tokenize(sql) {
  const tokens = []
  let i = 0
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue }
    if ((sql[i] === '-' && sql[i + 1] === '-') || sql[i] === '#') {
      let j = i; while (j < sql.length && sql[j] !== '\n') j++
      tokens.push({ type: 'comment_line', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      let j = i + 2; while (j < sql.length && !(sql[j] === '*' && sql[j + 1] === '/')) j++; j += 2
      tokens.push({ type: 'comment_block', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") { j++; break }
        j++
      }
      tokens.push({ type: 'string', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') { j += 2; continue }
        if (sql[j] === '"') { j++; break }
        j++
      }
      tokens.push({ type: 'string', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === '\x60') {
      let j = i + 1; while (j < sql.length && sql[j] !== '\x60') j++; j++
      tokens.push({ type: 'word', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === '(') { tokens.push({ type: 'paren_open', value: '(' }); i++; continue }
    if (sql[i] === ')') { tokens.push({ type: 'paren_close', value: ')' }); i++; continue }
    if (sql[i] === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue }
    if (sql[i] === ';') { tokens.push({ type: 'semicolon', value: ';' }); i++; continue }
    if (/\d/.test(sql[i]) || (sql[i] === '.' && /\d/.test(sql[i + 1] || ''))) {
      let j = i; while (j < sql.length && /[\d.eE+\-]/.test(sql[j])) j++
      tokens.push({ type: 'number', value: sql.slice(i, j) }); i = j; continue
    }
    if (/[=<>!+\-*/%&|^~]/.test(sql[i])) {
      let j = i + 1; if (j < sql.length && /[=>|:]/.test(sql[j])) j++
      tokens.push({ type: 'operator', value: sql.slice(i, j) }); i = j; continue
    }
    if (sql[i] === '.') { tokens.push({ type: 'operator', value: '.' }); i++; continue }
    if (sql[i] === ':' && sql[i + 1] === ':') { tokens.push({ type: 'operator', value: '::' }); i += 2; continue }
    if (/[a-zA-Z_]/.test(sql[i])) {
      let j = i; while (j < sql.length && /[\w$]/.test(sql[j])) j++
      tokens.push({ type: 'word', value: sql.slice(i, j) }); i = j; continue
    }
    tokens.push({ type: 'operator', value: sql[i] }); i++
  }
  return tokens
}

const TOP_CLAUSE = new Set(['SELECT','FROM','WHERE','HAVING','LIMIT','OFFSET','SET','VALUES','RETURNING','UNION','UNION ALL','INTERSECT','EXCEPT','WITH'])
const DDL_DML = new Set(['INSERT','INSERT INTO','UPDATE','DELETE','DELETE FROM','CREATE','CREATE TABLE','CREATE INDEX','CREATE VIEW','DROP','DROP TABLE','ALTER','ALTER TABLE','TRUNCATE','TRUNCATE TABLE'])
const GROUP_ORDER = new Set(['GROUP BY','ORDER BY','PARTITION BY'])
const JOIN_KW = new Set(['JOIN','INNER JOIN','LEFT JOIN','RIGHT JOIN','FULL JOIN','FULL OUTER JOIN','LEFT OUTER JOIN','RIGHT OUTER JOIN','CROSS JOIN','NATURAL JOIN'])
const ON_KW = new Set(['ON','USING'])
const LOGIC_KW = new Set(['AND','OR'])
const ALL_KW = new Set([...TOP_CLAUSE,...DDL_DML,...GROUP_ORDER,...JOIN_KW,...ON_KW,...LOGIC_KW,'CASE','WHEN','THEN','ELSE','END','AS','IN','NOT','NULL','LIKE','BETWEEN','EXISTS','DISTINCT','ALL','ANY','SOME','ASC','DESC','AUTO_INCREMENT','DEFAULT','CONSTRAINT','INDEX','CHECK','UNIQUE','REFERENCES','CASCADE','RESTRICT','TRUE','FALSE','RETURNING','OVER','ROWS','RANGE','UNBOUNDED','PRECEDING','FOLLOWING','CURRENT','ROW','NULLIF','COALESCE','CAST','CONVERT','IF','IFNULL','ISNULL','COUNT','SUM','AVG','MIN','MAX','CONCAT','SUBSTRING','TRIM','UPPER','LOWER','LENGTH','REPLACE','NOW','CURDATE','CURRENT_DATE','CURRENT_TIMESTAMP','SYSDATE','ROW_NUMBER','RANK','DENSE_RANK','LAG','LEAD','FIRST_VALUE','LAST_VALUE','NOT NULL','NOT IN','NOT LIKE','NOT EXISTS','NOT BETWEEN','IS NOT','IS NOT NULL','IS NULL','PRIMARY KEY','FOREIGN KEY'])

const MULTI_KW = [['UNION','ALL'],['INSERT','INTO'],['DELETE','FROM'],['CREATE','TABLE'],['CREATE','INDEX'],['CREATE','VIEW'],['DROP','TABLE'],['ALTER','TABLE'],['TRUNCATE','TABLE'],['GROUP','BY'],['ORDER','BY'],['PARTITION','BY'],['INNER','JOIN'],['LEFT','JOIN'],['RIGHT','JOIN'],['FULL','JOIN'],['CROSS','JOIN'],['NATURAL','JOIN'],['LEFT','OUTER','JOIN'],['RIGHT','OUTER','JOIN'],['FULL','OUTER','JOIN'],['NOT','NULL'],['NOT','IN'],['NOT','LIKE'],['NOT','EXISTS'],['NOT','BETWEEN'],['IS','NOT','NULL'],['IS','NOT'],['IS','NULL'],['PRIMARY','KEY'],['FOREIGN','KEY']].sort((a,b)=>b.length-a.length)

function isKw(w) { return ALL_KW.has(w.toUpperCase()) }
function tryMultiKw(tokens, i) {
  const ws = []; let j = i
  while (j < tokens.length && tokens[j].type === 'word') { ws.push(tokens[j].value.toUpperCase()); j++ }
  if (ws.length < 2) return null
  for (const kw of MULTI_KW) {
    if (kw.length > ws.length) continue
    if (kw.every((w,k) => ws[k] === w)) return { upper: kw.join(' '), count: kw.length }
  }
  return null
}

function applyCase(w, c) { return c === 'upper' ? w.toUpperCase() : c === 'lower' ? w.toLowerCase() : w }

function formatSQL(sql, options) {
  const { indent = '  ', keywordCase = 'upper', linesBetweenStatements = 1 } = options || {}
  const tokens = tokenize(sql)
  const stmts = []; let cur = []
  for (const t of tokens) {
    if (t.type === 'semicolon') { cur.push(t); stmts.push(cur); cur = [] } else cur.push(t)
  }
  if (cur.length) stmts.push(cur)
  return stmts.map(s => fmtStmt(s, indent, keywordCase)).join('\n'.repeat(linesBetweenStatements + 1))
}

function fmtStmt(tokens, indent, kc) {
  const ctxStack = [{ type: 'root', base: 0 }]
  const ctx = () => ctxStack[ctxStack.length - 1]
  const inClause = () => ctx().type === 'root' || ctx().type === 'subquery'
  const inLogic = () => inClause() || ctx().type === 'case'
  const lines = []
  let line = '', lvl = 0

  const flush = () => { const t = line.trim(); if (t) lines.push(indent.repeat(lvl) + t); line = '' }
  const nl = (l) => { flush(); if (l !== undefined) lvl = l }
  const emit = (v, sp) => {
    const last = line[line.length - 1]
    const no = sp === false || last === '.' || last === '(' || !line
    if (!no) line += ' '
    line += v
  }

  const nextTok = (i) => { for (let j = i+1; j < tokens.length; j++) if (tokens[j].type !== 'comment_line' && tokens[j].type !== 'comment_block') return tokens[j]; return null }
  const prevTok = (i) => { for (let j = i-1; j >= 0; j--) if (tokens[j].type !== 'comment_line' && tokens[j].type !== 'comment_block') return tokens[j]; return null }

  // 已知函数名（聚合/标量/窗口/类型转换等），括号前不加空格
  const FUNC_NAMES = new Set(['COUNT','SUM','AVG','MIN','MAX','COALESCE','NULLIF','CAST','CONVERT','CONCAT','SUBSTRING','TRIM','UPPER','LOWER','LENGTH','REPLACE','NOW','CURDATE','SYSDATE','IF','IFNULL','ISNULL','ROW_NUMBER','RANK','DENSE_RANK','LAG','LEAD','FIRST_VALUE','LAST_VALUE','DATE_SUB','DATE_ADD','DATE_FORMAT','DATEDIFF','TIMESTAMPDIFF','EXTRACT','ROUND','CEIL','FLOOR','ABS','MOD','POWER','SQRT','LEFT','RIGHT','LPAD','RPAD','REVERSE','CHAR_LENGTH','GROUP_CONCAT','JSON_EXTRACT','JSON_OBJECT','JSON_ARRAY'])

  const classifyParen = (i) => {
    const nx = nextTok(i)
    if (nx && nx.type === 'word' && (nx.value.toUpperCase() === 'SELECT' || nx.value.toUpperCase() === 'WITH')) return 'subquery'
    const pv = prevTok(i)
    if (pv && pv.type === 'word') {
      const pvUp = pv.value.toUpperCase()
      // 已知函数名 或 非关键字标识符 → 函数调用
      if (FUNC_NAMES.has(pvUp) || !isKw(pvUp)) return 'function'
    }
    // 反引号标识符后面的括号也是函数调用
    if (pv && pv.value && pv.value[0] === '\x60') return 'function'
    return 'group'
  }

  const isClauseKw = (kw) => TOP_CLAUSE.has(kw) || DDL_DML.has(kw) || GROUP_ORDER.has(kw)
  // 当前子句对齐层级：subquery 比 base 深 1 级（base 是括号外层）
  const clauseIndent = () => ctx().type === 'subquery' ? ctx().base + 1 : ctx().base

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]

    if (t.type === 'comment_line' || t.type === 'comment_block') { flush(); lines.push(indent.repeat(lvl) + t.value); i++; continue }
    if (t.type === 'semicolon') { line += ';'; flush(); i++; continue }

    if (t.type === 'paren_open') {
      const kind = classifyParen(i)
      if (kind === 'subquery') {
        emit('('); const base = lvl; ctxStack.push({ type: 'subquery', base }); lvl = base + 1; nl(lvl)
      } else if (kind === 'function') {
        line = line.trimEnd(); line += '('; ctxStack.push({ type: 'function', base: lvl })
      } else {
        emit('('); ctxStack.push({ type: 'group', base: lvl })
      }
      i++; continue
    }

    if (t.type === 'paren_close') {
      const p = ctxStack.length > 1 ? ctxStack.pop() : ctx()
      if (p.type === 'subquery') { lvl = p.base; nl(lvl); emit(')', false) }
      else if (p.type === 'function') { lvl = p.base; line = line.trimEnd(); line += ')' }
      else { lvl = p.base; line += ')' }
      i++; continue
    }

    if (t.type === 'comma') { line += ','; if (inClause()) nl(lvl); i++; continue }
    if (t.type === 'string' || t.type === 'number') { emit(t.value); i++; continue }
    if (t.type === 'operator') { if (t.value === '.') { line = line.trimEnd(); line += '.' } else emit(t.value); i++; continue }

    if (t.type === 'word') {
      const upper = t.value.toUpperCase()
      const multi = tryMultiKw(tokens, i)
      if (multi) {
        const kw = multi.upper, display = applyCase(kw, kc)
        if (inClause()) {
          if (isClauseKw(kw)) { nl(clauseIndent()); emit(display, false) }
          else if (JOIN_KW.has(kw)) { nl(clauseIndent()); emit(display, false) }
          else if (ON_KW.has(kw)) { nl(clauseIndent() + 1); emit(display, false) }
          else if (LOGIC_KW.has(kw)) { nl(clauseIndent() + 1); emit(display, false) }
          else emit(display)
        } else if (LOGIC_KW.has(kw) && inLogic()) { nl(clauseIndent() + 1); emit(display, false) }
        else emit(display)
        i += multi.count; continue
      }

      if (upper === 'CASE') {
        emit(applyCase(upper, kc)); ctxStack.push({ type: 'case', base: lvl }); lvl++; i++; continue
      }
      if (upper === 'WHEN' && ctx().type === 'case') { nl(ctx().base + 1); emit(applyCase(upper, kc), false); i++; continue }
      if (upper === 'THEN' && ctx().type === 'case') { emit(applyCase(upper, kc)); i++; continue }
      if (upper === 'ELSE' && ctx().type === 'case') { nl(ctx().base + 1); emit(applyCase(upper, kc), false); i++; continue }
      if (upper === 'END') {
        if (ctx().type === 'case') { const p = ctxStack.pop(); lvl = p.base; nl(lvl); emit(applyCase(upper, kc), false) }
        else emit(applyCase(upper, kc))
        i++; continue
      }

      if (isKw(upper)) {
        const display = applyCase(upper, kc)
        if (inClause()) {
          if (isClauseKw(upper)) { nl(clauseIndent()); emit(display, false) }
          else if (JOIN_KW.has(upper)) { nl(clauseIndent()); emit(display, false) }
          else if (ON_KW.has(upper)) { nl(clauseIndent() + 1); emit(display, false) }
          else if (LOGIC_KW.has(upper)) { nl(clauseIndent() + 1); emit(display, false) }
          else emit(display)
        } else if (LOGIC_KW.has(upper) && inLogic()) { nl(clauseIndent() + 1); emit(display, false) }
        else emit(display)
      } else emit(t.value)
      i++; continue
    }

    emit(t.value); i++
  }
  flush()
  return lines.join('\n')
}

function compressSQL(sql, options) {
  const { removeComments = true } = options || {}
  const tokens = tokenize(sql)
  // 逐 token 构建，仅在非字符串 token 间加单空格，字符串原样保留
  let result = ''
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (removeComments && (t.type === 'comment_line' || t.type === 'comment_block')) continue

    const needSpace = result.length > 0 && !/[.(\s]$/.test(result) && t.type !== 'paren_close' && t.type !== 'comma' && t.type !== 'semicolon' && t.value !== '.'
    if (t.type === 'operator' && t.value === '.') { result = result.trimEnd() + '.'; continue }
    if (t.type === 'comma') { result = result.trimEnd() + ', '; continue }
    if (t.type === 'paren_open') { result = result.trimEnd() + '('; continue }
    if (t.type === 'paren_close') { result = result.trimEnd() + ') '; continue }
    if (t.type === 'semicolon') { result = result.trimEnd() + '; '; continue }
    // 字符串 token 原样拼接，不做任何空格折叠
    if (needSpace) result += ' '
    result += t.value
  }
  return result.trim()
}

module.exports = { formatSQL, compressSQL }
