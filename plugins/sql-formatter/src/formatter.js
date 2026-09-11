import { format } from 'sql-formatter'

export const DIALECTS = [
  ['sql', 'Standard SQL'],
  ['mysql', 'MySQL'],
  ['postgresql', 'PostgreSQL'],
  ['transactsql', 'SQL Server / T-SQL'],
  ['plsql', 'Oracle PL/SQL'],
  ['sqlite', 'SQLite'],
  ['mariadb', 'MariaDB'],
  ['bigquery', 'BigQuery'],
  ['snowflake', 'Snowflake'],
  ['redshift', 'Redshift'],
  ['spark', 'Spark SQL'],
  ['hive', 'Hive'],
  ['trino', 'Trino / Presto'],
  ['duckdb', 'DuckDB'],
  ['db2', 'IBM DB2'],
  ['db2i', 'IBM DB2 for i'],
  ['tidb', 'TiDB'],
  ['singlestoredb', 'SingleStoreDB'],
  ['n1ql', 'Couchbase N1QL']
]

/**
 * 将 SQL 按界面选项格式化。
 * @param {string} sql 待格式化的 SQL。
 * @param {{language?: string, keywordCase?: string, tabWidth?: number, denseOperators?: boolean}} options 格式化选项。
 * @returns {string} 格式化后的 SQL。
 * @throws {Error} SQL 为空、方言不支持或解析失败时抛出。
 */
export function formatSql(sql, options = {}) {
  const source = String(sql ?? '').trim()
  if (!source) {
    throw new Error('请先输入 SQL')
  }

  const language = DIALECTS.some(([value]) => value === options.language)
    ? options.language
    : 'sql'
  const keywordCase = ['upper', 'lower', 'preserve'].includes(options.keywordCase)
    ? options.keywordCase
    : 'preserve'
  const tabWidth = options.tabWidth === 4 ? 4 : 2

  return format(source, {
    language,
    keywordCase,
    tabWidth,
    useTabs: false,
    denseOperators: Boolean(options.denseOperators),
    linesBetweenQueries: 1
  })
}

/**
 * 从 ZTools 进入事件中提取可格式化的文本。
 * @param {{type?: string, payload?: unknown}|null|undefined} action 插件进入事件。
 * @returns {string} 可作为 SQL 的文本；无文本时返回空字符串。
 */
export function extractSqlFromAction(action) {
  if (!action || !['regex', 'over'].includes(action.type || '')) return ''
  if (typeof action.payload === 'string') return action.payload.trim()
  if (typeof action.payload?.text === 'string') return action.payload.text.trim()
  return ''
}
