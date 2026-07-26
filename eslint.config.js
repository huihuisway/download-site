const js = require('@eslint/js');
const globals = require('globals');
const reactPlugin = require('eslint-plugin-react');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'admin/node_modules/**',
      'admin/dist/**',
      'public/admin/**',
      '.claude/**',   // 本地工具目录（含 git worktree 里的整份仓库副本）
      'data/**',
      'downloads/**',
      'downloads-*-test/**',
      'logs/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,

  // 后端与测试：CommonJS + Node 全局
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'ecosystem.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // 下划线前缀参数为“有意未使用”（如 Express 错误中间件的 next）
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 代码库中大量使用 try {} catch {} 作为“忽略失败”的显式写法
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // 管理后台 SPA：ESM + JSX + 浏览器全局
  {
    files: ['admin/src/**/*.{js,jsx}'],
    plugins: { react: reactPlugin },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // jsx-uses-vars 让 no-unused-vars 能识别 JSX 中的组件引用，
      // 避免把 <Icon /> 这类用法误判为未使用（比笼统豁免大写标识符更精确）
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // 前台静态脚本：浏览器环境
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },

  // Vite / Tailwind 等构建配置文件运行在 Node 下
  {
    files: ['admin/*.config.js', 'admin/*.config.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
