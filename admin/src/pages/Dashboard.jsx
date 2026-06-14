import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Files,
  Download,
  HardDrive,
  FolderTree,
  RefreshCw,
  TrendingUp,
  ArrowUpRight,
} from 'lucide-react';
import api from '../api/client';
import { NumberTicker } from '../components/ui/number-ticker';
import { BentoGrid, BentoCard } from '../components/ui/bento-grid';
import { AnimatedCard } from '../components/ui/animated-card';
import { GradientText } from '../components/ui/gradient-text';
import { ShineButton } from '../components/ui/shine-button';

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function StatCard({ icon: Icon, label, value, sub, gradient, delay }) {
  return (
    <BentoCard icon={null} delay={delay}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold mt-2 text-gray-900 tabular-nums">
            <NumberTicker value={typeof value === 'number' ? value : 0} />
          </p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${gradient}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </BentoCard>
  );
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await api.getStats();
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.sync();
      alert(`同步完成: 新增 ${result.inserted}, 更新 ${result.updated}, 删除 ${result.deleted}`);
      await loadData();
    } catch (err) {
      alert(`同步失败: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  const { dashboard, topFiles, categoryStats } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            <GradientText>数据概览</GradientText>
          </h2>
          <p className="text-sm text-gray-400 mt-1">文件下载站运行状态一览</p>
        </div>
        <ShineButton onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同步中...' : '同步目录'}
        </ShineButton>
      </div>

      {/* Stats Grid */}
      <BentoGrid>
        <StatCard
          icon={Files}
          label="总文件"
          value={dashboard.totalFiles}
          gradient="bg-gradient-to-br from-blue-500 to-blue-600"
          delay={0}
        />
        <StatCard
          icon={Download}
          label="总下载"
          value={dashboard.totalDownloads}
          gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
          delay={0.05}
        />
        <StatCard
          icon={HardDrive}
          label="总大小"
          value={dashboard.totalFiles}
          sub={formatSize(dashboard.totalSize)}
          gradient="bg-gradient-to-br from-violet-500 to-violet-600"
          delay={0.1}
        />
        <StatCard
          icon={FolderTree}
          label="分类数"
          value={dashboard.totalCategories}
          gradient="bg-gradient-to-br from-amber-500 to-orange-500"
          delay={0.15}
        />
      </BentoGrid>

      {/* Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Top 10 */}
        <AnimatedCard className="lg:col-span-3" delay={0.2}>
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-primary-500" />
            <h3 className="font-semibold text-gray-900">热门下载 Top 10</h3>
          </div>
          {topFiles.length === 0 ? (
            <div className="text-center py-10 text-gray-300">
              <Download className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">暂无下载记录</p>
            </div>
          ) : (
            <div className="space-y-1">
              {topFiles.map((file, i) => (
                <motion.div
                  key={file.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.04 }}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    i < 3 ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.file_name}</p>
                    <p className="text-[11px] text-gray-400">{file.category} · {formatSize(file.file_size)}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {file.download_count}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-500 transition-colors" />
                </motion.div>
              ))}
            </div>
          )}
        </AnimatedCard>

        {/* Category Stats */}
        <AnimatedCard className="lg:col-span-2" delay={0.3}>
          <div className="flex items-center gap-2 mb-5">
            <FolderTree className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-gray-900">分类统计</h3>
          </div>
          {categoryStats.length === 0 ? (
            <div className="text-center py-10 text-gray-300">
              <FolderTree className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">暂无分类</p>
            </div>
          ) : (
            <div className="space-y-3">
              {categoryStats.map((cat, i) => (
                <motion.div
                  key={cat.category}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.05 }}
                  className="rounded-xl border border-gray-100 p-3.5 hover:border-primary-200 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">{cat.category}</span>
                    <span className="badge-gray">{cat.file_count} 文件</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>{cat.total_downloads} 次下载</span>
                    <span>{formatSize(cat.total_size)}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (cat.total_downloads / Math.max(1, dashboard.totalDownloads)) * 100)}%` }}
                      transition={{ duration: 0.8, delay: 0.5 + i * 0.1 }}
                      className="h-full rounded-full bg-gradient-to-r from-primary-400 to-blue-500"
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatedCard>
      </div>
    </div>
  );
}

export default Dashboard;
