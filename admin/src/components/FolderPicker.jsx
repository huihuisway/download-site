import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, FolderTree, Check } from 'lucide-react';

function FolderPicker({ categories, value, onChange, placeholder = '选择目录' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const containerRef = useRef(null);

  // 构建目录树
  const buildTree = () => {
    const tree = {};
    categories.forEach(cat => {
      const parts = cat.category.split('/');
      let current = tree;

      parts.forEach((part, i) => {
        if (!current[part]) {
          current[part] = { __path: parts.slice(0, i + 1).join('/'), __children: {} };
        }
        if (i < parts.length - 1) {
          current = current[part].__children;
        }
      });
    });

    return tree;
  };

  const tree = buildTree();

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleExpand = (path, event) => {
    event.stopPropagation();
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const selectFolder = (path) => {
    onChange(path);
    setIsOpen(false);
  };

  const renderTree = (nodes, depth = 0) => {
    return Object.entries(nodes)
      .filter(([key]) => !key.startsWith('__'))
      .map(([name, node]) => {
        const path = node.__path;
        const hasChildren = Object.keys(node.__children).length > 0;
        const isExpanded = expandedPaths.has(path);
        const isSelected = value === path;

        return (
          <div key={path}>
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              style={{ paddingLeft: `${depth * 16 + 12}px` }}
              onClick={() => selectFolder(path)}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => toggleExpand(path, e)}
                  className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <div className="w-4.5" />
              )}

              <FolderTree className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="flex-1 text-sm" style={{ color: isSelected ? 'var(--primary)' : 'var(--text)' }}>
                {name}
              </span>

              {isSelected && (
                <Check className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              )}
            </div>

            {hasChildren && isExpanded && renderTree(node.__children, depth + 1)}
          </div>
        );
      });
  };

  const displayValue = value === '' ? placeholder : value;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="input-field w-full text-left flex items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={value === '' ? 'text-gray-400' : ''}>{displayValue}</span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {isOpen && (
        <div
          className="absolute z-50 w-full mt-1 border rounded-md shadow-lg overflow-auto max-h-64"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          {/* 根目录选项 */}
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-b"
            onClick={() => selectFolder('')}
          >
            <FolderTree className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            <span className="flex-1 text-sm" style={{ color: value === '' ? 'var(--primary)' : 'var(--text)' }}>
              根目录
            </span>
            {value === '' && <Check className="w-4 h-4" style={{ color: 'var(--primary)' }} />}
          </div>

          {/* 目录树 */}
          <div className="py-1">
            {renderTree(tree)}
          </div>
        </div>
      )}
    </div>
  );
}

export default FolderPicker;
