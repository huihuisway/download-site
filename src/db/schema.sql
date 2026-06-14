-- download_logs 表: 文件记录与下载统计
CREATE TABLE IF NOT EXISTS download_logs (
  id              INTEGER   PRIMARY KEY AUTOINCREMENT,
  file_name       TEXT      NOT NULL,
  file_path       TEXT      NOT NULL UNIQUE,
  category        TEXT      NOT NULL,
  file_size       INTEGER   NOT NULL DEFAULT 0,
  mime_type       TEXT,
  sha256          TEXT,
  description     TEXT,
  uploaded_by     INTEGER,
  download_count  INTEGER   NOT NULL DEFAULT 0,
  last_download_at DATETIME,
  file_mtime      TEXT      NOT NULL,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- settings 表: 系统配置
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 默认主题
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'editorial');

-- 索引
CREATE INDEX IF NOT EXISTS idx_category ON download_logs(category);
CREATE INDEX IF NOT EXISTS idx_file_path ON download_logs(file_path);
CREATE INDEX IF NOT EXISTS idx_download_count ON download_logs(download_count DESC);
CREATE INDEX IF NOT EXISTS idx_file_mtime ON download_logs(file_mtime);
