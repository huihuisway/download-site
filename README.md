# 轻量级极简下载站

Debian 镜像站风格的纯粹文件下载服务。

## 特性

- **极简前台**：Debian 镜像站风格，零 JS 依赖，纯 EJS 服务端渲染
- **现代后台**：React + Tailwind CSS，统计看板 + 文件管理 + 批量操作
- **自动同步**：物理目录 ↔ 数据库双向同步，SHA256 校验值自动计算
- **OAuth 2.0**：与现有论坛系统无缝对接，state 参数防 CSRF
- **安全沙箱**：路径遍历防御、扩展名白名单、文件名清洗

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 OAuth 配置

# 3. 创建运行时目录
mkdir -p downloads data

# 4. 构建后台前端
npm run build:admin

# 5. 启动服务
npm run dev      # 开发模式
npm start        # 生产模式
```

## 项目结构

```
download-site/
├── src/                  # 后端源码
│   ├── app.js            # Express 入口
│   ├── config/           # 配置
│   ├── db/               # 数据库（JSON 文件存储）
│   ├── middleware/        # 中间件
│   ├── routes/           # 路由（前台 / 后台 / OAuth）
│   ├── services/         # 业务逻辑（文件/同步/统计/校验）
│   ├── views/            # EJS 模板
│   └── utils/            # 工具函数
├── admin/                # React 后台源码
├── public/               # 静态资源 + 后台构建产物
├── downloads/            # 文件存储沙箱
├── data/                 # 运行时数据
└── tests/                # 测试
```

## 目录分类

文件按物理子目录组织，分类从路径自动推断：

```
downloads/
├── documents/     # 文档分类
├── software/      # 软件分类
└── images/        # 图片分类
```

## API 接口

### 前台（公开）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 首页 |
| GET | `/category/:name` | 分类页 |
| GET | `/download/:id` | 下载文件 |

### 后台（需 OAuth 登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/stats` | 统计看板 |
| GET | `/api/admin/files` | 文件列表 |
| POST | `/api/admin/files/upload` | 上传文件 |
| DELETE | `/api/admin/files/:id` | 删除文件 |
| POST | `/api/admin/files/batch-delete` | 批量删除 |
| POST | `/api/admin/sync` | 手动同步 |

## 测试

```bash
npm test
```

## 生产部署

```bash
# 使用 PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 技术栈

- **后端**：Node.js + Express
- **前台**：EJS（服务端渲染）
- **后台**：React 18 + Tailwind CSS + Vite
- **数据库**：JSON 文件存储（可替换为 SQLite）
- **Session**：文件存储（session-file-store）
- **上传**：multer
- **安全**：sanitize-filename + helmet

## License

MIT
