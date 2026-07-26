const fs = require('fs');
const path = require('path');
const { encodePublicFilePath } = require('../utils/public-paths');

// 目录页链接：按段编码，使含空格/# 等字符的目录名生成合法 href
const buildCategoryHref = (folderPath) =>
  folderPath === 'root' ? '/' : '/category/' + encodePublicFilePath(folderPath);

const normalizeFolderPath = (input) => {
  const raw = typeof input === 'string' ? input : '';
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  // 拒绝路径穿越段（"路径越界"前缀由 errorHandler 映射为 403）
  if (normalized.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error('路径越界: 非法目录路径');
  }
  return normalized || 'root';
};

const getParentFolderPath = (filePath) => {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return 'root';
  return parts.slice(0, -1).join('/');
};

const listPhysicalFolders = (downloadDir) => {
  const result = [];
  if (!fs.existsSync(downloadDir)) return result;

  const walk = (dir, prefix = '') => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      result.push(folderPath);
      walk(path.join(dir, entry.name), folderPath);
    }
  };

  walk(downloadDir);
  return result.sort();
};

const listFolderEntries = ({ currentPath, files, physicalFolders }) => {
  const current = normalizeFolderPath(currentPath);
  const isRoot = current === 'root';

  const ancestors = [];
  if (!isRoot) {
    const parts = current.split('/');
    parts.forEach((part, i) => {
      ancestors.push({ name: part, path: parts.slice(0, i + 1).join('/') });
    });
  }

  const parentPath = isRoot ? null : getParentFolderPath(current);

  const breadcrumbs = [];
  if (!isRoot) {
    breadcrumbs.push({ name: '首页', path: 'root' });
    const parts = current.split('/');
    parts.forEach((part, i) => {
      const crumbPath = parts.slice(0, i + 1).join('/');
      breadcrumbs.push({ name: part, path: crumbPath });
    });
  }

  const directories = [];
  const filesHere = [];

  const directChildFolders = new Set();
  for (const folder of physicalFolders || []) {
    const normalized = normalizeFolderPath(folder);
    if (isRoot) {
      if (!normalized.includes('/')) directChildFolders.add(normalized);
    } else {
      if (normalized.startsWith(current + '/') && !normalized.slice(current.length + 1).includes('/')) {
        directChildFolders.add(normalized);
      }
    }
  }

  for (const folder of directChildFolders) {
    const name = folder.split('/').pop();
    const hasFiles = files.some(f => {
      const fileParent = getParentFolderPath(f.file_path);
      return fileParent === folder;
    });
    const hasSubfolders = physicalFolders.some(p => {
      const normalized = normalizeFolderPath(p);
      return normalized.startsWith(folder + '/');
    });
    directories.push({ path: folder, name, isEmpty: !hasFiles && !hasSubfolders });
  }

  for (const file of files || []) {
    const fileParent = getParentFolderPath(file.file_path);
    if (fileParent === current) filesHere.push(file);
  }

  const treeRows = buildTreeRows(current, physicalFolders, files);

  return {
    currentPath: current,
    isRoot,
    rootHref: '/',
    parentPath,
    parentHref: parentPath ? buildCategoryHref(parentPath) : null,
    ancestors,
    breadcrumbs,
    directories: directories.sort((a, b) => a.path.localeCompare(b.path)),
    files: filesHere.sort((a, b) => a.file_name.localeCompare(b.file_name)),
    isEmpty: directories.length === 0 && filesHere.length === 0,
    treeRows,
  };
};

const buildTreeRows = (rootPath, physicalFolders, files) => {
  const current = normalizeFolderPath(rootPath);
  const isRoot = current === 'root';

  const allChildPaths = (physicalFolders || []).map(p => normalizeFolderPath(p));

  const hasSubfoldersOf = (targetPath) =>
    allChildPaths.some(p => p.startsWith(targetPath + '/'));

  const hasFilesInPath = (targetPath) =>
    files.some(f => getParentFolderPath(f.file_path) === targetPath);

  const collect = (basePath, depth) => {
    const directChildren = allChildPaths
      .filter(p => {
        if (depth === 0 && isRoot) return !p.includes('/');
        if (depth === 0 && !isRoot) return p.startsWith(current + '/') && !p.slice(current.length + 1).includes('/');
        return p.startsWith(basePath + '/') && !p.slice(basePath.length + 1).includes('/');
      })
      .sort();

    const rows = [];
    for (const child of directChildren) {
      const name = child.split('/').pop();
      const hasChildren = hasSubfoldersOf(child);
      const hasFiles = hasFilesInPath(child);
      const isEmpty = !hasChildren && !hasFiles;
      rows.push({
        name,
        path: child,
        href: buildCategoryHref(child),
        depth,
        hasChildren,
        isEmpty,
      });
      if (hasChildren) {
        rows.push(...collect(child, depth + 1));
      }
    }
    return rows;
  };

  return collect(current, 0);
};

module.exports = {
  normalizeFolderPath,
  getParentFolderPath,
  listFolderEntries,
  listPhysicalFolders,
  buildTreeRows,
  buildCategoryHref,
};