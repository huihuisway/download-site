const API_BASE = '/api/admin';

const handleResponse = async (response) => {
  if (response.status === 401) {
    window.location.href = '/auth/login?returnUrl=/admin';
    throw new Error('未授权');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${response.status})`);
  }

  return response.json();
};

export const api = {
  // 统计
  async getStats() {
    const res = await fetch(`${API_BASE}/stats`);
    return handleResponse(res);
  },

  async getTopFiles(limit = 10) {
    const res = await fetch(`${API_BASE}/stats/top?limit=${limit}`);
    return handleResponse(res);
  },

  // 文件
  async getFiles(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/files?${query}`);
    return handleResponse(res);
  },

  async getFile(id) {
    const res = await fetch(`${API_BASE}/files/${id}`);
    return handleResponse(res);
  },

  async uploadFiles(files, category) {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    // category 通过 URL query 传递，避免 multipart 字段顺序问题
    const query = new URLSearchParams({ category }).toString();
    const res = await fetch(`${API_BASE}/files/upload?${query}`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse(res);
  },

  async deleteFile(id) {
    const res = await fetch(`${API_BASE}/files/${id}`, { method: 'DELETE' });
    return handleResponse(res);
  },

  async batchDelete(ids) {
    const res = await fetch(`${API_BASE}/files/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    return handleResponse(res);
  },

  async renameFile(id, name) {
    const res = await fetch(`${API_BASE}/files/${id}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse(res);
  },

  async updateDescription(id, description) {
    const res = await fetch(`${API_BASE}/files/${id}/description`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    return handleResponse(res);
  },

  async moveFile(id, folderPath) {
    const res = await fetch(`${API_BASE}/files/${id}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    });
    return handleResponse(res);
  },

  // 同步
  async sync() {
    const res = await fetch(`${API_BASE}/sync`, { method: 'POST' });
    return handleResponse(res);
  },

  // 分类
  async getCategories() {
    const res = await fetch(`${API_BASE}/categories`);
    return handleResponse(res);
  },

  async createCategory(name) {
    const res = await fetch(`${API_BASE}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse(res);
  },

  async deleteCategory(name) {
    // 编码后嵌套分类(docs/guides)成为单个路径段，服务端 :name 会解回原值
    const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
    return handleResponse(res);
  },

  // 目录管理
  async createFolder(folderPath) {
    const res = await fetch(`${API_BASE}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    return handleResponse(res);
  },

  async renameFolder(folderPath, newName) {
    const res = await fetch(`${API_BASE}/folders/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, newName }),
    });
    return handleResponse(res);
  },

  async deleteFolder(folderPath, recursive = false) {
    const res = await fetch(`${API_BASE}/folders/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, recursive }),
    });
    return handleResponse(res);
  },

  // 主题
  async getTheme() {
    const res = await fetch(`${API_BASE}/theme`);
    return handleResponse(res);
  },

  async setTheme(theme) {
    const res = await fetch(`${API_BASE}/theme`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
    return handleResponse(res);
  },

  // 站点信息
  async getSettings() {
    const res = await fetch(`${API_BASE}/settings`);
    return handleResponse(res);
  },

  async updateSettings(info) {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(info),
    });
    return handleResponse(res);
  },

  // API Key 管理
  async getApiKeys() {
    const res = await fetch(`${API_BASE}/api-keys`);
    return handleResponse(res);
  },

  async createApiKey(name, permission) {
    const res = await fetch(`${API_BASE}/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, permission }),
    });
    return handleResponse(res);
  },

  async revokeApiKey(id) {
    const res = await fetch(`${API_BASE}/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return handleResponse(res);
  },

  // 发布同步来源
  async getReleases() {
    const [sources, health] = await Promise.all([
      fetch(`${API_BASE}/releases/sources`).then(handleResponse),
      fetch(`${API_BASE}/releases/health`).then(handleResponse),
    ]);
    return { ...sources, health };
  },

  async getReleaseSources() {
    return handleResponse(await fetch(`${API_BASE}/releases/sources`));
  },

  async getReleaseHealth() {
    return handleResponse(await fetch(`${API_BASE}/releases/health`));
  },
  async getReleaseSource(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}`)); },
  async createReleaseSource(data) { return handleResponse(await fetch(`${API_BASE}/releases/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })); },
  async updateReleaseSource(id, data) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })); },
  async deleteReleaseSource(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })); },
  async toggleReleaseSource(id, enabled) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' })); },
  async syncReleaseSource(id, options = {}) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) })); },
  async previewReleaseSource(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/preview`)); },
  async getReleaseSourceStatus(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/status`)); },
  async getReleaseSourceJobs(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/jobs`)); },
  async getReleaseSourceAssets(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/assets`)); },
  async retryReleaseTask(id) { return handleResponse(await fetch(`${API_BASE}/releases/sources/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); },
};

export default api;
