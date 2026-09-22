/* global process, console, require */

const { config, validateConfig } = require('../src/config');
const ecosystem = require('../ecosystem.config');

const errors = [];
const app = ecosystem.apps?.[0];

if (!config.isProduction) errors.push('NODE_ENV must be production');
if (!app || app.instances !== 1 || app.exec_mode !== 'fork') errors.push('PM2 must run exactly one fork-mode instance');

const validation = validateConfig();
errors.push(...validation.fatal);
for (const warning of validation.warnings) console.warn(`[production] WARNING: ${warning}`);

if (errors.length) {
  console.error('[production] configuration check failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('[production] authentication, secrets, and PM2 single-instance settings passed');
}
