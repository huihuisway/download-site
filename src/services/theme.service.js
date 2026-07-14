const { db } = require('../db');

// 可用主题列表
const AVAILABLE_THEMES = [
  { id: 'editorial', name: '编辑/杂志风', description: 'Noto Serif SC 衬线标题 + 纯黑白 + 侧栏导航' },
  { id: 'cloud', name: '经典网盘风', description: '卡片 + 圆角 + 表格 + 分类标签，像百度云盘' },
  { id: 'mirror', name: '镜像站/技术风', description: '纯表格 + 紧凑行 + 无多余留白，像 Debian 镜像站' },
  { id: 'terminal', name: '暗色终端风', description: '深色背景 + 亮色字 + 等宽字体，极客风格' },
];

// 默认站点信息
const DEFAULT_SITE_INFO = {
  site_name: '文件下载站',
  site_description: '轻量级文件下载服务',
  footer_text: 'Powered by Node.js',
  footer_links: JSON.stringify([
    { label: '管理后台', url: '/admin' },
  ]),
  icp_number: '',
  police_number: '',
};

// 验证 URL 是否为安全的 http/https 协议
const isSafeUrl = (url) => {
  if (typeof url !== 'string') return false;
  return /^https?:\/\//i.test(url);
};

// 直接操作 JSON 数据库的 settings 数组
const getSettingsArray = () => {
  if (!db.data.settings) {
    db.data.settings = [
      { key: 'theme', value: 'editorial', updated_at: new Date().toISOString() },
      ...Object.entries(DEFAULT_SITE_INFO).map(([key, value]) => ({
        key, value, updated_at: new Date().toISOString(),
      })),
    ];
  }
  return db.data.settings;
};

// 通用：获取某个设置
const getSetting = (key, defaultValue = '') => {
  try {
    const settings = getSettingsArray();
    const row = settings.find((s) => s.key === key);
    return row?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
};

// 通用：设置某个值
const setSetting = (key, value) => {
  const settings = getSettingsArray();
  const existing = settings.find((s) => s.key === key);
  if (existing) {
    existing.value = value;
    existing.updated_at = new Date().toISOString();
  } else {
    settings.push({ key, value, updated_at: new Date().toISOString() });
  }
  db._save();
  return value;
};

// 批量获取所有设置
const getAllSettings = () => {
  const settings = getSettingsArray();
  const result = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  // 确保默认值存在
  for (const [key, value] of Object.entries(DEFAULT_SITE_INFO)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
};

// 批量更新设置
const updateSettings = (updates) => {
  for (const [key, value] of Object.entries(updates)) {
    setSetting(key, value);
  }
  return getAllSettings();
};

// ===== 主题相关 =====
const getTheme = () => {
  const themeId = getSetting('theme', 'editorial');
  if (!AVAILABLE_THEMES.find((t) => t.id === themeId)) {
    return 'editorial';
  }
  return themeId;
};

const setTheme = (themeId) => {
  if (!AVAILABLE_THEMES.find((t) => t.id === themeId)) {
    throw new Error(`无效主题: ${themeId}`);
  }
  return setSetting('theme', themeId);
};

const getAvailableThemes = () => AVAILABLE_THEMES;

// ===== 站点信息相关 =====
const getSiteInfo = () => {
  const all = getAllSettings();
  let footerLinks = [];
  try {
    footerLinks = JSON.parse(all.footer_links || '[]');
  } catch {
    footerLinks = [];
  }
  return {
    site_name: all.site_name || DEFAULT_SITE_INFO.site_name,
    site_description: all.site_description || DEFAULT_SITE_INFO.site_description,
    footer_text: all.footer_text || DEFAULT_SITE_INFO.footer_text,
    footer_links: footerLinks,
    icp_number: all.icp_number || '',
    police_number: all.police_number || '',
  };
};

const updateSiteInfo = (info) => {
  const updates = {};
  if (info.site_name !== undefined) updates.site_name = info.site_name;
  if (info.site_description !== undefined) updates.site_description = info.site_description;
  if (info.footer_text !== undefined) updates.footer_text = info.footer_text;
  if (info.icp_number !== undefined) updates.icp_number = info.icp_number;
  if (info.police_number !== undefined) updates.police_number = info.police_number;
  if (info.footer_links !== undefined) {
    // 过滤不安全的 URL（只允许 http/https）
    const safeLinks = Array.isArray(info.footer_links)
      ? info.footer_links.filter((link) => link && isSafeUrl(link.url))
      : [];
    updates.footer_links = JSON.stringify(safeLinks);
  }
  updateSettings(updates);
  return getSiteInfo();
};

module.exports = {
  // 主题
  getTheme,
  setTheme,
  getAvailableThemes,
  AVAILABLE_THEMES,
  // 站点信息
  getSiteInfo,
  updateSiteInfo,
  // 通用
  getSetting,
  setSetting,
  getAllSettings,
  updateSettings,
};
