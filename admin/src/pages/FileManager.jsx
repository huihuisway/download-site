import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Trash2,
  Search,
  X,
  Edit3,
  Check,
  FileText,
  Filter,
  MoreHorizontal,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Archive,
  Disc3,
  File,
  FileImage,
  FileSpreadsheet,
  FileCode,
  FileType,
} from 'lucide-react';
import api from '../api/client';
import { ShineButton } from '../components/ui/shine-button';
import { AnimatedCard } from '../components/ui/animated-card';
import { GradientText } from '../components/ui/gradient-text';

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN');
}

function FileIcon({ name, className = 'w-4 h-4 text-gray-400' }) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap = {
    zip: Archive, gz: Archive, tar: Archive, '7z': Archive,
    iso: Disc3,
    pdf: FileText,
    txt: FileType, md: FileType,
    png: FileImage, jpg: FileImage, jpeg: FileImage,
    doc: FileText, docx: FileText,
    xlsx: FileSpreadsheet,
    js: FileCode, ts: FileCode, jsx: FileCode, tsx: FileCode,
  };
  const Icon = iconMap[ext] || File;
  return <Icon className={className} />;
}

/* Upload Modal */
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
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-lg">上传文件</h3>
          <button onClick={onClose} className="btn-ghost !p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Category Select */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">目标分类</label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setUseNewCategory(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!useNewCategory ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                已有分类
              </button>
              <button
                onClick={() => setUseNewCategory(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${useNewCategory ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                新建分类
              </button>
            </div>
            {useNewCategory ? (
              <input
                type="text"
                className="input-field"
                placeholder="输入新分类名（如: software）"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                autoFocus
              />
            ) : (
              <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            )}
          </div>

          {/* Drop Zone */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">选择文件</label>
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
                dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className={`w-8 h-8 mx-auto mb-2 ${dragging ? 'text-primary-500' : 'text-gray-300'}`} />
              <p className="text-sm text-gray-500">拖拽文件到此处，或 <label className="text-primary-600 font-medium cursor-pointer hover:underline">浏览文件<input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files))} /></label></p>
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs">
                    <FileIcon name={f.name} className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="flex-1 truncate text-gray-700">{f.name}</span>
                    <span className="text-gray-400">{formatSize(f.size)}</span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <ShineButton onClick={handleUpload} disabled={uploading || files.length === 0}>
            {uploading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />上传中...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />上传 {files.length > 0 ? `(${files.length})` : ''}</>
            )}
          </ShineButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* Main Component */
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
    } catch (err) {
      console.error('加载文件失败:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filterCategory]);

  const loadCategories = async () => {
    try {
      const result = await api.getCategories();
      setCategories(result.categories.map((c) => c.category));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadFiles(); loadCategories(); }, [loadFiles]);

  const toggleSelect = (id) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id)));
  };

  const handleDelete = async (id) => {
    if (!confirm('确认删除此文件？')) return;
    try { await api.deleteFile(id); setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; }); await loadFiles(); }
    catch (err) { alert(`删除失败: ${err.message}`); }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`确认删除选中的 ${selected.size} 个文件？`)) return;
    try { await api.batchDelete(Array.from(selected)); setSelected(new Set()); await loadFiles(); }
    catch (err) { alert(`批量删除失败: ${err.message}`); }
  };

  const startEdit = (file, type) => {
    setEditingId(file.id);
    setEditType(type);
    setEditValue(type === 'name' ? file.file_name : (file.description || ''));
  };

  const saveEdit = async () => {
    try {
      if (editType === 'name') await api.renameFile(editingId, editValue);
      else await api.updateDescription(editingId, editValue);
      setEditingId(null);
      await loadFiles();
    } catch (err) { alert(`更新失败: ${err.message}`); }
  };

  const filteredFiles = searchQuery
    ? files.filter((f) => f.file_name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold"><GradientText>文件管理</GradientText></h2>
          <p className="text-sm text-gray-400 mt-1">
            {pagination.total ?? 0} 个文件
            {selected.size > 0 && <span className="text-primary-600 ml-2">· 已选 {selected.size} 个</span>}
          </p>
        </div>
        <div className="flex gap-3">
          {selected.size > 0 && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={handleBatchDelete}
              className="btn-danger"
            >
              <Trash2 className="w-4 h-4 mr-2" />删除选中 ({selected.size})
            </motion.button>
          )}
          <ShineButton onClick={() => setShowUpload(true)}>
            <Upload className="w-4 h-4 mr-2" />上传文件
          </ShineButton>
        </div>
      </div>

      {/* Filters */}
      <AnimatedCard delay={0.1} className="!p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
            <input
              type="text"
              className="input-field !pl-10"
              placeholder="搜索文件名..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
            <select
              className="input-field !pl-10 !w-44"
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
            >
              <option value="">全部分类</option>
              {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>
      </AnimatedCard>

      {/* File Table */}
      <AnimatedCard delay={0.2} className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-3.5 w-10">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    checked={selected.size === filteredFiles.length && filteredFiles.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3.5">文件名</th>
                <th className="px-4 py-3.5">分类</th>
                <th className="px-4 py-3.5 text-right">大小</th>
                <th className="px-4 py-3.5 text-right">下载</th>
                <th className="px-4 py-3.5">最后下载</th>
                <th className="px-4 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-300">
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />加载中...
                </td></tr>
              ) : filteredFiles.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-300">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />暂无文件
                </td></tr>
              ) : (
                filteredFiles.map((file, idx) => (
                  <motion.tr
                    key={file.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.02 }}
                    className={`hover:bg-gray-50/50 transition-colors ${selected.has(file.id) ? 'bg-primary-50/30' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        checked={selected.has(file.id)}
                        onChange={() => toggleSelect(file.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {editingId === file.id && editType === 'name' ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            className="input-field !py-1 !text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                            autoFocus
                          />
                          <button onClick={saveEdit} className="text-primary-600 hover:text-primary-700"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="text-gray-300 hover:text-gray-500"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2">
                            <FileIcon name={file.file_name} className="w-4.5 h-4.5 text-gray-500 shrink-0" />
                            <span
                              className="font-medium text-gray-900 cursor-pointer hover:text-primary-600 transition-colors"
                              onDoubleClick={() => startEdit(file, 'name')}
                              title="双击重命名"
                            >
                              {file.file_name}
                            </span>
                          </div>
                          {file.description ? (
                            <p className="text-xs text-gray-400 mt-0.5 ml-7 truncate max-w-xs">{file.description}</p>
                          ) : (
                            <button
                              onClick={() => startEdit(file, 'description')}
                              className="text-[11px] text-gray-300 hover:text-primary-500 ml-7 mt-0.5 transition-colors"
                            >
                              + 添加描述
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge-gray">{file.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{formatSize(file.file_size)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums">{file.download_count}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(file.last_download_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => startEdit(file, 'description')} className="btn-ghost !p-1.5" title="编辑描述">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(file.id)} className="btn-ghost !p-1.5 !text-red-400 hover:!text-red-600 hover:!bg-red-50" title="删除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
            <span className="text-xs text-gray-400">
              共 {pagination.total} 个文件 · 第 {pagination.page}/{pagination.totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-ghost !p-1.5 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="btn-ghost !p-1.5 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </AnimatedCard>

      <AnimatePresence>
        {showUpload && (
          <UploadModal
            categories={categories}
            onClose={() => setShowUpload(false)}
            onUploaded={loadFiles}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default FileManager;
