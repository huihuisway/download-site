const express = require('express');
const router = express.Router();
const { apiKeyAuth, requireWritePermission } = require('../middleware/apiKeyAuth');
const fileService = require('../services/file.service');
const statsService = require('../services/stats.service');
const { db } = require('../db');

// 所有 API v1 路由需要 API Key 认证
router.use(apiKeyAuth);

// ===== 文件列表 (read) =====
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
    });

    // 如果有搜索参数，在结果中过滤
    let files = result.files;
    if (search) {
      const q = search.toLowerCase();
      files = files.filter((f) => f.file_name.toLowerCase().includes(q));
    }

    res.json({
      success: true,
      data: {
        files,
        pagination: result.pagination,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message },
    });
  }
});

// ===== 文件详情 (read) =====
router.get('/files/:id', (req, res) => {
  try {
    const file = statsService.getFileById(parseInt(req.params.id, 10));
    if (!file) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '文件不存在' },
      });
    }
    res.json({ success: true, data: { file } });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message },
    });
  }
});

// ===== 上传文件 (write) =====
router.post('/files/upload', requireWritePermission, (req, res) => {
  try {
    // 从 query 或 body 中读取审核相关字段
    const extraFields = {};
    if (req.query.approval_status) extraFields.approval_status = req.query.approval_status;
    if (req.query.resource_id) extraFields.approval_resource_id = parseInt(req.query.resource_id, 10);
    if (req.query.approval_source) extraFields.approval_source = req.query.approval_source;

    // 复用 file.service 的 uploadFiles（内部处理 multer + DB 写入）
    fileService.uploadFiles(req, res, extraFields);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message },
    });
  }
});

// ===== 更新文件 (write) =====
router.put('/files/:id', requireWritePermission, (req, res) => {
  try {
    const fileId = parseInt(req.params.id, 10);
    const { name, description } = req.body;

    if (!name && description === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '请提供 name 或 description' },
      });
    }

    let result;
    if (name) {
      result = fileService.renameFile(fileId, name);
    }
    if (description !== undefined) {
      result = fileService.updateDescription(fileId, description);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }
});

// ===== 删除文件 (write) =====
router.delete('/files/:id', requireWritePermission, (req, res) => {
  try {
    const result = fileService.deleteFile(parseInt(req.params.id, 10));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }
});

// ===== 批量删除 (write) =====
router.post('/files/batch-delete', requireWritePermission, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '请提供要删除的文件 ID 列表' },
      });
    }

    const result = fileService.batchDelete(ids);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }
});

// ===== 分类列表 (read) =====
router.get('/categories', (req, res) => {
  try {
    const categories = fileService.getCategories();
    res.json({ success: true, data: { categories } });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message },
    });
  }
});

// ===== 新建分类 (write) =====
router.post('/categories', requireWritePermission, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '请提供分类名称' },
      });
    }

    const result = fileService.createCategory(name.trim());
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }
});

// ===== 删除分类 (write) =====
router.delete('/categories/:name', requireWritePermission, (req, res) => {
  try {
    const result = fileService.deleteCategory(req.params.name);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }
});

// ===== 审核状态同步 (write) — 供 MindFourm 调用 =====
router.put('/files/:id/approval', requireWritePermission, (req, res) => {
  try {
    const fileId = parseInt(req.params.id, 10);
    const { status, resource_id, reject_reason } = req.body;

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `status 必须为 ${validStatuses.join(' / ')} 之一` },
      });
    }

    const file = statsService.getFileById(fileId);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '文件不存在' },
      });
    }

    // 更新审核状态
    const updateData = { approval_status: status };
    if (resource_id !== undefined) updateData.approval_resource_id = resource_id;
    if (status === 'rejected' && reject_reason) {
      updateData.reject_reason = reject_reason;
    }
    if (status === 'approved') {
      updateData.reject_reason = null;
    }

    db.prepare(`UPDATE download_logs SET approval_status = @approval_status, reject_reason = @reject_reason, approval_resource_id = @approval_resource_id, updated_at = @updated_at WHERE id = @id`).run({
      ...updateData,
      approval_resource_id: resource_id !== undefined ? resource_id : file.approval_resource_id || null,
      reject_reason: updateData.reject_reason !== undefined ? updateData.reject_reason : (status === 'approved' ? null : file.reject_reason || null),
      updated_at: new Date().toISOString(),
      id: fileId,
    });

    res.json({
      success: true,
      data: { id: fileId, approval_status: status },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message },
    });
  }
});

module.exports = router;
