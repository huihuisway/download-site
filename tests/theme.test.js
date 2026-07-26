const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('theme');

describe('theme service', () => {
  before(() => {
    fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
  });

  after(() => {
    tmpEnv.cleanup();
  });

  beforeEach(() => {
    const { db } = require('../src/db');
    db.data.settings = undefined;
    db._save();
  });

  describe('主题管理', () => {
    it('默认主题应为 editorial', () => {
      const themeService = require('../src/services/theme.service');
      assert.strictEqual(themeService.getTheme(), 'editorial');
    });

    it('应能切换主题', () => {
      const themeService = require('../src/services/theme.service');
      themeService.setTheme('terminal');
      assert.strictEqual(themeService.getTheme(), 'terminal');
    });

    it('应拒绝无效主题', () => {
      const themeService = require('../src/services/theme.service');
      assert.throws(() => themeService.setTheme('nonexistent'), /无效主题/);
    });

    it('应返回可用主题列表', () => {
      const themeService = require('../src/services/theme.service');
      const themes = themeService.getAvailableThemes();
      assert.ok(themes.length >= 4);
      assert.ok(themes.some((t) => t.id === 'editorial'));
      assert.ok(themes.some((t) => t.id === 'terminal'));
      assert.ok(themes.some((t) => t.id === 'cloud'));
      assert.ok(themes.some((t) => t.id === 'mirror'));
    });
  });

  describe('站点信息', () => {
    it('应返回默认站点信息', () => {
      const themeService = require('../src/services/theme.service');
      const info = themeService.getSiteInfo();
      assert.strictEqual(info.site_name, '文件下载站');
      assert.ok(Array.isArray(info.footer_links));
    });

    it('应能更新站点名称', () => {
      const themeService = require('../src/services/theme.service');
      themeService.updateSiteInfo({ site_name: '新下载站' });
      const info = themeService.getSiteInfo();
      assert.strictEqual(info.site_name, '新下载站');
    });
  });

  describe('footer_links XSS 防护', () => {
    it('应过滤 javascript: 协议的 URL', () => {
      const themeService = require('../src/services/theme.service');
      themeService.updateSiteInfo({
        footer_links: [
          { label: '正常链接', url: 'https://example.com' },
          { label: '恶意链接', url: 'javascript:alert(1)' },
          { label: '另一个恶意', url: 'JavaScript:void(0)' },
        ],
      });

      const info = themeService.getSiteInfo();
      assert.strictEqual(info.footer_links.length, 1);
      assert.strictEqual(info.footer_links[0].url, 'https://example.com');
    });

    it('应允许 http 和 https 链接', () => {
      const themeService = require('../src/services/theme.service');
      themeService.updateSiteInfo({
        footer_links: [
          { label: 'HTTP', url: 'http://example.com' },
          { label: 'HTTPS', url: 'https://example.com' },
        ],
      });

      const info = themeService.getSiteInfo();
      assert.strictEqual(info.footer_links.length, 2);
    });

    it('应允许站内相对路径但拒绝协议相对地址', () => {
      const themeService = require('../src/services/theme.service');
      themeService.updateSiteInfo({
        footer_links: [
          { label: '后台', url: '/admin' },
          { label: '协议相对', url: '//evil.com/phish' },
          { label: '反斜杠变体', url: '/\\evil.com' },
        ],
      });

      const info = themeService.getSiteInfo();
      assert.strictEqual(info.footer_links.length, 1);
      assert.strictEqual(info.footer_links[0].url, '/admin');
    });

    it('应过滤 data: 协议的 URL', () => {
      const themeService = require('../src/services/theme.service');
      themeService.updateSiteInfo({
        footer_links: [
          { label: 'data URI', url: 'data:text/html,<script>alert(1)</script>' },
        ],
      });

      const info = themeService.getSiteInfo();
      assert.strictEqual(info.footer_links.length, 0);
    });
  });
});
