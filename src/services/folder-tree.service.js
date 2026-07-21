const fs = require('fs');
const path = require('path');

const normalizeFolderPath = (input) => {
  const raw = typeof input === 'string' ? input : '';
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
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

  const breadcrumbs = [];
  if (current !== 'root') {
    breadcrumbs.push({ name: '首页', path: 'root' });
    const parts = current.split('/');
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      breadcrumbs.push({ name: part, path });
    });
  }

  const parentPath = current === 'root' ? null : getParentFolderPath(current + '/dummy');

  const directories = [];
  const filesHere = [];

  const directChildFolders = new Set();
  for (const folder of physicalFolders || []) {
    const normalized = normalizeFolderPath(folder);
    if (current === 'root') {
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

  return {
    currentPath: current,
    parentPath,
    breadcrumbs,
    directories: directories.sort((a, b) => a.path.localeCompare(b.path)),
    files: filesHere.sort((a, b) => a.file_name.localeCompare(b.file_name)),
    isEmpty: directories.length === 0 && filesHere.length === 0,
  };
};

module.exports = {
  normalizeFolderPath,
  getParentFolderPath,
  listFolderEntries,
  listPhysicalFolders,
};