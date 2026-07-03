中文 | [English](./README_EN.md)

# AI Video Studio

基于 React + TypeScript 的 AI 短视频创作平台。输入故事文本，AI 自动完成角色提取、场景拆分、图片/视频/配音/BGM 生成，最终通过 FFmpeg 后期合成完整短视频。采用六边形架构（Ports & Adapters），通过 PlatformRouter 统一路由 8 个 AI 平台，支持本地优先（Local-First）的纯前端运行模式。

## 核心功能

- **多平台 AI 路由** — 通过 PlatformRouter 统一调度 8 个平台适配器：MiniMax / Volcengine（火山） / Coze / Kling（可灵） / Wan（万相） / Hunyuan（混元） / Zhipu（智谱） / Vidu
- **故事创作** — 输入故事文本，AI 自动拆分为分镜、提取角色和场景
- **图片生成** — 角色立绘、场景背景、创意图片
- **视频生成** — 支持 T2V / I2V / FL2V / S2V 多种视频生成模式
- **语音合成** — 语音克隆、语音设计、流式合成
- **音乐生成** — AI 生成背景音乐、歌词创作、翻唱
- **文本润色** — AI 文本增强、改写、实验室模式
- **后期处理** — FFmpeg WASM 实现视频拼接、字幕烧录、音频混合
- **一键成片** — Pipeline 9 阶段全流程编排，从故事到成片自动完成
- **时间线剪辑** — 4 轨（视频/旁白/BGM/字幕）可视化编辑
- **AI 助手** — Agent 对话式创作辅助、自动剪辑、运镜建议
- **多语言** — 支持中/英/日/韩/法/德/西/俄/葡/意 10 种语言

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | Vite 8 |
| 路由 | React Router DOM 7 |
| 数据库 | Dexie (IndexedDB ORM, v12, 15 张表) |
| 文件存储 | FilesLocal（配置目录）→ OPFS fallback，IndexedDB 仅存元数据 |
| 视频处理 | FFmpeg WASM (@ffmpeg/ffmpeg 0.12.6) |
| 语音识别 | Whisper WASM |
| HTTP | Axios |
| 国际化 | i18next 26 + react-i18next |
| 图标 | Lucide React |
| 加密 | AES-GCM 256 + PBKDF2 (100k 迭代) |
| AI 服务 | 8 平台：MiniMax / Volcengine / Coze / Kling / Wan / Hunyuan / Zhipu / Vidu |

## 架构

本项目采用**六边形架构 (Ports & Adapters)**，业务逻辑与外部依赖彻底解耦：

```
UI Layer (React)                       ← 17 页面、47 组件、17 Hooks、5 Contexts
       │
Dependency Injection (dependencies.ts) ← 依赖注入容器，组装所有依赖
       │
Domain Services (25 个)                ← 核心业务逻辑 + PlatformRouter 多平台路由
       │
Domain Ports (15 个端口文件)            ← 出站端口契约（IVideoPort/IVoicePort/...）
       │
Domain Entities (models.ts)            ← 数据模型定义
       │
Adapters (8 平台 + 基础设施)            ← MiniMax/Volcengine/Coze/Kling/Wan/Hunyuan/Zhipu/Vidu
                                         + FFmpeg/Whisper/IndexedDB/OPFS
```

**横切关注点端口化**：Logger（CompositeLogger + RingBuffer 日志面板）/ EventBus / Metrics / Resilience / Notification / Confirm / Theme / i18n / Network。

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装与运行

```bash
# 安装依赖
npm install

# 开发模式（http://localhost:5173/ai-video-studio/）
npm run dev

# 生产构建
npm run build

# 预览构建结果
npm run preview

# 代码检查
npm run lint

# 类型检查
npm run typecheck

# 单元测试
npm run test
```

### 配置

应用通过 `.env` 配置本地文件存储插件（参考 `.env.example`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FILES_DIR` | `docs/files` | 本地文件保存根目录（相对项目根或绝对路径） |
| `FILES_MAX_SIZE_MB` | `50` | 单次上传最大字节数（MB），超出返回 HTTP 413 |

修改后需重启 Vite dev server。

### API 配置

1. 启动后访问 `http://localhost:5173/ai-video-studio/`
2. 进入 **设置** 页面配置各平台的 API Key（支持 8 平台独立配置，AES-GCM 加密存储）
3. 可选：导入/导出配置备份

### 注意事项
合并到 github 前需执行以下命令
```bash
npm run lint
npm run typecheck
npm run test
```

## 项目结构

```
src/
├── adapters/outbound/           # 适配器层 — 外部系统实现
│   ├── api/                     #   8 平台 API 适配器（MiniMax/Volcengine/Coze/Kling/Wan/Hunyuan/Zhipu/Vidu）
│   │   ├── MiniMax*             #   MiniMax 系列（Video/Image/Voice/Music/Text/Story/File/Model）
│   │   ├── Volcengine*          #   火山系列（含 TC3-HMAC-SHA256 鉴权）
│   │   ├── Coze*/Kling*/Wan*    #   其他平台适配器
│   │   ├── Hunyuan*/Zhipu*/Vidu*
│   │   ├── FFmpegAdapter        #   FFmpeg WASM 视频处理
│   │   └── WhisperAdapter       #   Whisper 语音识别
│   ├── enhance/                 #   去水印、清晰度提升
│   ├── inpaint/                 #   图片 inpaint
│   ├── storage/                 #   文件存储（FilesLocal/OPFS 双层架构 + 迁移）
│   ├── infrastructure/          #   横切关注点（Logger/EventBus/Metrics/Resilience）
│   ├── repositories/            #   IndexedDB 仓储适配器（Dexie, v12, 15 张表）
│   ├── config/                  #   API 配置管理（ApiConfigStore, AES-GCM 加密）
│   ├── services/                #   UI 副作用 Port 适配器（Notifier/Confirmer/Theme/i18n/Network）
│   └── ui/                      #   UI Port 适配器
├── domain/                      # 领域层 — 核心业务逻辑
│   ├── entities/models.ts       #   数据模型（Story/Character/VideoTask/Pipeline...）
│   ├── ports/                   #   15 个端口接口（IVideoPort/IVoicePort/IImagePort/...）
│   ├── services/                #   25 个领域服务（含 PlatformRouter/PipelineService/TimelineService）
│   ├── constants/textLimits.ts  #   文本长度限制常量（TEXT_LIMITS / ADAPTER_TEXT_LIMITS）
│   ├── data/                    #   静态数据（系统音色列表）
│   └── errors/                  #   领域错误定义
├── ui/                          # UI 展示层
│   ├── pages/                   #   17 个页面
│   ├── components/              #   47 个通用组件
│   ├── hooks/                   #   17 个自定义 Hooks
│   ├── contexts/                #   5 个 Context（Space/Toast/Confirm/Theme/Network）
│   ├── layouts/                 #   MainLayout
│   └── utils/                   #   UI 工具函数（validateTextLimit 等）
├── utils/                       # 通用工具（离线缓存/重试/监控）
├── locales/                     # 国际化翻译文件（10 种语言）
├── App.tsx                      # 应用入口 & 路由定义（17 路由 + 代码分割 + 关键 chunk 预加载）
├── dependencies.ts              # 依赖注入容器
├── i18n.ts                      # 国际化配置
└── main.tsx                     # 渲染入口（启动序列：ApiConfigStore.init + initializeFileStorage 并行）
```

## 页面导航

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 仪表盘 | 项目概览 |
| `/characters` | 角色管理 | 创建/编辑角色、绑定音色 |
| `/backgrounds` | 场景管理 | 创建/编辑场景背景 |
| `/workbench` | 故事工作台 | 核心创作入口（故事拆分、分镜编辑） |
| `/export` | 导出中心 | 成片下载与预览 |
| `/editor` | 视频编辑器 | 时间线剪辑工作台（4 轨） |
| `/labs/image` | 图片实验室 | AI 图片生成 |
| `/labs/video` | 视频实验室 | AI 视频生成 |
| `/labs/voice` | 语音实验室 | 语音克隆/合成 |
| `/labs/music` | 音乐实验室 | AI 音乐/歌词生成 |
| `/labs/text` | 文本实验室 | AI 文本润色 |
| `/labs/enhance` | 增强实验室 | 去水印、清晰度提升 |
| `/agent` | AI 助手 | Agent 对话式创作辅助 |
| `/assets` | 素材库 | 已保存图片/语音/Prompt/视频 |
| `/spaces` | 空间管理 | 创作空间切换 |
| `/settings` | 设置 | API Key 配置（8 平台） |
| `/logs` | 日志面板 | 应用日志查看（Ctrl+\`） |

## 核心业务流程

```
故事文本 → AI 拆分分镜 → 角色提取/场景绑定
       → 生成图片/旁白/BGM/字幕 → 生成视频（多平台路由）
       → 时间线剪辑 → FFmpeg 后期合成 → 成片导出
```

### Pipeline 9 阶段流程

`PipelineService` 编排完整流程：`splitting → characterExtraction → sceneBinding → imageGeneration → videoGeneration → voiceGeneration → musicGeneration → postProcess → complete`

### 视频生成模式

| 模式 | 说明 |
|------|------|
| T2V | 文本生成视频 |
| I2V | 图片生成视频 |
| FL2V | 首尾帧生成视频 |
| S2V | 主体参考生成视频 |

## 数据存储

采用**双层存储架构**（Local-First，无后端服务）：

- **IndexedDB（Dexie v12，15 张表）** — 仅存储元数据（Story / Character / VideoTask / Timeline / GeneratedFile 元信息等）
- **FilesLocal（配置目录 `FILES_DIR`）** — 优先存储文件二进制（Blob），由 Vite 自定义插件 `filesStoragePlugin` 提供 HTTP 接口
- **OPFS（Origin Private File System）** — FilesLocal 不可用时的 fallback，纯浏览器内存储
- **旧数据迁移** — `OfflineCacheMigration` 在启动时检测并迁移早期版本中误存入 IndexedDB 的二进制数据

存储偏好默认 `'local'`（配置目录优先，OPFS 作为 fallback）。文件路径元数据存储在 `generatedFiles` 表的 `storagePath` 字段。

## 设计约束

- **不注册 Service Worker**：避免 SW 的 cache-first 策略和跨源媒体拦截导致媒体预览失败（老用户残留 SW 由 `index.html` 内联脚本一次性卸载）
- **文本输入不截断**：UI 层使用软限制模式（超限显示红框 + 计数器 + toast 警告），适配器层透传原始文本
- **文本长度集中管理**：所有文本限制定义在 `textLimits.ts` 的 `TEXT_LIMITS`（UI 跨平台最小值）与 `ADAPTER_TEXT_LIMITS`（平台硬限制）
- **接口出入参日志**：所有接口出入参数通过日志打印（CompositeLogger 多 Sink 聚合）
- **智能降级**：AI 拆分/分解服务不可用时自动降级到本地 Mock 实现

## 开发说明

- Vite 开发服务器通过自定义插件 `filesStoragePlugin` 提供本地文件存储 HTTP 接口（`/files/*`）
- 生产环境直接请求配置的 `FILES_DIR` 或 OPFS
- Vite `manualChunks` 拆分：vendor-react / vendor-router / vendor-i18n / vendor-icons / vendor-db / vendor-http / vendor-ffmpeg
- 应用启动序列：`bootstrap()` 并行初始化 `ApiConfigStore.init()` + `initializeFileStorage()`，然后渲染 React UI
- 关键 chunk 预加载：`requestIdleCallback` 中预加载 StoryWorkbench / ExportCenter / CharacterManagement

## 详细文档

完整代码文档请参阅 [CODE_WIKI.md](./CODE_WIKI.md)

## 开源协议

本项目基于 **Apache License 2.0** 开源，详见 [LICENSE](./LICENSE) 文件。

- ✅ 允许商业使用
- ✅ 允许修改与衍生
- ✅ 允许再分发
- ✅ 允许专利使用
- ✅ 附带明确的作者署名要求

简单来说：你可以自由地使用、修改、商用本项目，唯一义务是保留版权声明并在修改的文件中注明改动。如果你对项目做了改进，欢迎回馈 PR。

### 第三方依赖

本项目使用了多个优秀的开源依赖，完整的依赖列表及各自的协议请见 `npm install` 后生成的 `node_modules/*/LICENSE` 文件以及 `package.json`。
