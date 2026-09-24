import { pool } from './db.js'

// --- Items Operations ---

/**
 * 批量推送变更 (Transactional Upsert)
 * @param {string} shareId
 * @param {Array} items - [{ itemId, itemType, content, isDeleted, updatedAt, clientId }]
 */
export async function pushItems(shareId, items) {
  if (!items || items.length === 0) return { success: true, processed: 0 }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. 验证 SyncGroup 是否存在
    const groupRes = await client.query('SELECT id FROM sync_groups WHERE id = $1', [shareId])
    if (groupRes.rowCount === 0) {
      // 自动创建 SyncGroup (如果不存在)
      // 在实际生产中可能需要显式创建接口，这里简化为惰性创建
      const now = Date.now()
      await client.query(
        'INSERT INTO sync_groups (id, created_at, updated_at) VALUES ($1, $2, $3)',
        [shareId, now, now]
      )
    }

    let processedCount = 0

    for (const item of items) {
      // LWW Check: 只有当 incoming.updatedAt > current.updatedAt 时才写入
      // 为了效率，可以在 SQL 中直接做，或者先查后写。这里用 UPSERT + WHERE 条件
      
      const query = `
        INSERT INTO sync_items (share_id, item_id, item_type, content, is_deleted, updated_at, client_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (share_id, item_id) 
        DO UPDATE SET
          content = EXCLUDED.content,
          is_deleted = EXCLUDED.is_deleted,
          updated_at = EXCLUDED.updated_at,
          client_id = EXCLUDED.client_id
        WHERE EXCLUDED.updated_at > sync_items.updated_at
      `
      
      const res = await client.query(query, [
        shareId,
        item.itemId,
        item.itemType,
        JSON.stringify(item.content),
        item.isDeleted || false,
        item.updatedAt,
        item.clientId || 'unknown'
      ])
      
      processedCount += res.rowCount // rowCount=1 experienced update/insert, 0 means ignored (old version)
    }

    // 更新 Group 的最后活跃时间
    await client.query('UPDATE sync_groups SET updated_at = $1 WHERE id = $2', [Date.now(), shareId])

    await client.query('COMMIT')
    return { success: true, processed: processedCount }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[SyncService] Push failed:', e)
    throw e
  } finally {
    client.release()
  }
}

/**
 * 增量拉取变更
 * @param {string} shareId 
 * @param {number} since - 时间戳 (cursor)
 */
export async function pullItems(shareId, since = 0, sinceId = null) {
  const PAGE_LIMIT = 1000
  // 复合游标 (updated_at, item_id)：单时间戳游标在页边界落在一批同毫秒记录中间时，
  // 下一页 updated_at > T 会永久跳过剩余的同毫秒记录；而无上限的平局扩展又会让
  // 响应大小失控（批量操作可产生上万条同毫秒记录）。复合游标既不跳记录又严格有界。
  //
  // 版本兼容：sinceId === null 表示旧客户端（请求里没有 sinceId 参数），
  // 必须保持原 `updated_at > since` 语义——若对旧客户端也启用复合谓词，
  // 它存完 lastUpdatedAt 后下一轮会反复重收 since 时刻的记录（≥1000 条同毫秒时
  // 还会被前缀饿死，永远拉不到更晚数据）。新客户端始终显式携带 sinceId（可为空串）。
  // 多取 1 条用于精确判断 hasMore（避免恰好整页时误报还有更多）。
  const useCompoundCursor = sinceId !== null && sinceId !== undefined
  const result = useCompoundCursor
    ? await pool.query(
        `SELECT item_id, item_type, content, is_deleted, updated_at, client_id
         FROM sync_items
         WHERE share_id = $1
           AND (updated_at > $2 OR (updated_at = $2 AND item_id > $3))
         ORDER BY updated_at ASC, item_id ASC
         LIMIT $4`,
        [shareId, since, sinceId, PAGE_LIMIT + 1]
      )
    : await pool.query(
        `SELECT item_id, item_type, content, is_deleted, updated_at, client_id
         FROM sync_items
         WHERE share_id = $1 AND updated_at > $2
         ORDER BY updated_at ASC, item_id ASC
         LIMIT $3`,
        [shareId, since, PAGE_LIMIT + 1]
      )

  let rows = result.rows
  let hasMore = false
  if (rows.length > PAGE_LIMIT) {
    hasMore = true
    rows = rows.slice(0, PAGE_LIMIT)
  }

  // 转换 row 格式
  const items = rows.map(row => ({
    itemId: row.item_id,
    itemType: row.item_type,
    content: row.content,
    isDeleted: row.is_deleted,
    updatedAt: parseInt(row.updated_at),
    clientId: row.client_id
  }))

  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null
  return {
    items,
    hasMore,
    lastUpdatedAt: lastRow ? parseInt(lastRow.updated_at) : since,
    // 复合游标的第二维：客户端下一页携带，保证同毫秒批量记录不跳不爆
    lastItemId: lastRow ? lastRow.item_id : (sinceId ?? '')
  }
}

/**
 * 获取 SyncGroup 信息
 */
export async function getSyncGroup(shareId) {
  const res = await pool.query('SELECT * FROM sync_groups WHERE id = $1', [shareId])
  if (res.rowCount === 0) return null
  return {
    id: res.rows[0].id,
    active: res.rows[0].active,
    updatedAt: parseInt(res.rows[0].updated_at)
  }
}
