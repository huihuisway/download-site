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

  async moveFile(id, category) {
    const res = await fetch(`${API_BASE}/files/${id}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
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
    const res = await fetch(`${API_BASE}/categories/${name}`, { method: 'DELETE' });
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
    const res = await fetch(`${API_BASE}/api-keys/${id}`, { method: 'DELETE' });
    return handleResponse(res);
  },
};

export default api;
