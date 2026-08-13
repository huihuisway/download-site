/* global process, console, require */

const { URL } = require('url');
const { config, validateConfig } = require('../src/config');
const ecosystem = require('../ecosystem.config');

const errors = [];
const app = ecosystem.apps?.[0];

if (!config.isProduction) errors.push('NODE_ENV must be production');
if (!config.downloadBaseUrl) errors.push('DOWNLOAD_BASE_URL is required');
else {
  try {
    if (new URL(config.downloadBaseUrl).protocol !== 'https:') errors.push('DOWNLOAD_BASE_URL must use HTTPS');
  } catch {
    errors.push('DOWNLOAD_BASE_URL must be a valid URL');
  }
}
if (!config.admin.allowedEmails.length) errors.push('ADMIN_ALLOWED_EMAILS must contain at least one email');
if (!app || app.instances !== 1 || app.exec_mode !== 'fork') errors.push('PM2 must run exactly one fork-mode instance');

const validation = validateConfig();
errors.push(...validation.fatal);
for (const warning of validation.warnings) console.warn(`[production] WARNING: ${warning}`);

if (errors.length) {
  console.error('[production] configuration check failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('[production] configuration, OAuth whitelist, CDN URL, and PM2 single-instance settings passed');
}
