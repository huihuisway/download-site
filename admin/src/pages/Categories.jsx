import { useState, useEffect } from 'react';
import { FolderTree, Plus, Trash2, Edit3, RefreshCw, ChevronRight, ChevronDown, Check, X } from 'lucide-react';
import api from '../api/client';

function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [renamingPath, setRenamingPath] = useState(null);
  const [newRenameValue, setNewRenameValue] = useState('');

  const loadCategories = async () => {
    setLoading(true);
    try {
      const result = await api.getCategories();
      setCategories(result.categories);

      // Auto-expand first-level folders
      const topLevel = new Set();
      result.categories.forEach(cat => {
        const parts = cat.category.split('/');
        if (parts.length > 0) {
          topLevel.add(parts[0]);
        }
      });
      setExpandedPaths(topLevel);
    }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadCategories(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createFolder(newName.trim());
      setNewName('');
      await loadCategories();
    }
    catch (err) { alert(`创建失败: ${err.message}`); }
    finally { setCreating(false); }
  };

  const handleRename = async (folderPath) => {
    if (!newRenameValue.trim()) return;
    try {
      await api.renameFolder(folderPath, newRenameValue.trim());
      setRenamingPath(null);
      setNewRenameValue('');
      await loadCategories();
    }
    catch (err) { alert(`重命名失败: ${err.message}`); }
  };

  const handleDelete = async (folderPath, recursive = false) => {
    if (recursive) {
      if (!confirm(`确认递归删除目录 "${folderPath}" 及其全部子目录和文件？此操作不可恢复！`)) return;
    } else {
      if (!confirm(`确认删除空目录 "${folderPath}"？`)) return;
    }
    try {
      await api.deleteFolder(folderPath, recursive);
      await loadCategories();
    }
    catch (err) { alert(`删除失败: ${err.message}`); }
  };

  const toggleExpand = (path) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const getFoldersByParent = (parentPath) => {
    return categories.filter(cat => {
      const parts = cat.category.split('/');
      const parentParts = parentPath ? parentPath.split('/') : [];

      if (parentPath === '') {
        // Top level folders
        return parts.length === 1;
      } else {
        // Direct children of parentPath
        return parts.length === parentParts.length + 1 &&
               parts.slice(0, -1).join('/') === parentPath;
      }
    });
  };

  const FolderNode = ({ category, depth = 0 }) => {
    const hasChildren = categories.some(c => c.category.startsWith(category.category + '/'));
    const isExpanded = expandedPaths.has(category.category);
    const isEmpty = category.file_count === 0 && !hasChildren;

    return (
      <div style={{ marginLeft: `min(${depth * 1.5}rem, 1rem)` }}>
        <div className="card !p-4 mb-2 group" style={{ borderLeft: '3px solid var(--primary)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1">
              {hasChildren && (
                <button onClick={() => toggleExpand(category.category)} className="btn-ghost !p-1">
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              )}
              {!hasChildren && <div className="w-6" />}

              {renamingPath === category.category ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    className="input-field !py-1 !text-sm flex-1"
                    value={newRenameValue}
                    onChange={(e) => setNewRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(category.category);
                      if (e.key === 'Escape') setRenamingPath(null);
                    }}
                    autoFocus
                  />
                  <button onClick={() => handleRename(category.category)} className="btn-ghost !p-1.5" style={{ color: 'var(--primary)' }}>
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setRenamingPath(null)} className="btn-ghost !p-1.5">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <FolderTree className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  <span className="font-semibold min-w-0 break-words" style={{ color: 'var(--text)' }}>{category.category.split('/').pop()}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {isEmpty ? '空' : `${category.file_count} 个文件`}
                  </span>
                </>
              )}
            </div>

            {renamingPath !== category.category && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    setRenamingPath(category.category);
                    setNewRenameValue(category.category.split('/').pop());
                  }}
                  className="btn-ghost !p-1.5"
                  title="重命名"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {isEmpty ? (
                  <button
                    onClick={() => handleDelete(category.category, false)}
                    className="btn-ghost !p-1.5"
                    style={{ color: 'var(--error)' }}
                    title="删除空目录"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleDelete(category.category, true)}
                    className="btn-ghost !p-1.5"
                    style={{ color: 'var(--error)' }}
                    title="递归删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {isExpanded && hasChildren && (
            <div className="mt-3">
              {getFoldersByParent(category.category).map(child => (
                <FolderNode key={child.category} category={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const topLevelFolders = getFoldersByParent('');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">目录管理</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>管理文件目录结构</p>
      </div>

      <div className="card !p-5">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>创建新目录</h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            className="input-field flex-1"
            placeholder="输入目录路径（如: docs/guides/v1）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
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
          <p style={{ color: 'var(--text-muted)' }}>暂无目录</p>
        </div>
      ) : (
        <div>
          {topLevelFolders.map(cat => (
            <FolderNode key={cat.category} category={cat} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Categories;
