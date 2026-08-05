const { config } = require('../config');
const releaseSourceService = require('./release-source.service');
const { syncRelease } = require('./release-sync.service');

let timer;
const sourceLocks = new Set();

const run = async () => {
  const sources = releaseSourceService.list().filter((source) => source.enabled);
  const results = [];
  const now = Date.now();
  for (const source of sources) {
    const interval = source.sync_interval_ms || config.releaseSync.interval;
    const last = Date.parse(source.last_sync_at || source.created_at || 0);
    if (last && now - last < interval) continue;
    if (sourceLocks.has(source.id)) {
      results.push({ source_id: source.id, skipped: true, reason: 'source-locked' });
      continue;
    }
    sourceLocks.add(source.id);
    try {
      results.push(await releaseSourceService.sync(source.id, { trigger: 'schedule' }));
    } catch (error) {
      console.error(`[release-sync] 来源 ${source.id} 同步失败:`, error.message);
      results.push({ source_id: source.id, failed: true, error: error.message });
    } finally {
      sourceLocks.delete(source.id);
    }
  }
  // 保留旧的单仓库环境变量配置，未配置来源时仍可按小时运行。
  if (sources.length === 0 && config.releaseSync.repository) {
    results.push(await syncRelease().catch((error) => ({ failed: true, error: error.message })));
  }
  return { results };
};

const startReleaseScheduler = () => {
  if (!config.releaseSync.enabled || timer) return timer;
  timer = setInterval(run, Math.min(config.releaseSync.interval, 60 * 60 * 1000));
  timer.unref?.();
  run().catch((error) => console.error('[release-sync] 调度失败:', error.message));
  return timer;
};

const stopReleaseScheduler = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
  sourceLocks.clear();
};

module.exports = { startReleaseScheduler, stopReleaseScheduler, run };
