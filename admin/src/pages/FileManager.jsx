import { useState, useEffect, useCallback } from 'react';
import {
  Upload, Trash2, Search, X, Edit3, Check, FileText,
  Filter, RefreshCw, ChevronLeft, ChevronRight,
  Archive, Disc3, File, FileImage, FileSpreadsheet, FileCode, FileType,
} from 'lucide-react';
import api from '../api/client';
import { formatSize, formatDate } from '../lib/utils';

function FileIcon({ name, className = 'w-4 h-4' }) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap = {
    zip: Archive, gz: Archive, tar: Archive, '7z': Archive,
    iso: Disc3, pdf: FileText, txt: FileType, md: FileType,
    png: FileImage, jpg: FileImage, jpeg: FileImage,
    doc: FileText, docx: FileText, xlsx: FileSpreadsheet,
    js: FileCode, ts: FileCode, jsx: FileCode, tsx: FileCode,
  };
  const Icon = iconMap[ext] || File;
  return <Icon className={className} style={{ color: 'var(--text-muted)' }} />;
}

function UploadModal({ categories, onClose, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState(categories[0] || '');
  const [newCategory, setNewCategory] = useState('');
  const [useNewCategory, setUseNewCategory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const targetCategory = useNewCategory ? newCategory : category;
      if (!targetCategory) return alert('请选择或输入分类');
      await api.uploadFiles(files, targetCategory);
      onUploaded();
      onClose();
    } catch (err) {
      alert(`上传失败: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-lg mx-4 overflow-hidden" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-modal)' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text)' }}>上传文件</h3>
          <button onClick={onClose} className="btn-ghost !p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>目标分类</label>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setUseNewCategory(false)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: !useNewCategory ? 'var(--primary)' : 'var(--muted)', color: !useNewCategory ? '#fff' : 'var(--text-secondary)' }}>
                已有分类
              </button>
              <button onClick={() => setUseNewCategory(true)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: useNewCategory ? 'var(--primary)' : 'var(--muted)', color: useNewCategory ? '#fff' : 'var(--text-secondary)' }}>
                新建分类
              </button>
            </div>
            {useNewCategory ? (
              <input type="text" className="input-field" placeholder="输入新分类名（如: software）" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} autoFocus />
            ) : (
              <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>选择文件</label>
            <div
              className="p-8 text-center transition-colors"
              style={{ border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`, background: dragging ? 'var(--muted)' : 'transparent' }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: dragging ? 'var(--primary)' : 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                拖拽文件到此处，或{' '}
                <label className="font-medium cursor-pointer" style={{ color: 'var(--primary)' }}>
                  浏览文件<input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files))} />
                </label>
              </p>
            </div>
            {files.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs" style={{ background: 'var(--muted)' }}>
                    <FileIcon name={f.name} className="w-4 h-4 shrink-0" />
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{f.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatSize(f.size)}</span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ color: 'var(--text-muted)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 flex justify-end gap-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--muted)' }}>
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button className="btn-primary" onClick={handleUpload} disabled={uploading || files.length === 0}>
            {uploading ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />上传中...</> : <><Upload className="w-4 h-4 mr-2" />上传 {files.length > 0 ? `(${files.length})` : ''}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileManager() {
  const [files, setFiles] = useState([]);
  const [pagination, setPagination] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState('');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, pageSize: 50 };
      if (filterCategory) params.category = filterCategory;
      const result = await api.getFiles(params);
      setFiles(result.files);
      setPagination(result.pagination);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page, filterCategory]);

  const loadCategories = async () => {
    try { const r = await api.getCategories(); setCategories(r.categories.map((c) => c.category)); }
    catch (err) { console.error(err); }
  };

  useEffect(() => { loadFiles(); loadCategories(); }, [loadFiles]);

  const toggleSelect = (id) => { setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleSelectAll = () => { setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id))); };

  const handleDelete = async (id) => {
    if (!confirm('确认删除此文件？')) return;
    try { await api.deleteFile(id); setSelected((p) => { const n = new Set(p); n.delete(id); return n; }); await loadFiles(); }
    catch (err) { alert(`删除失败: ${err.message}`); }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`确认删除选中的 ${selected.size} 个文件？`)) return;
    try { await api.batchDelete(Array.from(selected)); setSelected(new Set()); await loadFiles(); }
    catch (err) { alert(`批量删除失败: ${err.message}`); }
  };

  const startEdit = (file, type) => { setEditingId(file.id); setEditType(type); setEditValue(type === 'name' ? file.file_name : (file.description || '')); };
  const saveEdit = async () => {
    try {
      if (editType === 'name') await api.renameFile(editingId, editValue);
      else await api.updateDescription(editingId, editValue);
      setEditingId(null); await loadFiles();
    } catch (err) { alert(`更新失败: ${err.message}`); }
  };

  const filteredFiles = searchQuery ? files.filter((f) => f.file_name.toLowerCase().includes(searchQuery.toLowerCase())) : files;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">文件管理</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {pagination.total ?? 0} 个文件
            {selected.size > 0 && <span className="ml-2" style={{ color: 'var(--primary)' }}>· 已选 {selected.size} 个</span>}
          </p>
        </div>
        <div className="flex gap-3">
          {selected.size > 0 && (
            <button onClick={handleBatchDelete} className="btn-danger"><Trash2 className="w-4 h-4 mr-2" />删除选中 ({selected.size})</button>
          )}
          <button className="btn-primary" onClick={() => setShowUpload(true)}><Upload className="w-4 h-4 mr-2" />上传文件</button>
        </div>
      </div>

      <div className="card !p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input type="text" className="input-field !pl-10" placeholder="搜索文件名..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <select className="input-field !pl-10 !w-44" value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}>
              <option value="">全部分类</option>
              {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-3.5 w-10">
                  <input type="checkbox" checked={selected.size === filteredFiles.length && filteredFiles.length > 0} onChange={toggleSelectAll} />
                </th>
                <th>文件名</th>
                <th>分类</th>
                <th className="text-right">大小</th>
                <th className="text-right">下载</th>
                <th>最后下载</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center" style={{ color: 'var(--text-muted)' }}>
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />加载中...
                </td></tr>
              ) : filteredFiles.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center" style={{ color: 'var(--text-muted)' }}>
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />暂无文件
                </td></tr>
              ) : (
                filteredFiles.map((file) => (
                  <tr key={file.id} style={selected.has(file.id) ? { background: 'var(--muted)' } : {}}>
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(file.id)} onChange={() => toggleSelect(file.id)} /></td>
                    <td className="px-4 py-3">
                      {editingId === file.id && editType === 'name' ? (
                        <div className="flex items-center gap-1.5">
                          <input className="input-field !py-1 !text-sm" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} autoFocus />
                          <button onClick={saveEdit} style={{ color: 'var(--primary)' }}><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2">
                            <FileIcon name={file.file_name} />
                            <span className="font-medium cursor-pointer" style={{ color: 'var(--text)' }} onDoubleClick={() => startEdit(file, 'name')} title="双击重命名">{file.file_name}</span>
                          </div>
                          {file.description ? (
                            <p className="text-xs mt-0.5 ml-6 truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>{file.description}</p>
                          ) : (
                            <button onClick={() => startEdit(file, 'description')} className="text-[11px] ml-6 mt-0.5" style={{ color: 'var(--text-muted)' }}>+ 添加描述</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className="badge-neutral">{file.category}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatSize(file.file_size)}</td>
                    <td className="px-4 py-3 text-right"><span className="font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{file.download_count}</span></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(file.last_download_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => startEdit(file, 'description')} className="btn-ghost !p-1.5" title="编辑描述"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(file.id)} className="btn-ghost !p-1.5" style={{ color: 'var(--error)' }} title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid var(--border-light)', background: 'var(--muted)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>共 {pagination.total} 个文件 · 第 {pagination.page}/{pagination.totalPages} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost !p-1.5 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="btn-ghost !p-1.5 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {showUpload && <UploadModal categories={categories} onClose={() => setShowUpload(false)} onUploaded={loadFiles} />}
    </div>
  );
}

export default FileManager;
