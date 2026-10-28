// ZTools MCP adapter. Reuses journalApi; never calls AI or writes user data.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const datasets = require('../../assets/data/journals/manifest.json')

const SUMMARY_FIELDS = ['name', 'abbr', 'issn', 'eissn', 'publisher', 'category',
  'jif', 'quartile', 'year', 'ccfRank', 'ccfCat', 'ccfAbbr']
const DETAIL_FIELDS = SUMMARY_FIELDS.concat(['jifPct', 'jifRank', 'jci', 'jciQuartile',
  'fiveYearJif', 'citations', 'articles', 'immediacy', 'oa', 'catDetail', 'ccfUrl', 'ccfNotes'])
const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

module.exports = function createJournalTools(api, directory) {
  let snapshot, recordIds

  function ready() {
    const state = api.ensureLoaded()
    if (!state.ok) throw new Error('期刊数据库加载失败：' + state.error)
    if (!snapshot) {
      const hash = crypto.createHash('sha256')
      for (const file of ['journals.json.gz', 'ccf.json.gz']) {
        hash.update(file + '\0')
        // An unavailable CCF file must not turn a usable JCR database into an error.
        if (file === 'ccf.json.gz' && state.ccfError) hash.update('unavailable')
        else hash.update(fs.readFileSync(path.join(directory, file === 'journals.json.gz' ? datasets.jcr.file : datasets.ccf.file)))
      }
      const years = new Set()
      recordIds = new Map()
      for (let i = 0; i < api.allTotal; i++) {
        const record = api.get(i)
        recordIds.set(record, i)
        if (record.year) years.add(String(record.year))
      }
      snapshot = {
        id: hash.digest('hex').slice(0, 16),
        source: '科研小盒内置 JCR / CCF 本地快照',
        jcrEdition: datasets.jcr.edition + '（随插件数据集标注）',
        jifYears: Array.from(years).sort(),
        ccfEdition: datasets.ccf.edition + '（随插件数据集标注）',
        journalCount: api.total,
        recordCount: api.allTotal,
        notes: '非实时查询；year 是 JIF 数据年，quartile 是 JCR 分区，不是中科院分区。指标保留原始字符串；缺失值为 null，不代表 0。',
        warnings: state.ccfError ? ['CCF 数据不可用，本次仅返回 JCR 数据。'] : []
      }
    }
    return snapshot
  }

  function inputObject(input, keys) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('输入必须是对象')
    if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('包含不支持的参数')
  }

  function serialize(record, details) {
    const out = {
      id: snapshot.id + ':' + recordIds.get(record),
      type: record._conf ? 'conference' : 'journal'
    }
    for (const key of details ? DETAIL_FIELDS : SUMMARY_FIELDS) {
      out[key] = record[key] === undefined || record[key] === '' ? null : record[key]
    }
    return out
  }

  return {
    search_journals(input = {}) {
      inputObject(input, ['query', 'type', 'limit'])
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 256) {
        throw new Error('query 必须是 1–256 字符的期刊名、缩写、ISSN 或 CCF 中文领域')
      }
      const type = input.type === undefined ? 'journal' : input.type
      const limit = input.limit === undefined ? 10 : input.limit
      if (!['journal', 'conference', 'all'].includes(type)) throw new Error('type 必须为 journal、conference 或 all')
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit 必须是 1–50 的整数')
      const data = ready()
      const query = input.query.trim()
      // journalApi's ISSN fast path expects the standard hyphenated form.
      const compact = query.replace(/\s+/g, '')
      const searchQuery = /^\d{4}-?\d{3}[\dXx]$/.test(compact)
        ? compact.replace(/^(\d{4})-?(\d{3}[\dXx])$/, '$1-$2') : query
      const matches = api.search(searchQuery, api.allTotal, type === 'conference' ? 'conf' : type)
      const normalizedQuery = normalize(query)
      const items = matches.slice(0, limit).map(record => ({
        ...serialize(record, false),
        match: normalizedQuery && ['name', 'abbr', 'issn', 'eissn', 'ccfAbbr'].some(
          key => normalize(record[key]) === normalizedQuery) ? 'exact' : 'related'
      }))
      return { query, type, total: matches.length, returned: items.length,
        truncated: matches.length > items.length, items, snapshot: data }
    },

    get_journal(input = {}) {
      inputObject(input, ['id'])
      if (typeof input.id !== 'string' || !/^[a-f0-9]{16}:\d{1,8}$/.test(input.id)) {
        throw new Error('id 必须使用 search_journals 返回的记录 ID')
      }
      const data = ready()
      const [snapshotId, index] = input.id.split(':')
      if (snapshotId !== data.id) throw new Error('数据快照已变化，请重新搜索后使用新 ID')
      const record = api.get(Number(index))
      if (!record) throw new Error('未找到该记录，请重新搜索')
      return { item: serialize(record, true), snapshot: data }
    }
  }
}
