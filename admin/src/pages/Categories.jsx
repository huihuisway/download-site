import { useState, useEffect } from 'react';
import { FolderTree, Plus, Trash2, Files, Download, HardDrive, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { formatSize } from '../lib/utils';

function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadCategories = async () => {
    setLoading(true);
    try { setCategories((await api.getCategories()).categories); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCategories(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try { await api.createCategory(newName.trim()); setNewName(''); await loadCategories(); }
    catch (err) { alert(`创建失败: ${err.message}`); }
    finally { setCreating(false); }
  };

  const handleDelete = async (name) => {
    if (!confirm(`确认删除分类 "${name}"？仅在分类为空时成功。`)) return;
    try { await api.deleteCategory(name); await loadCategories(); }
    catch (err) { alert(`删除失败: ${err.message}`); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">目录管理</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>管理文件分类目录</p>
      </div>

      <div className="card !p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>创建新分类</h3>
        <div className="flex gap-3">
          <input type="text" className="input-field flex-1" placeholder="输入分类名称（如: software, documents）"
            value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button className="btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
            <Plus className="w-4 h-4 mr-1.5" />{creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      ) : categories.length === 0 ? (
        <div className="card text-center py-16">
          <FolderTree className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p style={{ color: 'var(--text-muted)' }}>暂无分类</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => {
            const isEmpty = cat.file_count === 0;
            return (
              <div key={cat.category} className="card !p-5 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'var(--muted)' }}>
                      <FolderTree className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                      <h4 className="font-semibold" style={{ color: 'var(--text)' }}>{cat.category}</h4>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{isEmpty ? '空分类' : `${cat.file_count} 个文件`}</p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(cat.category)} disabled={!isEmpty}
                    className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 disabled:opacity-0 transition-opacity"
                    title={isEmpty ? '删除' : '请先清空文件'}>
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--error)' }} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: Files, value: cat.file_count, label: '文件' },
                    { icon: Download, value: cat.total_downloads, label: '下载' },
                    { icon: HardDrive, value: formatSize(cat.total_size), label: '大小' },
                  ].map(({ icon: Icon, value, label }) => (
                    <div key={label} className="p-2.5 text-center" style={{ background: 'var(--muted)' }}>
                      <Icon className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: 'var(--text-muted)' }} />
                      <p className="text-sm font-bold tabular-nums truncate" style={{ color: 'var(--text)' }}>{value}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Categories;
