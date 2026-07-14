import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, Check, RefreshCw, Eye, EyeOff } from 'lucide-react';
import api from '../api/client';

function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerm, setNewPerm] = useState('read');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = async () => {
    setLoading(true);
    try { const r = await api.getApiKeys(); setKeys(r.keys); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadKeys(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await api.createApiKey(newName.trim(), newPerm);
      setCreatedKey(r.key);
      setNewName('');
      setShowCreate(false);
      await loadKeys();
    } catch (err) { alert(`创建失败: ${err.message}`); }
    finally { setCreating(false); }
  };

  const handleRevoke = async (id, name) => {
    if (!confirm(`确认撤销 Key "${name}"？撤销后第三方将无法使用此 Key。`)) return;
    try { await api.revokeApiKey(id); await loadKeys(); }
    catch (err) { alert(`撤销失败: ${err.message}`); }
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">API Key 管理</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            创建 API Key 供第三方程序调用 <code className="text-xs" style={{ color: 'var(--primary)' }}>/api/v1/*</code> 接口
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1.5" />创建 Key
        </button>
      </div>

      {/* Created Key Alert */}
      {createdKey && (
        <div className="card !p-4" style={{ borderColor: 'var(--primary)', borderWidth: '1px' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Key 创建成功！请立即复制保存</span>
            <button className="btn-ghost !p-1" onClick={() => setCreatedKey(null)}><EyeOff className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 text-sm font-mono" style={{ background: 'var(--muted)', color: 'var(--text)' }}>
              {createdKey.key}
            </code>
            <button className="btn-secondary !px-3" onClick={() => copyKey(createdKey.key)}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            ⚠️ 此 Key 仅显示一次，关闭后将无法再次查看完整值
          </p>
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md mx-4" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-modal)' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-semibold text-lg" style={{ color: 'var(--text)' }}>创建 API Key</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost !p-1.5">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Key 名称</label>
                <input type="text" className="input-field" placeholder="例如：CI/CD 部署、监控脚本" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>权限</label>
                <select className="input-field" value={newPerm} onChange={(e) => setNewPerm(e.target.value)}>
                  <option value="read">只读（read）— 仅查询文件列表和分类</option>
                  <option value="write">读写（write）— 查询 + 上传/删除/目录操作</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-3" style={{ borderTop: '1px solid var(--border)' }}>
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Key List */}
      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      ) : keys.length === 0 ? (
        <div className="card text-center py-16">
          <Key className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p style={{ color: 'var(--text-muted)' }}>暂无 API Key，点击上方"创建 Key"开始</p>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Key</th>
                <th>权限</th>
                <th>创建时间</th>
                <th>最后使用</th>
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium" style={{ color: 'var(--text)' }}>{k.name}</td>
                  <td><code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{k.key_preview}</code></td>
                  <td>
                    <span className={k.permission === 'write' ? 'badge-info' : 'badge-neutral'}>
                      {k.permission === 'write' ? '读写' : '只读'}
                    </span>
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(k.created_at).toLocaleDateString('zh-CN')}</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString('zh-CN') : '从未使用'}</td>
                  <td>
                    <span className={k.is_active ? 'badge-success' : 'badge-error'}>
                      {k.is_active ? '有效' : '已撤销'}
                    </span>
                  </td>
                  <td className="text-right">
                    {k.is_active && (
                      <button onClick={() => handleRevoke(k.id, k.name)} className="btn-ghost !p-1.5" style={{ color: 'var(--error)' }} title="撤销">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ApiKeys;
