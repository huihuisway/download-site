/**
 * 轻量级 JSON 文件数据库
 * 提供类似 better-sqlite3 的同步 API
 * 用于在无原生编译环境时替代 SQLite
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

class JsonDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.data = {};
    this.tables = {};
    this._load();
  }

  _load() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
    }
    // 初始化表
    if (!this.data.download_logs) {
      this.data.download_logs = [];
      this.data._nextId = 1;
    }
    if (!this.data.sessions) {
      this.data.sessions = {};
    }
    if (!this.data.settings) {
      this.data.settings = [{ key: 'theme', value: 'editorial', updated_at: new Date().toISOString() }];
    }
    if (!this.data.api_keys) {
      this.data.api_keys = [];
    }
    if (!this.data._nextApiKeyId) {
      this.data._nextApiKeyId = 1;
    }
    if (!this.data._nextId) {
      this.data._nextId = this.data.download_logs.length > 0
        ? Math.max(...this.data.download_logs.map((r) => r.id)) + 1
        : 1;
    }
    this._save();
  }

  _save() {
    // 原子写入：先写临时文件，再重命名覆盖，避免崩溃时损坏数据库
    const tmp = this.dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.dbPath);
  }

  pragma(_stmt) {
    // No-op for compatibility
  }

  exec(_sql) {
    // No-op for compatibility
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  transaction(fn) {
    return (...args) => {
      const result = fn(...args);
      this._save();
      return result;
    };
  }

  close() {
    this._save();
  }
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
  }

  run(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? args[0]
      : args;
    return this._execute(params);
  }

  get(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? args[0]
      : args;
    const results = this._execute(params);
    return Array.isArray(results) ? results[0] : results;
  }

  all(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? args[0]
      : args;
    const results = this._execute(params);
    return Array.isArray(results) ? results : [];
  }

  _execute(params) {
    const sql = this.sql;

    // CREATE TABLE
    if (sql.startsWith('CREATE TABLE')) {
      return { changes: 0 };
    }

    // CREATE INDEX
    if (sql.startsWith('CREATE INDEX')) {
      return { changes: 0 };
    }

    // INSERT OR REPLACE / UPSERT
    if (sql.includes('INSERT OR REPLACE') || sql.includes('ON CONFLICT')) {
      return this._executeInsert(params, true);
    }

    // INSERT
    if (sql.startsWith('INSERT')) {
      return this._executeInsert(params, false);
    }

    // UPDATE
    if (sql.startsWith('UPDATE')) {
      return this._executeUpdate(params);
    }

    // DELETE
    if (sql.startsWith('DELETE')) {
      return this._executeDelete(params);
    }

    // SELECT
    if (sql.startsWith('SELECT')) {
      return this._executeSelect(params);
    }

    return { changes: 0 };
  }

  _executeInsert(params, upsert) {
    const table = this._extractTableName('INSERT');
    if (!this.db.data[table]) this.db.data[table] = [];

    const values = this._resolveParams(params);

    // Check for upsert (UNIQUE conflict on file_path)
    if (upsert && table === 'download_logs' && values.file_path) {
      const existingIdx = this.db.data[table].findIndex((r) => r.file_path === values.file_path);
      if (existingIdx >= 0) {
        const existing = this.db.data[table][existingIdx];
        // ON CONFLICT DO UPDATE SET - update specified fields but preserve download_count
        for (const key of Object.keys(values)) {
          if (key !== 'download_count' && key !== 'created_at') {
            existing[key] = values[key];
          }
        }
        existing.updated_at = new Date().toISOString();
        this.db._save();
        return { changes: 1, lastInsertRowid: existing.id };
      }
    }

    const record = {
      id: this.db.data._nextId++,
      download_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...values,
    };

    this.db.data[table].push(record);
    this.db._save();
    return { changes: 1, lastInsertRowid: record.id };
  }

  _executeUpdate(params) {
    const table = this._extractTableName('UPDATE');
    if (!this.db.data[table]) return { changes: 0 };

    const whereClause = this._extractWhere(params);
    const setValues = this._extractSetValues(params);

    let changes = 0;
    for (const record of this.db.data[table]) {
      if (this._matchesWhere(record, whereClause)) {
        for (const [key, value] of Object.entries(setValues)) {
          if (value && typeof value === 'object' && value._increment) {
            record[key] = (record[key] || 0) + value._increment;
          } else {
            record[key] = value;
          }
        }
        record.updated_at = new Date().toISOString();
        changes++;
      }
    }
    this.db._save();
    return { changes };
  }

  _executeDelete(params) {
    const table = this._extractTableName('DELETE');
    if (!this.db.data[table]) return { changes: 0 };

    const whereClause = this._extractWhere(params);
    const before = this.db.data[table].length;
    this.db.data[table] = this.db.data[table].filter((r) => !this._matchesWhere(r, whereClause));
    const changes = before - this.db.data[table].length;
    this.db._save();
    return { changes };
  }

  _executeSelect(params) {
    const sql = this.sql;
    const table = this._extractTableName('SELECT');

    // Handle sqlite_master queries
    if (!table || table === 'sqlite_master') {
      return [{ name: 'download_logs' }, { name: 'sessions' }];
    }

    if (!this.db.data[table]) return [];

    let results = [...this.db.data[table]];

    // WHERE clause
    const whereClause = this._extractWhere(params);
    if (whereClause) {
      results = results.filter((r) => this._matchesWhere(r, whereClause));
    }

    // GROUP BY
    const groupBy = this._extractGroupBy();
    if (groupBy) {
      results = this._groupBy(results, groupBy);
    }

    // ORDER BY
    const orderBy = this._extractOrderBy();
    if (orderBy) {
      results.sort((a, b) => {
        const aVal = a[orderBy.field];
        const bVal = b[orderBy.field];
        if (orderBy.direction === 'DESC') {
          return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      });
    }

    // LIMIT / OFFSET
    const limitMatch = sql.match(/LIMIT\s+(\?|\d+)/i);
    const offsetMatch = sql.match(/OFFSET\s+(\?|\d+)/i);

    if (limitMatch) {
      const limit = limitMatch[1] === '?' ? (Array.isArray(params) ? params[params.length - 2] : params.limit || 50) : parseInt(limitMatch[1]);
      const offset = offsetMatch
        ? (offsetMatch[1] === '?' ? (Array.isArray(params) ? params[params.length - 1] : params.offset || 0) : parseInt(offsetMatch[1]))
        : 0;
      results = results.slice(offset, offset + limit);
    }

    // Handle aggregate functions
    // COUNT(DISTINCT field)
    const distinctMatch = sql.match(/COUNT\(DISTINCT\s+(\w+)\)/i);
    if (distinctMatch && !groupBy) {
      const field = distinctMatch[1];
      const unique = new Set(results.map((r) => r[field]).filter((v) => v != null));
      return [{ count: unique.size }];
    }
    if (sql.includes('COUNT(*)') && !groupBy) {
      return [{ count: results.length }];
    }
    if (sql.includes('SUM(') && !groupBy) {
      const sumMatch = sql.match(/SUM\((\w+)\)/i);
      if (sumMatch) {
        const field = sumMatch[1];
        const total = results.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
        if (sql.includes('COALESCE(SUM')) {
          return [{ total }];
        }
        return results.length > 0 ? [{ [field]: total }] : [{ total: 0 }];
      }
    }
    if (sql.includes('MAX(') && !groupBy) {
      const maxMatch = sql.match(/MAX\((\w+)\)/i);
      if (maxMatch) {
        const field = maxMatch[1];
        return [{ version: Math.max(0, ...results.map((r) => r[field] || 0)) }];
      }
    }

    return results;
  }

  _extractTableName(keyword) {
    const patterns = {
      INSERT: /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(\w+)/i,
      UPDATE: /UPDATE\s+(\w+)/i,
      DELETE: /DELETE\s+FROM\s+(\w+)/i,
      SELECT: /FROM\s+(\w+)/i,
    };
    const match = this.sql.match(patterns[keyword]);
    return match ? match[1] : null;
  }

  _resolveParams(params) {
    if (typeof params === 'object' && !Array.isArray(params)) {
      return { ...params };
    }

    const result = {};

    if (Array.isArray(params)) {
      // 优先尝试从 INSERT 语句的列名映射位置参数
      const colMatch = this.sql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+\w+\s*\(([^)]+)\)/i);
      if (colMatch) {
        const columns = colMatch[1].split(',').map((c) => c.trim());
        columns.forEach((name, i) => {
          if (i < params.length) result[name] = params[i];
        });
        return result;
      }

      // 回退：从 @name 参数映射
      const paramNames = [];
      const nameMatches = this.sql.matchAll(/@(\w+)/g);
      for (const m of nameMatches) {
        if (!paramNames.includes(m[1])) paramNames.push(m[1]);
      }
      paramNames.forEach((name, i) => {
        if (i < params.length) result[name] = params[i];
      });
    }
    return result;
  }

  _extractWhere(params) {
    const whereMatch = this.sql.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|OFFSET|$)/is);
    if (!whereMatch) return null;

    const conditions = {};
    const whereStr = whereMatch[1].trim();

    // Parse simple conditions like "id = ?" or "file_path = ?"
    const condMatches = whereStr.matchAll(/(\w+)\s*=\s*\?/g);
    const paramValues = Array.isArray(params) ? params : [];
    let paramIdx = 0;

    for (const match of condMatches) {
      const field = match[1];
      if (typeof params === 'object' && !Array.isArray(params)) {
        conditions[field] = params[field];
      } else {
        conditions[field] = paramValues[paramIdx++];
      }
    }

    // Handle named params in WHERE
    const namedMatches = whereStr.matchAll(/(\w+)\s*=\s*@(\w+)/g);
    for (const match of namedMatches) {
      conditions[match[1]] = typeof params === 'object' ? params[match[2]] : undefined;
    }

    return conditions;
  }

  _extractSetValues(params) {
    const setMatch = this.sql.match(/SET\s+(.+?)\s+WHERE/is);
    if (!setMatch) return {};

    const sets = {};
    const setStr = setMatch[1];

    // Named params: field = @name
    const namedMatches = setStr.matchAll(/(\w+)\s*=\s*@(\w+)/g);
    for (const match of namedMatches) {
      sets[match[1]] = typeof params === 'object' ? params[match[2]] : undefined;
    }

    // Positional params: field = ?
    const positionalMatches = setStr.matchAll(/(\w+)\s*=\s*\?(?!.*@)/g);
    const paramValues = Array.isArray(params) ? params : [];
    let idx = 0;
    for (const match of positionalMatches) {
      if (!(match[1] in sets)) {
        sets[match[1]] = paramValues[idx++];
      }
    }

    // Handle CURRENT_TIMESTAMP
    const tsMatches = setStr.matchAll(/(\w+)\s*=\s*CURRENT_TIMESTAMP/g);
    for (const match of tsMatches) {
      sets[match[1]] = new Date().toISOString();
    }

    // Handle download_count = download_count + 1
    if (setStr.includes('download_count = download_count + 1')) {
      sets.download_count = { _increment: 1 };
    }

    return sets;
  }

  _matchesWhere(record, conditions) {
    if (!conditions || Object.keys(conditions).length === 0) return true;
    return Object.entries(conditions).every(([key, value]) => {
      const recordVal = record[key];
      if (value === undefined || value === null) return recordVal === value;
      // 严格相等，但对字符串/数字做智能转换（兼容 URL 参数传入的字符串 ID）
      // 排除布尔值、空字符串等意外转换
      const isNumericPair = (
        (typeof recordVal === 'number' && typeof value === 'string' && value !== '') ||
        (typeof recordVal === 'string' && typeof value === 'number')
      );
      if (isNumericPair) {
        return Number(recordVal) === Number(value);
      }
      return recordVal === value;
    });
  }

  _extractGroupBy() {
    const match = this.sql.match(/GROUP BY\s+(\w+)/i);
    return match ? match[1] : null;
  }

  _groupBy(results, field) {
    const groups = {};
    for (const record of results) {
      const key = record[field];
      if (!groups[key]) {
        groups[key] = { [field]: key, file_count: 0, total_size: 0, total_downloads: 0, total: 0, count: 0 };
      }
      groups[key].file_count++;
      groups[key].count++;
      groups[key].total_size += Number(record.file_size) || 0;
      groups[key].total_downloads += Number(record.download_count) || 0;
      groups[key].total += Number(record.download_count) || 0;

      // Track MAX
      if (record.last_download_at && (!groups[key].last_download || record.last_download_at > groups[key].last_download)) {
        groups[key].last_download = record.last_download_at;
      }
    }
    return Object.values(groups);
  }

  _extractOrderBy() {
    const match = this.sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
    if (!match) return null;
    return { field: match[1], direction: (match[2] || 'ASC').toUpperCase() };
  }
}

// Singleton
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new JsonDatabase(config.dbPath);

const gracefulClose = () => {
  db.close();
};

process.on('exit', gracefulClose);
process.on('SIGINT', () => {
  gracefulClose();
  process.exit(0);
});

module.exports = { db, gracefulClose };
