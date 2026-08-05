-- ============================================================
-- 【文档用途，非执行脚本】
-- 当前实现使用 JSON 文件数据库（src/db/index.js），db.exec() 是 no-op，
-- 本文件不会被真正执行。它描述数据模型的目标形态，也是将来迁移到
-- SQLite 时的建表参考。改动数据结构时请同步更新此文件。
-- ============================================================

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
  -- 论坛审核流程（pending / approved / rejected；NULL 视为无需审核）
  approval_status      TEXT,
  approval_source      TEXT,
  approval_resource_id INTEGER,
  reject_reason        TEXT,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- api_keys 表: 第三方 API 访问凭据（只存 SHA-256 哈希，不存明文）
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER  PRIMARY KEY AUTOINCREMENT,
  name         TEXT     NOT NULL,
  key_hash     TEXT     NOT NULL UNIQUE,
  key_prefix   TEXT     NOT NULL,
  permission   TEXT     NOT NULL DEFAULT 'read',  -- read | write
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  is_active    INTEGER  NOT NULL DEFAULT 1
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
<<<<<<< HEAD
CREATE INDEX IF NOT EXISTS idx_approval_status ON download_logs(approval_status);
CREATE INDEX IF NOT EXISTS idx_api_key_hash ON api_keys(key_hash);

-- release_sync 表: GitHub Releases 同步状态（JSON 数据库中对应同名集合）
CREATE TABLE IF NOT EXISTS release_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository TEXT NOT NULL UNIQUE,
  release_id INTEGER NOT NULL,
  tag_name TEXT NOT NULL,
  status TEXT NOT NULL,
  prerelease INTEGER NOT NULL DEFAULT 0,
  published_at DATETIME,
  synced_at DATETIME,
  error TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
