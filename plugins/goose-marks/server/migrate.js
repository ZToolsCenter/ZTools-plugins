import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase, pool, createShare } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')

async function migrate() {
  console.log('Starting migration...')
  
  // Ensure we can connect to DB
  try {
    await initDatabase()
  } catch (err) {
    console.error('Failed to connect to database:', err)
    process.exit(1)
  }

  if (!fs.existsSync(DATA_DIR)) {
    console.log('No data directory found, skipping migration.')
    await pool.end()
    return
  }

  const files = await fs.readdir(DATA_DIR)
  let count = 0
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    
    try {
      const filePath = path.join(DATA_DIR, file)
      const data = await fs.readJson(filePath)
      
      // Use raw insert or createShare helper
      // shareId, type, sourceId, data
      // data in json file has: shareId, type, sourceId, data, active, createdAt, updatedAt
      
      // Check if already exists
      const existing = await pool.query('SELECT id FROM shares WHERE id = $1', [data.shareId])
      if (existing.rows.length > 0) {
        console.log(`Skipping existing share: ${data.shareId}`)
        continue
      }
      
      await pool.query(
        `INSERT INTO shares (id, type, source_id, data, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.shareId,
          data.type,
          data.sourceId,
          JSON.stringify(data.data),
          data.active ?? true,
          data.createdAt || Date.now(),
          data.updatedAt || Date.now()
        ]
      )
      
      console.log(`Migrated: ${data.shareId}`)
      count++
    } catch (err) {
      console.error(`Failed to migrate ${file}:`, err)
    }
  }
  
  console.log(`Migration complete. Migrated ${count} files.`)
  await pool.end()
}

migrate()
