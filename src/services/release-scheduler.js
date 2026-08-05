const { config } = require('../config');
const { syncRelease } = require('./release-sync.service');

let timer;
const startReleaseScheduler = () => {
  if (!config.releaseSync.enabled || timer) return timer;
  const run = () => syncRelease().catch((error) => console.error('[release-sync] 同步失败:', error.message));
  timer = setInterval(run, config.releaseSync.interval);
  timer.unref?.();
  run();
  return timer;
};
const stopReleaseScheduler = () => { if (timer) clearInterval(timer); timer = undefined; };
module.exports = { startReleaseScheduler, stopReleaseScheduler };
