const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const fileService = require('../services/file.service');
const statsService = require('../services/stats.service');
const { syncDirectory } = require('../services/sync.service');

// 所有后台 API 需要鉴权
router.use(requireAuth);

// ===== 统计看板 =====
router.get('/stats', (req, res) => {
  try {
    const dashboard = statsService.getDashboardStats();
    const topFiles = statsService.getTopFiles(10);
    const categoryStats = statsService.getCategoryStats();

    res.json({
      dashboard,
      topFiles,
      categoryStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/top', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const topFiles = statsService.getTopFiles(limit);
    res.json({ topFiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 文件管理 =====
router.get('/files', (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 50,
      sortBy = 'file_name',
      sortOrder = 'ASC',
      category,
      search,
    } = req.query;

    const result = statsService.getAllFiles({
      page: parseInt(page, 10),
      pageSize: Math.min(parseInt(pageSize, 10) || 50, 200),
      sortBy,
      sortOrder,
      category,
      search,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files/:id', (req, res) => {
  try {
    const file = statsService.getFileById(req.params.id);
    if (!file) {
      return res.status(404).json({ error: '文件不存在' });
    }
    res.json({ file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/files/upload', fileService.uploadFiles);

router.delete('/files/:id', (req, res) => {
  try {
    const result = fileService.deleteFile(parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/files/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的文件 ID 列表' });
    }

    const result = fileService.batchDelete(ids);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/files/:id/rename', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '请提供新文件名' });
    }
    const result = fileService.renameFile(parseInt(req.params.id, 10), name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/files/:id/description', (req, res) => {
  try {
    const { description } = req.body;
    const result = fileService.updateDescription(parseInt(req.params.id, 10), description);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/files/:id/move', (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: '请提供目标目录路径' });
    }
    const result = fileService.moveFile(parseInt(req.params.id, 10), folderPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 同步 =====
router.post('/sync', async (req, res) => {
  try {
    const result = await syncDirectory();
    res.json({
      message: '同步完成',
      ...result,
      needsChecksumCount: result.needsChecksum?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 目录管理 =====
router.get('/categories', (req, res) => {
  try {
    const categories = fileService.getCategories();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '请提供分类名称' });
    }
    const result = fileService.createCategory(name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:name', (req, res) => {
  try {
    const result = fileService.deleteCategory(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 目录（文件夹）操作 =====

// 创建目录
router.post('/folders', (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: '请提供目录路径' });
    }
    const result = fileService.createFolder(folderPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 重命名目录
router.put('/folders/rename', (req, res) => {
  try {
    const { path: folderPath, newName } = req.body;
    if (!folderPath || !newName) {
      return res.status(400).json({ error: '请提供目录路径和新名称' });
    }
    const result = fileService.renameFolder(folderPath, newName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 删除目录
router.post('/folders/delete', (req, res) => {
  try {
    const { path: folderPath, recursive = false } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: '请提供目录路径' });
    }
    const result = fileService.deleteFolder(folderPath, { recursive });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 主题管理 =====
const themeService = require('../services/theme.service');

router.get('/theme', (req, res) => {
  try {
    const currentTheme = themeService.getTheme();
    const themes = themeService.getAvailableThemes();
    res.json({ currentTheme, themes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/theme', (req, res) => {
  try {
    const { theme } = req.body;
    if (!theme) {
      return res.status(400).json({ error: '请提供主题 ID' });
    }
    const result = themeService.setTheme(theme);
    res.json({ currentTheme: result, message: '主题已更新' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 站点信息管理 =====
router.get('/settings', (req, res) => {
  try {
    const siteInfo = themeService.getSiteInfo();
    res.json({ siteInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const result = themeService.updateSiteInfo(req.body);
    res.json({ siteInfo: result, message: '站点信息已更新' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== API Key 管理 =====
const apiKeyService = require('../services/api-key.service');

router.get('/api-keys', (req, res) => {
  try {
    const keys = apiKeyService.listKeys();
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api-keys', (req, res) => {
  try {
    const { name, permission } = req.body;
    const key = apiKeyService.generateKey(name, permission);
    // 创建时返回完整 Key（仅此一次）
    res.json({ key });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api-keys/:id', (req, res) => {
  try {
    const result = apiKeyService.revokeKey(parseInt(req.params.id, 10));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
