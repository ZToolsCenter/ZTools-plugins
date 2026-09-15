-- Up
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
  item_type VARCHAR(20) NOT NULL, -- 'bookmark' | 'group' | 'subGroup'
  content JSONB,                  -- null if deleted (tombstone) or just use is_deleted flag
  is_deleted BOOLEAN DEFAULT false,
  updated_at BIGINT NOT NULL,     -- LWW timestamp
  client_id VARCHAR(50),          -- for debug
  PRIMARY KEY (share_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_items_pull ON sync_items (share_id, updated_at);

-- Down
DROP TABLE IF EXISTS sync_items;
DROP TABLE IF EXISTS sync_groups;
