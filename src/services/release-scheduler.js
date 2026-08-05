const { config } = require('../config');
const { syncRelease } = require('./release-sync.service');

let timer;
let running = false;

const run = async () => {
  if (running) return { skipped: true, reason: 'already-running' };
  running = true;
  try {
    return await syncRelease();
  } catch (error) {
    console.error('[release-sync] 同步失败:', error.message);
    return { failed: true, error: error.message };
  } finally {
    running = false;
  }
};

const startReleaseScheduler = () => {
  if (!config.releaseSync.enabled || timer) return timer;
  timer = setInterval(run, config.releaseSync.interval);
  timer.unref?.();
  run();
  return timer;
};

const stopReleaseScheduler = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
  running = false;
};

module.exports = { startReleaseScheduler, stopReleaseScheduler, run };
