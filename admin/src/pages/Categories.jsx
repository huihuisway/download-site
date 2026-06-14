import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FolderTree,
  Plus,
  Trash2,
  Files,
  Download,
  HardDrive,
  RefreshCw,
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

const categoryColors = [
  'from-blue-500 to-blue-600',
  'from-emerald-500 to-emerald-600',
  'from-violet-500 to-violet-600',
  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',
  'from-cyan-500 to-teal-500',
];

function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadCategories = async () => {
    setLoading(true);
    try {
      const result = await api.getCategories();
      setCategories(result.categories);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCategories(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createCategory(newName.trim());
      setNewName('');
      await loadCategories();
    } catch (err) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name) => {
    if (!confirm(`确认删除分类 "${name}"？仅在分类为空时成功。`)) return;
    try { await api.deleteCategory(name); await loadCategories(); }
    catch (err) { alert(`删除失败: ${err.message}`); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold"><GradientText>目录管理</GradientText></h2>
        <p className="text-sm text-gray-400 mt-1">管理文件分类目录</p>
      </div>

      {/* Create */}
      <AnimatedCard delay={0.1} className="!p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">创建新分类</h3>
        <div className="flex gap-3">
          <input
            type="text"
            className="input-field flex-1"
            placeholder="输入分类名称（如: software, documents）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <ShineButton onClick={handleCreate} disabled={creating || !newName.trim()}>
            <Plus className="w-4 h-4 mr-1.5" />
            {creating ? '创建中...' : '创建'}
          </ShineButton>
        </div>
      </AnimatedCard>

      {/* Category Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-300">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      ) : categories.length === 0 ? (
        <AnimatedCard className="text-center py-16">
          <FolderTree className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <p className="text-gray-400">暂无分类</p>
        </AnimatedCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat, i) => {
            const colorClass = categoryColors[i % categoryColors.length];
            const isEmpty = cat.file_count === 0;

            return (
              <motion.div
                key={cat.category}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="group relative rounded-2xl border border-gray-200/80 bg-white hover:border-primary-200 hover:shadow-lg transition-all duration-300 overflow-hidden"
              >
                {/* Top gradient bar */}
                <div className={`h-1 bg-gradient-to-r ${colorClass}`} />

                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorClass} flex items-center justify-center shadow-lg`}>
                        <FolderTree className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">{cat.category}</h4>
                        <p className="text-xs text-gray-400">{isEmpty ? '空分类' : `${cat.file_count} 个文件`}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(cat.category)}
                      disabled={!isEmpty}
                      className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 disabled:opacity-0 transition-all"
                      title={isEmpty ? '删除' : '请先清空文件'}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <Files className="w-3.5 h-3.5 mx-auto mb-1 text-gray-400" />
                      <p className="text-sm font-bold text-gray-900 tabular-nums">{cat.file_count}</p>
                      <p className="text-[10px] text-gray-400">文件</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <Download className="w-3.5 h-3.5 mx-auto mb-1 text-gray-400" />
                      <p className="text-sm font-bold text-gray-900 tabular-nums">{cat.total_downloads}</p>
                      <p className="text-[10px] text-gray-400">下载</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <HardDrive className="w-3.5 h-3.5 mx-auto mb-1 text-gray-400" />
                      <p className="text-sm font-bold text-gray-900 truncate">{formatSize(cat.total_size)}</p>
                      <p className="text-[10px] text-gray-400">大小</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Categories;
