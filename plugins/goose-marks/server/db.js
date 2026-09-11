import pg from 'pg'

const { Pool } = pg

// 数据库连接池
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'GooseMarks',
  user: process.env.DB_USER || 'GooseMarks',
  password: process.env.DB_PASSWORD || '',
  max: 10, // 最大连接数
  idleTimeoutMillis: 30000
})

// 初始化数据库表
export async function initDatabase() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_groups (
        id VARCHAR(20) PRIMARY KEY,
        owner_pwd VARCHAR(100),
        active BOOLEAN DEFAULT true,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_items (
        share_id VARCHAR(20) NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
        item_id VARCHAR(100) NOT NULL,
        item_type VARCHAR(20) NOT NULL,
        content JSONB,
        is_deleted BOOLEAN DEFAULT false,
        updated_at BIGINT NOT NULL,
        client_id VARCHAR(50),
        PRIMARY KEY (share_id, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_sync_items_pull ON sync_items (share_id, updated_at);
    `)
    console.log('✅ Database initialized')
  } finally {
    client.release()
  }
}


export { pool }
