中文 | [English](./CODE_WIKI_EN.md)

# AI Video Studio — Code Wiki

> 最后更新：2026-07-02

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [项目架构](#3-项目架构)
4. [目录结构](#4-目录结构)
5. [领域实体层 (Domain Entities)](#5-领域实体层-domain-entities)
6. [端口接口层 (Domain Ports)](#6-端口接口层-domain-ports)
7. [领域服务层 (Domain Services)](#7-领域服务层-domain-services)
8. [适配器层 (Adapters)](#8-适配器层-adapters)
9. [依赖注入容器 (Dependencies)](#9-依赖注入容器-dependencies)
10. [UI 层 (Presentation)](#10-ui-层-presentation)
11. [路由与页面](#11-路由与页面)
12. [国际化 (i18n)](#12-国际化-i18n)
13. [数据持久化 (IndexedDB + OPFS)](#13-数据持久化-indexeddb--opfs)
14. [工具与基础设施](#14-工具与基础设施)
15. [核心业务流程](#15-核心业务流程)
16. [项目运行方式](#16-项目运行方式)
17. [关键设计决策与约束](#17-关键设计决策与约束)

---

## 1. 项目概述

**AI Video Studio** 是一个基于 React + TypeScript 的纯前端 AI 短视频创作平台。用户输入故事文本，由 AI 自动完成角色提取、场景拆分、图片/视频/配音/BGM 生成，最终通过 FFmpeg WASM 后期合成完整短视频。所有数据存储在浏览器本地（IndexedDB + OPFS），无需后端服务。

### 核心能力

| 能力 | 说明 |
|------|------|
| 多平台 AI 路由 | 8 个 AI 平台（MiniMax / 火山引擎 / Coze / 可灵 / 万相 / 混元 / 智谱 / Vidu）按能力动态路由 |
| 故事创作 | 输入故事文本，AI 自动拆分分镜、提取角色和场景 |
| 图片生成 | 多平台图片生成，支持 T2I / I2I |
| 视频生成 | 支持 T2V / I2V / FL2V / S2V 四种模式 + Agent 模板 |
| 语音合成 | 语音克隆、语音设计、流式合成、异步合成 |
| 音乐生成 | AI 作曲、歌词创作、翻唱 |
| 文本润色 | AI 文本增强、改写、对话 |
| 后期处理 | FFmpeg WASM 实现视频拼接、字幕烧录、音频混合 |
| 视频剪辑 | 时间线编排工作台，多轨剪辑、转场、字幕 |
| 一键成片 | Pipeline 全流程编排，从故事到成片自动完成 |
| 去水印 | 图片 / PDF / 视频去水印，6 种算法（含 Telea / Navier-Stokes / Content-Aware Fill） |
| 清晰度提升 | 图片 / PDF / 视频清晰度增强（去噪 + 放大 + 锐化） |
| AI 助手 | Agent 对话式创作辅助 |
| 素材库 | 离线存储图片 / 音色 / 提示词 / 视频资产 |
| 多语言 | 中 / 英 / 日 / 韩 / 法 / 德 / 西 / 俄 / 葡 / 意 10 种语言 |
| 日志面板 | RingBuffer 日志循环缓冲 + Ctrl+\` 快捷键调出 + 自动脱敏 |

---

## 2. 技术栈与依赖

### 运行时依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `react` / `react-dom` | ^19.2.6 | UI 框架 |
| `react-router-dom` | ^7.17.0 | 客户端路由 |
| `axios` | ^1.17.0 | HTTP 请求 |
| `dexie` / `dexie-react-hooks` | ^4.4.3 | IndexedDB ORM + 响应式查询 |
| `@ffmpeg/ffmpeg` / `@ffmpeg/util` | ^0.12.15 | 浏览器端视频处理 (WASM) |
| `i18next` / `react-i18next` / `i18next-browser-languagedetector` | ^26.3.1 | 国际化 |
| `lucide-react` | ^1.17.0 | 图标库 |
| `react-window` | ^1.8.11 | 虚拟滚动（日志面板） |
| `pdf-lib` | ^1.17.1 | PDF 重新封装 |
| `pdfjs-dist` | ^6.1.200 | PDF 渲染（CDN 动态加载） |
| `uuid` | ^14.0.0 | UUID 生成 |

### 开发依赖

| 依赖 | 用途 |
|------|------|
| `vite` ^8.0.12 | 构建工具 |
| `typescript` ~6.0.2 | 类型系统 |
| `@vitejs/plugin-react` ^6.0.1 | React Vite 插件 |
| `eslint` ^10.3.0 + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` | 代码检查 |
| `vitest` ^2.1.9 + `@vitest/coverage-v8` | 单元测试 |
| `@testing-library/react` ^16.3.2 | React 组件测试 |
| `fake-indexeddb` ^6.2.5 | 测试用 IndexedDB mock |
| `jsdom` ^25.0.1 | 测试 DOM 环境 |

### 外部 AI 平台

| 平台 | 鉴权方式 | 能力 |
|------|----------|------|
| MiniMax（海螺） | Bearer API Key + group_id | 视频 / 图片 / 文本 / 语音（全能力）/ 音乐 |
| 火山引擎（即梦） | Bearer API Key | 视频 / 图片 / 文本 / 语音（Agent Plan 套餐） |
| Coze | Bearer PAT Token | Bot 管理 / 对话 |
| 可灵 Kling | JWT (HS256) | 视频 / 图片 |
| 万相 Wan | Bearer API Key + X-DashScope-Async | 视频 / 图片 / 文本 / 语音 |
| 混元 Hunyuan | TC3-HMAC-SHA256 签名 | 视频 / 图片 / 文本 / 语音 |
| 智谱 Zhipu | Bearer API Key | 视频 / 图片 / 文本 / 语音 |
| Vidu | Token API Key | 视频 / 图片 |

---

## 3. 项目架构

本项目采用 **六边形架构（Hexagonal Architecture / Ports & Adapters）**，将业务逻辑与外部依赖彻底解耦。在六边形架构基础上，演进出了 **多平台路由层**、**横切关注点端口层** 和 **文件存储分层** 三个关键扩展。

```
┌──────────────────────────────────────────────────────────────────┐
│                          UI Layer (React)                          │
│   Pages (17) / Components (47) / Hooks (17) / Contexts (5)        │
│   Layouts / Utils                                                  │
├──────────────────────────────────────────────────────────────────┤
│                  Dependency Injection (dependencies.ts)            │
├──────────────────────────────────────────────────────────────────┤
│                     Domain Services (25)                           │
│  StoryService / VideoGenerationService / PipelineService           │
│  VoiceService / MusicService / AgentService                         │
│  TimelineRenderService / TimelineService / AssetLibraryService    │
│  PlatformRouter（核心枢纽）/ platformCapabilities                  │
├──────────────────────────────────────────────────────────────────┤
│                     Domain Ports (15 接口文件)                     │
│  OutboundPorts / PostProcessPorts                                  │
│  EnhancementPorts / WatermarkRemovalPorts / FileStoragePorts       │
│  CrossCuttingPorts / LoggingPorts / UiPorts / PlatformPorts        │
│  DomainServicePorts / PersistencePorts / TimelineRenderPorts        │
│  AssetLibraryPorts / ModelCachePort                                 │
├──────────────────────────────────────────────────────────────────┤
│                     Domain Entities / Constants / Errors            │
│  Story / StorySegment / Character / VideoTask / PipelineTask       │
│  FinalCut / SavedImage / SavedVoice / SavedPrompt / SavedVideo     │
│  GeneratedFile / Timeline / SpaceSnapshot / 3D / Cache / Bot       │
│  TEXT_LIMITS / ADAPTER_TEXT_LIMITS / UnsupportedCapabilityError    │
├──────────────────────────────────────────────────────────────────┤
│                     Adapters (Implementations)                    │
│  ┌─────────────┬─────────────┬─────────────┬─────────────────┐    │
│  │ 8 平台 API  │ enhance/    │ inpaint/    │ storage/         │    │
│  │ MiniMax     │ Canvas 图像  │ Canvas 图像 │ FilesLocal       │    │
│  │ Volcengine │ FFmpeg 视频  │ FFmpeg 视频 │ OPFS             │    │
│  │ Hunyuan     │ PDF          │ PDF         │ IndexedDB(降级) │    │
│  │ Kling       │              │ Douyin 解析 │                  │    │
│  │ Vidu/Wan    │              │             │                  │    │
│  │ Zhipu/Coze  │              │             │                  │    │
│  ├─────────────┼─────────────┼─────────────┼─────────────────┤    │
│  │ infrastructure/ │ repositories/ │ config/ │ services/ │ ui/│    │
│  │ Logger 日志     │ Dexie ORM    │ 配置加密 │ Port 包装  │ 事件桥│    │
│  │ EventBus 事件   │ GeneratedFile │ secure   │            │     │    │
│  │ Resilience 韧性  │ AssetLib     │          │            │     │    │
│  └─────────────┴─────────────┴─────────────┴─────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 架构原则

1. **依赖倒置**：领域服务仅依赖 Port 接口，不依赖具体适配器实现
2. **多平台路由**：通过 `PlatformRouter` 根据当前激活平台与能力动态路由到对应适配器
3. **关注点分离**：UI → Domain → Adapters 三层清晰隔离
4. **可替换性**：任何适配器可被替换（如 Mock 适配器用于测试/降级）
5. **智能降级**：`smartTextSplitter` / `smartStoryBreakdown` 在 AI 不可用时自动降级到 Mock
6. **OPFS 优先**：文件二进制优先存 OPFS / 本地磁盘，IndexedDB 仅存元数据
7. **横切关注点端口化**：日志 / 事件 / 指标 / 韧性 / 通知 / 确认 / 主题 / i18n / 网络状态全部抽象为 Port
8. **接口隔离**：`IVoicePort.voiceCapabilities` 声明能力（克隆/设计/删除/流式），不支持的能力由适配器抛 `CapabilityNotSupportedError`

### 5 层分层

| 层 | 职责 | 关键文件 |
|----|------|----------|
| **UI 层** | React 页面 / 组件 / Hooks / Context | [App.tsx](file:///d:/projects/ai-video-studio/src/App.tsx)、[ui/](file:///d:/projects/ai-video-studio/src/ui/) |
| **DI 容器** | 组装所有依赖 | [dependencies.ts](file:///d:/projects/ai-video-studio/src/dependencies.ts) |
| **Domain 服务** | 业务逻辑（25 个服务） | [domain/services/](file:///d:/projects/ai-video-studio/src/domain/services/) |
| **Domain 端口** | 接口契约（15 个端口文件） | [domain/ports/](file:///d:/projects/ai-video-studio/src/domain/ports/) |
| **Adapters** | 外部系统实现 | [adapters/outbound/](file:///d:/projects/ai-video-studio/src/adapters/outbound/) |

---

## 4. 目录结构

```
src/
├── adapters/outbound/              # 适配器层 — 外部系统实现
│   ├── api/                         #   外部 API 适配器
│   │   ├── (根目录)                  #     MiniMax 系列 + FFmpeg + Whisper
│   │   │   ├── MiniMaxVideoAdapter.ts
│   │   │   ├── MiniMaxImageAdapter.ts
│   │   │   ├── MiniMaxVoiceAdapter.ts
│   │   │   ├── MiniMaxMusicAdapter.ts
│   │   │   ├── MiniMaxTextAdapter.ts
│   │   │   ├── MiniMaxTextSplitterAdapter.ts        # 智能降级拆分
│   │   │   ├── MiniMaxStoryBreakdownAdapter.ts      # 智能降级分解
│   │   │   ├── MiniMaxModelAdapter.ts
│   │   │   ├── MiniMaxFileAdapter.ts
│   │   │   ├── MiniMaxErrorUtils.ts
│   │   │   ├── MockTextSplitter.ts                  # 降级实现
│   │   │   ├── MockStoryBreakdown.ts                # 降级实现
│   │   │   ├── FFmpegAdapter.ts                    # FFmpeg WASM
│   │   │   └── WhisperAdapter.ts                   # 占位实现
│   │   ├── volcengine/             #     火山引擎（8 个文件）
│   │   ├── hunyuan/                #     腾讯混元（6 个文件）
│   │   ├── kling/                  #     快手可灵（5 个文件）
│   │   ├── vidu/                   #     生数 Vidu（5 个文件）
│   │   ├── wan/                    #     阿里万相（7 个文件）
│   │   ├── zhipu/                  #     智谱 AI（7 个文件）
│   │   ├── coze/                   #     字节 Coze（3 个文件）
│   │   ├── enhance/                #     清晰度提升（3 个适配器）
│   │   │   ├── CanvasImageEnhanceAdapter.ts
│   │   │   ├── FFmpegVideoEnhanceAdapter.ts
│   │   │   └── PdfEnhanceAdapter.ts
│   │   └── inpaint/                #     去水印（6 个适配器）
│   │       ├── CanvasInpaintAdapter.ts             # 6 种算法
│   │       ├── DelogoVideoInpaintAdapter.ts         # FFmpeg delogo 快速模式
│   │       ├── FFmpegVideoInpaintAdapter.ts         # 逐帧 Canvas 高质量模式
│   │       ├── PdfWatermarkAdapter.ts
│   │       ├── DouyinVideoAddressResolver.ts        # 抖音直链解析
│   │       └── NotImplementedVideoAddressResolver.ts
│   ├── config/                     #   配置管理
│   │   ├── ApiConfigStore.ts                        # 8 平台配置 + 加密
│   │   ├── ApiConfigStoreAdapter.ts                # IApiConfigStore 实现
│   │   ├── LogViewerConfigStore.ts                 # 日志面板配置
│   │   └── secureStorage.ts                         # AES-GCM 加密基础设施
│   ├── infrastructure/             #   横切关注点
│   │   ├── ConsoleLoggerAdapter.ts                 # ILoggerPort 控制台实现
│   │   ├── CompositeLoggerAdapter.ts               # 组合日志器
│   │   ├── RingBufferLogSinkAdapter.ts             # 日志面板数据源
│   │   ├── GlobalErrorCapture.ts                   # 全局错误捕获
│   │   ├── MemoryEventBusAdapter.ts                # IEventBus 内存实现
│   │   ├── NoopMetricsAdapter.ts                   # IMetricsPort 占位
│   │   ├── DefaultResilienceAdapter.ts             # IResiliencePort 重试+熔断
│   │   ├── BrowserNetworkStatusAdapter.ts          # 网络状态
│   │   └── PlatformCapabilitiesAdapter.ts          # 平台能力查询
│   ├── repositories/               #   仓储适配器
│   │   ├── DexieDatabase.ts                        # 数据库定义 + v1-v12 迁移
│   │   ├── IndexedDBAdapters.ts                    # 7 个核心仓储
│   │   ├── AssetLibraryRepositories.ts             # 4 个素材库仓储
│   │   ├── GeneratedFileRepository.ts              # OPFS 元数据仓储
│   │   ├── ModelCacheAdapter.ts                    # 模型缓存
│   │   ├── SnapshotRepositoryAdapter.ts             # 快照仓储
│   │   └── TimelineRepositoryAdapter.ts             # 时间线仓储
│   ├── storage/                    #   文件存储降级链
│   │   ├── FileStorageAdapterFactory.ts            # 工厂选择逻辑
│   │   ├── FilesLocalAdapter.ts                    # 本地磁盘（Vite 插件）
│   │   ├── OPFSFileStorageAdapter.ts               # 浏览器 OPFS
│   │   ├── IndexedDBFileStorageAdapter.ts          # IndexedDB（已停用）
│   │   └── OfflineCacheMigration.ts               # 旧库迁移
│   ├── services/                   #   Service → Port 包装
│   │   ├── AgentPortAdapter.ts
│   │   ├── AssetExportAdapter.ts
│   │   ├── AutoEditPortAdapter.ts
│   │   ├── BGMPortAdapter.ts
│   │   ├── CinematographyPortAdapter.ts
│   │   ├── PostProcessPortAdapter.ts
│   │   ├── SubtitlePortAdapter.ts
│   │   └── TimelineRenderPortAdapter.ts
│   └── ui/                         #   UI Port 事件桥
│       ├── I18nextTranslationAdapter.ts
│       ├── ReactConfirmAdapter.ts
│       ├── ReactNotificationAdapter.ts
│       └── ReactThemeAdapter.ts
├── domain/                         # 领域层 — 核心业务逻辑
│   ├── constants/textLimits.ts     #   文本长度限制常量
│   ├── data/systemVoices.ts        #   MiniMax 系统音色（80+）
│   ├── entities/models.ts          #   领域实体
│   ├── errors/UnsupportedCapabilityError.ts
│   ├── ports/                      #   15 个端口接口文件
│   │   ├── OutboundPorts.ts        #     核心出站端口
│   │   ├── PostProcessPorts.ts     #     FFmpeg/Whisper + Timeline 实体
│   │   ├── EnhancementPorts.ts     #     清晰度提升端口
│   │   ├── WatermarkRemovalPorts.ts#     去水印端口
│   │   ├── FileStoragePorts.ts    #     文件存储端口
│   │   ├── CrossCuttingPorts.ts   #     横切关注点端口
│   │   ├── LoggingPorts.ts        #     日志端口
│   │   ├── UiPorts.ts             #     UI 状态端口
│   │   ├── PlatformPorts.ts       #     平台能力端口
│   │   ├── DomainServicePorts.ts  #     业务编排端口
│   │   ├── PersistencePorts.ts    #     快照/时间线仓储端口
│   │   ├── TimelineRenderPorts.ts #     时间线渲染端口
│   │   ├── AssetLibraryPorts.ts   #     素材库端口
│   │   └── ModelCachePort.ts      #     模型缓存端口
│   └── services/                   #   25 个领域服务
│       ├── PlatformRouter.ts       #     多平台路由核心
│       ├── platformCapabilities.ts #     平台能力矩阵
│       ├── platformSelector.ts    #     纯函数选择器
│       ├── StoryService.ts
│       ├── VideoGenerationService.ts
│       ├── VideoLabService.ts
│       ├── VoiceService.ts
│       ├── MusicService.ts
│       ├── MusicLabService.ts
│       ├── TextGenerationService.ts
│       ├── TextLabService.ts
│       ├── ImageGenerationService.ts
│       ├── PipelineService.ts
│       ├── PostProcessService.ts
│       ├── SubtitleService.ts
│       ├── AgentService.ts
│       ├── AutoEditService.ts
│       ├── CinematographyService.ts
│       ├── BGMRecommendationService.ts
│       ├── StorySpaceService.ts
│       ├── ModelManagementService.ts
│       ├── FileManagementService.ts
│       ├── AssetLibraryService.ts
│       ├── SnapshotService.ts
│       ├── TimelineService.ts
│       └── TimelineRenderService.ts
├── ui/                             # UI 展示层
│   ├── components/                 #   47 个组件（含 LogViewer/enhance/settings/watermark 子目录）
│   ├── contexts/                   #   5 个 React Context
│   ├── hooks/                      #   17 个自定义 Hook
│   ├── layouts/MainLayout.tsx      #   主布局
│   ├── pages/                      #   17 个页面（含 editor/enhance 子目录）
│   └── utils/                      #   UI 工具（5 个文件）
├── utils/                          # 通用工具（5 个文件）
├── locales/                        # 国际化（10 种语言）
├── assets/                         # 静态资源
├── App.tsx                         # 应用入口 & 路由定义
├── dependencies.ts                 # 依赖注入容器
├── i18n.ts                         # 国际化配置
├── main.tsx                        # 渲染入口
└── index.css                       # 全局样式
vite/
└── filesStoragePlugin.ts           # Vite 本地文件存储插件
scripts/                            # 跨平台启动脚本
├── start.sh / start.ps1 / start.bat
├── i18n-check.mjs
└── lib/
    ├── run-dev.mjs
    ├── env-check.mjs
    └── install-deps.mjs
```

---

## 5. 领域实体层 (Domain Entities)

文件：[models.ts](file:///d:/projects/ai-video-studio/src/domain/entities/models.ts)

> 注：Timeline 相关实体定义在 [PostProcessPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/PostProcessPorts.ts)，SpaceSnapshot 定义在 [PersistencePorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/PersistencePorts.ts)，按所属端口就近定义。

### 5.1 核心故事实体

| 实体 | 说明 | 关键字段 |
|------|------|----------|
| `StorySpace` | 创作空间（顶级聚合根） | `id`, `name`, `description`, `createdAt` |
| `Character` | 角色 | `id`, `spaceId`, `name`, `appearancePrompt`, `personalityPrompt`, `characterBackground`, `referenceImageUrl?`, `referenceImageStoragePath?`（OPFS）, `voiceId?` |
| `Background` | 场景背景 | `id`, `spaceId`, `name`, `environmentPrompt`, `referenceImageUrl?`, `referenceImageStoragePath?`（OPFS） |
| `Story` | 故事 | `id`, `spaceId`, `title`, `originalText`, `status: StoryStatus`, `createdAt` |
| `StorySegment` | 故事分镜 | `id`, `storyId`, `sequenceOrder`, `content`, `mentionedCharacters[]`, `selectedBackgroundId?`, `bgmAudioUrl?`, `bgmPrompt?`, `bgmLyrics?`, `bgmIsInstrumental?`, `actionContent?`, `firstFrameImage?`, `narrationAudioStoragePath?`（OPFS）, `bgmStoragePath?`（OPFS） |

### 5.2 视频任务实体

| 实体/类型 | 说明 |
|-----------|------|
| `VideoTaskStatus` | `'PENDING' \| 'PROCESSING' \| 'SUCCESS' \| 'FAILED'` |
| `VideoModel` | `'MiniMax-Hailuo-2.3' \| 'MiniMax-Hailuo-2.3-Fast' \| 'MiniMax-Hailuo-02' \| 'T2V-01-Director' \| 'T2V-01' \| 'I2V-01-Director' \| 'I2V-01-live' \| 'I2V-01' \| 'S2V-01'` |
| `VideoResolution` | `'512P' \| '720P' \| '768P' \| '1080P'` |
| `VideoGenerationMode` | `'t2v' \| 'i2v' \| 'fl2v' \| 's2v'` |
| `VideoTask` | `id`, `segmentId`, `targetPlatform`, `status`, `videoUrl?`, `externalTaskId?`, `mode?`, `model?`, `resolution?`, `duration?: 6\|10`, `fileId?`, `videoStoragePath?`（OPFS）, `promptOptimizer?`, `firstFrameImage?`, `lastFrameImage?` |

### 5.3 Pipeline 流水线实体

| 实体/类型 | 说明 |
|-----------|------|
| `PipelineStatus` | `'idle' \| 'splitting' \| 'generating_images' \| 'generating_audio' \| 'generating_bgm' \| 'generating_videos' \| 'post_processing' \| 'generating_srt' \| 'burning_subtitles' \| 'complete' \| 'failed'` |
| `PipelineStep` | `name: PipelineStatus`, `status: 'pending'\|'running'\|'done'\|'failed'`, `startedAt?`, `completedAt?`, `error?` |
| `PipelineTask` | `id`, `storyId`, `status`, `progress`, `currentStep`, `steps[]`, `finalVideoUrl?`, `createdAt`, `completedAt?`, `error?` |
| `FinalCut` | `id`, `storyId`, `pipelineTaskId?`, `videoBlob: Blob`, `thumbnailUrl?`, `thumbnailStoragePath?`（OPFS）, `videoStoragePath?`（OPFS）, `duration`, `size`, `hasSubtitles`, `srtContent?`, `createdAt` |

### 5.4 素材库实体

| 实体 | 说明 | 关键字段 |
|------|------|----------|
| `SavedImage` | 已保存图片 | `id`, `spaceId`, `name`, `prompt`, `model`, `aspectRatio`, `blobKey`（OPFS 路径）, `thumbnailBlobKey?`, `tags[]`, `sourceType: 'lab'\|'pipeline'\|'character'\|'background'` |
| `SavedVoice` | 已保存音色 | `id`, `spaceId`, `name`, `voiceId`, `model`, `speed`, `sampleText`, `audioBlobKey`, `tags`, `sourceType: 'lab'\|'clone'\|'pipeline'` |
| `SavedPrompt` | 已保存提示词 | `id`, `spaceId`, `name`, `content`, `category: 'image'\|'voice'\|'story'\|'scene'\|'narration'\|'other'`, `tags`, `sourceType: 'lab'\|'pipeline'\|'manual'` |
| `SavedVideo` | 已保存视频 | `id`, `spaceId`, `name`, `durationSec`, `width?`, `height?`, `mimeType`, `blobKey`, `thumbnailBlobKey?`, `tags`, `sourceType: 'lab'\|'pipeline'\|'editor'\|'import'` |

### 5.5 文件存储实体（v10，OPFS 统一管理）

| 实体 | 说明 | 关键字段 |
|------|------|----------|
| `GeneratedFileType` | `'image' \| 'audio' \| 'video' \| 'other'` | — |
| `GeneratedFile` | OPFS 文件元数据 | `id`, `spaceId`, `fileType`, `mimeType`, `fileName`, `fileSize`, `storagePath`（OPFS 相对路径）, `originalUrl?`, `sourcePlatform?`, `sourceEntityId?`, `sourceEntityType?`, `tags[]`, `lastAccessedAt`（LRU）, `createdAt`, `originalSize?`, `compressedAt?`, `compressionRatio?` |

### 5.6 Coze Bot/对话实体

| 实体 | 说明 |
|-----------|------|
| `BotCreateParams` / `BotResult` / `PublishResult` / `BotListResult` | Bot 应用管理 |
| `DialogChatParams` / `DialogChatResult` / `DialogStreamChunk` | Bot 对话（流式 SSE） |

---

## 6. 端口接口层 (Domain Ports)

### 6.1 OutboundPorts.ts（核心出站端口）

文件：[OutboundPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/OutboundPorts.ts)

#### 仓储接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `IStorySpaceRepository` | `save`, `findById`, `findAll`, `delete` | 创作空间 CRUD |
| `ICharacterRepository` | `save`, `findById`, `findAll`, `findBySpaceId`, `delete` | 角色 CRUD |
| `IBackgroundRepository` | 同上 | 背景 CRUD |
| `IStoryRepository` | 同上 | 故事 CRUD |
| `IStorySegmentRepository` | `save`, `findById`, `findByStoryId`, `deleteByStoryId` | 分镜 CRUD |
| `IVideoTaskRepository` | `save`, `findBySegmentId`, `findLatestBySegmentId`, `findByStatuses`, `updateStatus`, `deleteBySegmentIds` | 视频任务管理 |
| `IFinalCutRepository` | `save`, `findById`, `findByStoryIds`, `delete` | 成片管理 |

#### 外部服务接口

| 接口 | 关键方法 | 说明 |
|------|----------|------|
| `IVideoGeneratorPort` | `submitVideoTask`, `queryTaskStatus`, `downloadVideo`, `createAgentTask`, `queryAgentTask` | 视频生成 |
| `IImageGeneratorPort` | `generateImage` | 图片生成 |
| `IVoicePort` | `uploadFile`, `cloneVoice`, `createT2ATask`, `queryT2ATask`, `synthesizeSpeechSync`, `synthesizeSpeechStream`, `designVoice`, `getAvailableVoices`, `deleteVoice`, `fetchAudioAsBlobUrl` + `voiceCapabilities` | 语音合成（能力声明） |
| `IMusicPort` | `generateMusic`, `generateLyrics`, `preprocessCover` | 音乐生成 |
| `ITextGenerationPort` | `chatCompletion`, `chatCompletionStream` | 文本生成 |
| `IModelManagementPort` | `listModels`, `retrieveModel` | 模型管理 |
| `IFileManagementPort` | `listFiles`, `deleteFile` | 文件管理 |
| `ITextSplitterPort` | `splitStoryToSegments` | 故事拆分 |
| `IStoryBreakdownPort` | `breakdownStory` | 一键分解 |

**`VoiceCapabilities`（接口隔离原则）**：`supportsClone`, `supportsDesign`, `supportsDelete`, `supportsStream`。不支持的能力由适配器抛 `CapabilityNotSupportedError`。

### 6.2 PostProcessPorts.ts（FFmpeg/Whisper + Timeline 实体）

文件：[PostProcessPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/PostProcessPorts.ts)

| 接口 | 关键方法 | 说明 |
|------|----------|------|
| `IFFmpegPort` | `load`, `merge`, `concat`, `burnSubtitles`, `mixAudio`, `applyTransition`, `compress`, `convertFormat`, `changeSpeed`, `trim`, `crop`, `resize`, `extractFrame`, `reverse`, `fadeInOut`, `applyDelogo`, `encodeFromFrames` | FFmpeg 后期处理 |
| `IWhisperPort` | `load`, `transcribe` | 语音转文字 |

**Timeline 实体定义于此**：`TimelineClipType`（video/audio/subtitle/transition）、`TimelineClipSource`（kind+refId+inPointSec+outPointSec）、`TimelineClip`、`TimelineTrack`、`TimelineTransition`、`Timeline`。
**转场类型**：`TransitionType = 'fade' \| 'fadeblack' \| 'fadewhite' \| 'wipeleft' \| 'wiperight' \| 'slideup' \| 'slidedown' \| 'circlecrop' \| 'rectcrop' \| 'distance'`

### 6.3 EnhancementPorts.ts（清晰度提升端口）

文件：[EnhancementPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/EnhancementPorts.ts)

| 接口 | 方法 | 说明 |
|------|------|------|
| `IImageEnhancePort` | `enhance(image, options, onProgress?)` | 图片增强：去噪（双边滤波）+ 放大 + USM 锐化 |
| `IPdfEnhancePort` | `enhance(file, options, onProgress?)` | PDF 增强：高 DPI 渲染 + Canvas 处理 + 重新封装 |
| `IVideoEnhancePort` | `enhance(file, options, onProgress?)` | 视频增强：抽帧 + 逐帧处理 + 重编码 |

**`EnhanceMode`**：`'sharpen' \| 'denoise' \| 'upscale' \| 'all'`

### 6.4 WatermarkRemovalPorts.ts（去水印端口）

文件：[WatermarkRemovalPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/WatermarkRemovalPorts.ts)

| 接口 | 方法 | 说明 |
|------|------|------|
| `IImageInpaintPort` | `inpaint(image, regions, options, onProgress?)` | 图片去水印（6 种算法） |
| `IPdfWatermarkPort` | `removeWatermark(file, regions, options, onProgress?)` | PDF 去水印 |
| `IVideoInpaintPort` | `inpaintVideo(file, regions, options, onProgress?)` | 视频去水印（fast/quality 两模式） |
| `IVideoAddressResolverPort` | `resolve(shareUrl)` | 视频地址解析（直链 / 抖音分享链接） |

**`InpaintAlgorithm`**：`'fast_fill' \| 'edge_interpolation' \| 'texture_synthesis' \| 'telea' \| 'navier_stokes' \| 'content_aware'`
**`VideoInpaintMode`**：`'fast'`（FFmpeg delogo 滤镜）| `'quality'`（逐帧 Canvas inpaint）

### 6.5 FileStoragePorts.ts（文件存储端口）

文件：[FileStoragePorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/FileStoragePorts.ts)

| 接口 | 关键方法 | 说明 |
|------|----------|------|
| `IFileStoragePort` | `storeBlob`, `getBlob`, `deleteBlob`, `blobExists`, `getObjectUrl`, `revokeObjectUrl`, `initialize`, `getStats`, `evictLRU`, `clearAll`, `isAvailable`, `getStorageType` | 文件二进制持久化 |
| `IGeneratedFileRepository` | `save`, `getById`, `query`, `delete`, `findByPath`, `count`, `getTotalSize`, `findLeastRecentlyUsed`, `touchAccessTime` | 元数据仓储 |

**`getStorageType()` 返回**：`'opfs' | 'indexeddb' | 'local'`

### 6.6 CrossCuttingPorts.ts（横切关注点端口）

文件：[CrossCuttingPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/CrossCuttingPorts.ts)

> 这是支撑用户规则"所有接口出入参数都通过日志打印出来"的核心设施。

| 接口 | 方法 | 说明 |
|------|------|------|
| `ILoggerPort` | `debug`, `info`, `warn`, `error`, `child(context)` | 结构化日志，安全约束：不得输出完整 API Key/Token |
| `IEventBus` | `emit(type, payload)`, `on(type, handler)`, `onAny(handler)` | 领域事件总线 |
| `IMetricsPort` | `counter(name, tags?)`, `histogram(name, tags?)` | 指标埋点 |
| `IResiliencePort` | `retry(fn, options)`, `withCircuitBreaker(key, fn, options)` | 重试 + 熔断 |
| `INotificationPort` | `toast(input)`, `dismiss(toastId)` | 通知端口（让 Service 主动弹 Toast） |
| `IConfirmPort` | `ask(input): Promise<boolean>` | 确认对话框端口 |

**`DomainEvent` 联合类型**：包含 `video.task.submitted`、`video.task.completed`、`video.task.failed`、`voice.cloned`、`platform.changed`、`space.snapshot.created`、`space.deleted`、`asset.saved` 等事件。

### 6.7 LoggingPorts.ts（日志端口）

文件：[LoggingPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/LoggingPorts.ts)

| 接口 | 方法 | 说明 |
|------|------|------|
| `ILogSinkPort` | `write(entry)`, `subscribe(listener)`, `snapshot(limit?)`, `clear`, `size` | 日志汇端口（默认 RingBuffer） |
| `ILogViewerConfigPort` | `get`, `set(patch)`, `subscribe` | 日志面板配置端口 |

### 6.8 UiPorts.ts（UI 状态端口）

文件：[UiPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/UiPorts.ts)

| 接口 | 方法 | 说明 |
|------|------|------|
| `IThemePort` | `getCurrentMode`, `setMode`, `onChange` | 主题端口（dark/light/blue/warm） |
| `ITranslationPort` | `t(key, vars?)`, `getLocale`, `setLocale`, `onChange`, `isReady` | 国际化端口 |
| `INetworkStatusPort` | `getStatus`, `isOnline`, `onChange` | 网络状态端口（online/offline/unstable） |

### 6.9 PlatformPorts.ts（平台能力端口）

文件：[PlatformPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/PlatformPorts.ts)

| 接口 | 方法 | 说明 |
|------|------|------|
| `IPlatformCapabilitiesPort` | `getMeta(platform)`, `hasCapability(platform, capability)`, `listAll`, `getCapabilitySummary` | 平台能力查询 |
| `IApiConfigStore` | `load`, `save`, `getActivePlatform`, `setActivePlatform`, `getApiKeyMasked`, `getToken`, `isPlatformConfigured`, `onPlatformChange`, `onConfigChange` | API 配置读写端口 |

**`PlatformCapability`**：`'video' \| 'videoFl2v' \| 'videoS2v' \| 'image' \| 'text' \| 'voice' \| 'music' \| 'bot' \| 'dialog'`
**`PlatformId`**：`'minimax' \| 'volcengine' \| 'coze' \| 'kling' \| 'wan' \| 'hunyuan' \| 'zhipu' \| 'vidu'`

### 6.10 其他端口文件

| 文件 | 端口 | 说明 |
|------|------|------|
| [DomainServicePorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/DomainServicePorts.ts) | `IAgentPort`, `IBGMRecommendationPort`, `ICinematographyPort`, `IAutoEditPort`, `IPostProcessPort`, `ISubtitlePort`, `IAssetExportPort` | 业务编排端口 |
| [PersistencePorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/PersistencePorts.ts) | `ISnapshotRepository`, `ITimelineRepository` | 快照/时间线仓储端口 |
| [TimelineRenderPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/TimelineRenderPorts.ts) | `ITimelineRenderPort`（`render`, `probeDuration`） | 时间线渲染端口 |
| [AssetLibraryPorts.ts](file:///d:/projects/ai-video-studio/src/domain/ports/AssetLibraryPorts.ts) | `ISavedImageRepository`, `ISavedVoiceRepository`, `ISavedPromptRepository`, `ISavedVideoRepository` | 素材库仓储端口 |
| [ModelCachePort.ts](file:///d:/projects/ai-video-studio/src/domain/ports/ModelCachePort.ts) | `IModelCachePort<T>`（`read`, `write`, `clear`, `ttlMs`, `cacheKey`） | 模型缓存端口 |

---

## 7. 领域服务层 (Domain Services)

### 7.1 PlatformRouter（多平台路由核心）

文件：[PlatformRouter.ts](file:///d:/projects/ai-video-studio/src/domain/services/PlatformRouter.ts)

**职责**：根据当前激活平台（`IApiConfigStore.getActivePlatform()`）和能力路由到对应平台适配器，是整个多平台架构的核心枢纽。

**依赖反转（v2.0）**：通过 `IApiConfigStore` 获取配置，通过 `IPlatformCapabilitiesPort` 查询能力，订阅 `onPlatformChange` 事件，平台切换时自动 `reset()` 缓存。

**关键方法**：

| 方法 | 说明 |
|------|------|
| `resolveVideo(config)` | 路由到视频生成适配器 |
| `resolveImage(config)` | 路由到图片生成适配器 |
| `resolveText(config)` | 路由到文本生成适配器 |
| `resolveVoice(config)` | 路由到语音合成适配器 |
| `resolveMusic(config)` | 路由到音乐生成适配器（仅 MiniMax） |
| `resolveBot(config)` | 固定 `CozeBotAdapter` |
| `resolveDialog(config)` | 固定 `CozeDialogAdapter` |
| `hasCapability(capability)` | 能力查询 |
| `reset()` | 清空所有适配器实例缓存 |

**路由机制**：
1. `ensureCap(platform, cap)` 检查能力，不支持抛 `UnsupportedCapabilityError`
2. 检查已缓存的适配器实例是否匹配当前平台（通过 `isMatchingPlatform` 比对适配器类名前缀）
3. 命中缓存直接返回；否则按 `switch(config.activePlatform)` 实例化对应平台适配器
4. 模块级单例缓存，平台切换时统一 `reset()` 置 null

**平台适配器映射表**：

| PlatformId | video | image | text | voice | music |
|------------|-------|-------|------|-------|-------|
| minimax | MiniMaxVideoAdapter | MiniMaxImageAdapter | MiniMaxTextAdapter | MiniMaxVoiceAdapter（全能力）| MiniMaxMusicAdapter |
| volcengine | VolcengineVideoAdapter | VolcengineImageAdapter | VolcengineTextAdapter | VolcengineVoiceAdapter（仅 TTS）| — |
| kling | KlingVideoAdapter | KlingImageAdapter | — | — | — |
| wan | WanVideoAdapter | WanImageAdapter | WanTextAdapter | WanVoiceAdapter | — |
| hunyuan | HunyuanVideoAdapter | HunyuanImageAdapter | HunyuanTextAdapter | HunyuanVoiceAdapter | — |
| zhipu | ZhipuVideoAdapter | ZhipuImageAdapter | ZhipuTextAdapter | ZhipuVoiceAdapter | — |
| vidu | ViduVideoAdapter | ViduImageAdapter | — | — | — |
| coze | — | — | — | — | — |

### 7.2 platformCapabilities（平台能力矩阵）

文件：[platformCapabilities.ts](file:///d:/projects/ai-video-studio/src/domain/services/platformCapabilities.ts)

**用途**：平台能力矩阵单一数据源。导出 `PLATFORM_METADATA` 全量表（8 平台的 id/name/brand/icon/accentColor/description/externalLink/capabilities/videoModels/imageModel/textModel）、`hasCapability(platform, capability)`、`getCapabilitySummary(platform)`、`getVideoCapablePlatforms()`。

**完整平台元信息**：

| PlatformId | name | brand | icon | 能力 | 默认视频模型 |
|------------|------|-------|------|------|--------------|
| minimax | 海螺 | MiniMax | 🎬 | video/videoFl2v/videoS2v/image/text/voice/music | Hailuo-2.3/02/T2V-01-Director/I2V-01 |
| volcengine | 即梦 | Volcengine | 🌋 | video/videoFl2v/videoS2v/image/text | seedance-1-0-pro/lite |
| coze | Coze | Coze | 🤖 | （无生成能力，仅 Bot/对话） | 无 |
| kling | 可灵 | Kling | 🎥 | video/videoS2v/image | kling-v2.1/v2-master/v1.6 |
| wan | 万相 | Wan | 🌈 | video/videoFl2v/videoS2v/image/text/voice | wanx2.1-t2v-turbo/plus/i2v |
| hunyuan | 混元 | Hunyuan | 🔮 | video/text/voice | hunyuan-video/i2v |
| zhipu | 智谱 | Zhipu | ✨ | video/videoS2v/image/text/voice | cogvideox-2/flash |
| vidu | Vidu | Vidu | 🎯 | video/videoFl2v/videoS2v/image | viduq1/vidu-1/vidu-2 |

### 7.3 platformSelector（纯函数选择器）

文件：[platformSelector.ts](file:///d:/projects/ai-video-studio/src/domain/services/platformSelector.ts)

导出 `selectAdapterKey(platform, capability): AdapterKey`、`withFallback(platform, supported)`（默认降级 minimax）、`SUPPORTED_MATRIX`（O(1) 查询）、`isSupported(platform, capability)`。可纯函数测试。

### 7.4 创作域服务

#### StoryService

文件：[StoryService.ts](file:///d:/projects/ai-video-studio/src/domain/services/StoryService.ts)

**依赖**：`IStoryRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `ITextSplitterPort`, `IStoryBreakdownPort`, `IVideoTaskRepository`

| 方法 | 说明 |
|------|------|
| `createStory(title, originalText, spaceId)` | 创建故事 |
| `updateStory(storyId, title, originalText)` | 更新故事（内容变更时重置为 DRAFT） |
| `splitStory(storyId)` | AI 拆分故事为分镜 |
| `previewBreakdown(storyId)` | 预览一键分解结果（不保存） |
| `applyBreakdown(storyId, characters, backgrounds, segments)` | 应用一键分解（同名去重） |
| `getSegments(storyId)` | 获取故事分镜（按序） |
| `updateSegmentBackground` / `removeCharacterFromSegments` / `removeBackgroundFromSegments` | 分镜维护 |
| `deleteStory(storyId)` | 删除故事及其分镜和视频任务 |

#### ImageGenerationService

文件：[ImageGenerationService.ts](file:///d:/projects/ai-video-studio/src/domain/services/ImageGenerationService.ts)

**依赖**：`ICharacterRepository`, `IBackgroundRepository`, `PlatformRouter`, `IApiConfigStore`, `IFileStoragePort`（lazy）, `ILoggerPort`

| 方法 | 说明 |
|------|------|
| `generateCharacterImage(characterId, aspectRatio='1:1')` | 生成角色形象图 |
| `generateBackgroundImage(backgroundId, aspectRatio='16:9')` | 生成背景环境图 |
| `getReferenceImageUrl(entity)` | 从 OPFS 存储路径恢复参考图 |

#### TextGenerationService / TextLabService

文件：[TextGenerationService.ts](file:///d:/projects/ai-video-studio/src/domain/services/TextGenerationService.ts) / [TextLabService.ts](file:///d:/projects/ai-video-studio/src/domain/services/TextLabService.ts)

| 服务 | 方法 | 说明 |
|------|------|------|
| `TextGenerationService` | `refinePrompt`, `refineText`, `suggestBGMStyle`, `optimizeVideoPrompt` | 通用文本生成 |
| `TextLabService` | `refineByScene(scene, input, style)`, `refineBySceneStream`, `chatStream`, `chat` | 文本实验室（6 种场景：script/storyboard/character/scene/bgm_style/prompt_optimize） |

### 7.5 视音频域服务

#### VideoGenerationService

文件：[VideoGenerationService.ts](file:///d:/projects/ai-video-studio/src/domain/services/VideoGenerationService.ts)

**依赖**：`IVideoTaskRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `PlatformRouter`, `IFileStoragePort`（lazy）, `IApiConfigStore`, `ILoggerPort`

| 方法 | 说明 |
|------|------|
| `generateVideo(segmentId, storyId, targetPlatform?, options?)` | 提交视频生成任务，自动构建 Prompt 上下文 |
| `getLatestTaskForSegment(segmentId)` | 获取分镜最新视频任务 |
| `resumeActivePolling()` | 页面重载后恢复活跃任务的轮询 + 回填已完成但未缓存的视频 |
| `cancelAllPolling()` | 取消所有轮询 |
| `getVideoPlaybackUrl(task)` | 优先 OPFS 缓存，降级外部 URL |

**内部机制**：提交任务后异步轮询状态（3s 间隔，最多 60 次）；支持 T2V/I2V/FL2V/S2V；后台自动缓存视频到 OPFS（>200MB 跳过）。

#### VideoLabService / VoiceService / MusicService / MusicLabService

| 服务 | 文件 | 关键方法 |
|------|------|----------|
| `VideoLabService` | [VideoLabService.ts](file:///d:/projects/ai-video-studio/src/domain/services/VideoLabService.ts) | `submitTask`, `submitAgentTask`, `queryTask`, `downloadVideo`, `startPolling`（5s 轮询） |
| `VoiceService` | [VoiceService.ts](file:///d:/projects/ai-video-studio/src/domain/services/VoiceService.ts) | `cloneVoiceForCharacter`, `generateNarrationAudio`（智能路由同步/异步）, `synthesizeStream`, `designVoice`, `generateAndPersistNarration`（OPFS 持久化）, `batchGenerateNarration` |
| `MusicService` | [MusicService.ts](file:///d:/projects/ai-video-studio/src/domain/services/MusicService.ts) | `generateBGM`, `generateCoverBGM`（两步流程）, `generateLyrics`, `bindBGMToSegment`（OPFS 持久化） |
| `MusicLabService` | [MusicLabService.ts](file:///d:/projects/ai-video-studio/src/domain/services/MusicLabService.ts) | `generateMusic`（hex→Blob→OPFS）, `generateLyrics`, `generateCover`, `restoreFromStorage` |

### 7.6 后期处理服务

#### PostProcessService

文件：[PostProcessService.ts](file:///d:/projects/ai-video-studio/src/domain/services/PostProcessService.ts)

**依赖**：`IFFmpegPort`, `IWhisperPort`

封装 16 个 FFmpeg 业务方法：`mergeVideoAudio`, `concatClips`, `burnSubtitles`, `mixBGM`, `applyTransition`, `compress`, `convertFormat`, `changeSpeed`, `trim`, `crop`, `resize`, `extractFrame`, `reverse`, `fadeInOut`, `transcribe`, `ensureLoaded`。

#### SubtitleService

文件：[SubtitleService.ts](file:///d:/projects/ai-video-studio/src/domain/services/SubtitleService.ts)

**依赖**：`IWhisperPort`, `PlatformRouter`, `IApiConfigStore`, `ILoggerPort`

| 方法 | 说明 |
|------|------|
| `generateSrtFromSegments(audio, segments, language='zh')` | Whisper 转录 → AI 对齐段落边界 → 格式化 SRT |
| `alignToSegments(transcripts, segments)` | 用 Chat Completion 把 Whisper 输出对齐到段落边界 |
| `distributeEvenly(segments)` | 无 Whisper 时降级方案（按字符数比例分配） |
| `formatSrt` / `parseSrt` / `translateSrt` | SRT 工具 |

### 7.7 管线服务（Pipeline）

文件：[PipelineService.ts](file:///d:/projects/ai-video-studio/src/domain/services/PipelineService.ts)

**依赖**：`IStoryRepository`, `IStorySegmentRepository`, `ICharacterRepository`, `IBackgroundRepository`, `IVideoTaskRepository`, `IFinalCutRepository`, `PlatformRouter`, `PostProcessService`, `SubtitleService`, `IFileStoragePort`（lazy）, `ILoggerPort`, `IEventBus`, `IApiConfigStore`

这是最核心的编排服务，实现一键成片的全流程：

| 方法 | 说明 |
|------|------|
| `createTask(storyId)` | 创建管线任务 |
| `subscribe(taskId, callback)` | 订阅任务状态变更 |
| `runFullPipeline(storyId, options?)` | 执行完整管线（9 阶段） |
| `assembleFinalVideo(storyId, narrationUrls, onProgress?)` | 合成最终视频（段间 fade 转场 offset=前段时长-0.5s） |
| `cancelTask(taskId)` / `markComplete` / `markFailed` | 任务控制 |
| `pollVideoTasks(taskId, videoTasks, onProgress)` | 兜底轮询（5s 间隔，最多 120 次） |

**Pipeline 阶段流程**：

```
splitting → generating_images → generating_audio → generating_bgm
→ generating_videos → post_processing → generating_srt
→ burning_subtitles → complete
```

### 7.8 时间线服务（剪辑工作台）

#### TimelineService（编排）

文件：[TimelineService.ts](file:///d:/projects/ai-video-studio/src/domain/services/TimelineService.ts)

**依赖**：`ITimelineRepository`, `IStoryRepository`, `IStorySegmentRepository`, `IVideoTaskRepository`

| 方法 | 说明 |
|------|------|
| `loadByStoryId(storyId)` | 加载最新时间线 |
| `save(timeline)` / `delete(id)` | 时间线 CRUD |
| `createEmpty(storyId)` | 创建空时间线（默认 4 轨：video/narration/bgm/subtitle） |
| `buildFromStory(storyId)` | F-03 自动铺轨：视频轨按 sequenceOrder，每个 SUCCESS VideoTask 一个 clip；旁白轨/BGM 轨按 OPFS 存储路径铺轨 |
| `buildFromFinalCut(storyId, finalCutId, durationSec)` | 场景 B：二次剪辑，单个 FinalCut 铺轨 |

#### TimelineRenderService（渲染）

文件：[TimelineRenderService.ts](file:///d:/projects/ai-video-studio/src/domain/services/TimelineRenderService.ts)

**依赖**：`IFFmpegPort`, `IFileStoragePort`（lazy）, `IVideoTaskRepository`, `IFinalCutRepository`, `ISavedVideoRepository`, `ISavedVoiceRepository`, `ILoggerPort`

| 方法 | 说明 |
|------|------|
| `render(timeline, options, onProgress?)` | 渲染时间线为最终视频 Blob |
| `probeDuration(blob)` | 探测视频时长（HTMLVideoElement 元数据） |

**渲染流程**：① 加载 FFmpeg ② 解析视频轨 clips sourceRef → Blob（含入出点裁切）③ 视频轨转场+concat ④ 音频混音→merge ⑤ 字幕烧录 ⑥ 后处理 resize/compress/convertFormat。转场 offset 计算：`offsetSec = Math.max(0, prevDuration - transitionDur)`，转场失败降级为 concat。

### 7.9 管理服务

| 服务 | 文件 | 关键方法 |
|------|------|----------|
| `StorySpaceService` | [StorySpaceService.ts](file:///d:/projects/ai-video-studio/src/domain/services/StorySpaceService.ts) | `createSpace`, `deleteSpace`（级联删除）, `copyAllToSpace`, `getSpaceStats` |
| `ModelManagementService` | [ModelManagementService.ts](file:///d:/projects/ai-video-studio/src/domain/services/ModelManagementService.ts) | `getModels`（缓存优先）, `refreshModels`, `getTextModels`, `getStaticVideoModels`（仅 MiniMax） |
| `FileManagementService` | [FileManagementService.ts](file:///d:/projects/ai-video-studio/src/domain/services/FileManagementService.ts) | `listFiles`, `deleteFile`（远程文件管理，仅 MiniMax） |
| `AssetLibraryService` | [AssetLibraryService.ts](file:///d:/projects/ai-video-studio/src/domain/services/AssetLibraryService.ts) | `saveImageFromUrl`（支持 data URI 规避 CORS）, `saveImageFromBlob`, `saveVideoFromBlob`, `saveVoiceFromUrl`, `savePrompt`, `compressImages`（replace/saveAsNew），路径约定 `images/{id}` / `audio/{id}` / `video/{id}.{ext}` |
| `SnapshotService` | [SnapshotService.ts](file:///d:/projects/ai-video-studio/src/domain/services/SnapshotService.ts) | `createSnapshot`, `autoSnapshot`（删除/重置前安全网）, `getSnapshots`, `renameSnapshot`（maxPerSpace=50） |

### 7.10 AI 增强服务

| 服务 | 文件 | 关键方法 |
|------|------|----------|
| `AgentService` | [AgentService.ts](file:///d:/projects/ai-video-studio/src/domain/services/AgentService.ts) | `chat(messages)`, `suggestActionPlan(userMessage)`（13 工具能力） |
| `CinematographyService` | [CinematographyService.ts](file:///d:/projects/ai-video-studio/src/domain/services/CinematographyService.ts) | `suggestShots`, `planStoryboard`, `enhancePromptWithShot`（9 种镜头类型 + 9 种运镜） |
| `BGMRecommendationService` | [BGMRecommendationService.ts](file:///d:/projects/ai-video-studio/src/domain/services/BGMRecommendationService.ts) | `recommend`, `recommendSequence`（保持情绪连贯）, `buildPrompt`（12 类 BGM） |
| `AutoEditService` | [AutoEditService.ts](file:///d:/projects/ai-video-studio/src/domain/services/AutoEditService.ts) | `detectKeyframes`（抽帧+Hamming 距离场景切换）, `suggestCuts`, `autoTrim` |

### 7.11 领域常量与错误

#### textLimits.ts

文件：[textLimits.ts](file:///d:/projects/ai-video-studio/src/domain/constants/textLimits.ts)

**设计原则**：
- `TEXT_LIMITS`（UI 层）：取跨平台最小兼容值，浏览器原生 maxLength 硬限制
- `ADAPTER_TEXT_LIMITS`（适配器层）：各平台官方硬限，slice 截断兜底防御
- **统一配置源**：UI/适配器/Service 层必须从本文件引用常量，禁止硬编码数字

**主要常量分组**：

| 模块 | TEXT_LIMITS 关键常量 |
|------|----------------------|
| 图像/视频 | `IMAGE_PROMPT_MAX=1500`, `VIDEO_PROMPT_MAX=2000` |
| TTS | `TTS_TEXT_MAX=10000`, `VOICE_CLONE_PROMPT_MAX=1500`, `VOICE_NAME_MAX=100` |
| 音乐 | `MUSIC_PROMPT_MAX=2000`, `MUSIC_LYRICS_MAX=3500` |
| 文本对话 | `CHAT_INPUT_MAX=8000`, `AGENT_INPUT_MAX=500` |
| 故事 | `STORY_TITLE_MAX=100`, `STORY_CONTENT_MAX=10000` |
| 角色/背景 | `CHAR_NAME_MAX=100`, `CHAR_APPEARANCE_MAX=1000` |
| 分镜 | `SEGMENT_ACTION_MAX=500`, `SUBTITLE_CLIP_TEXT_MAX=200` |
| 本地管理 | `SPACE_NAME_MAX=50`, `ASSET_NAME_MAX=100`, `LOG_SEARCH_MAX=100` |

**适配器层硬限**（部分）：
- `HUNYUAN_VIDEO_PROMPT_MAX=200`（最严格）
- `WAN_VIDEO_PROMPT_MAX=5000`（最宽松）
- `VOL_TTS_SYNC_MAX_BYTES=1024`（约 340 中文字）

#### UnsupportedCapabilityError

文件：[UnsupportedCapabilityError.ts](file:///d:/projects/ai-video-studio/src/domain/errors/UnsupportedCapabilityError.ts)

平台不支持指定能力时抛出的错误，携带平台名、能力名 + 可操作建议（推荐支持该能力的其他平台，最多 4 个）。

#### systemVoices.ts

文件：[systemVoices.ts](file:///d:/projects/ai-video-studio/src/domain/data/systemVoices.ts)

MiniMax 系统音色列表（约 80 个），按语言分组（zh/yue/en/ja/ko）。导出 `VOICES_BY_LANGUAGE` 和 `LANGUAGE_LABELS`。

---

## 8. 适配器层 (Adapters)

### 8.1 MiniMax 系列适配器（api/ 根目录）

**共性设计**：无共享 HttpClient，直接用 axios，每次方法调用都 `ApiConfigStore.load()` 读取最新配置。鉴权 `Authorization: Bearer {minimaxApiKey}` + `?group_id={minimaxGroupId}` query。错误处理通过 `MiniMaxErrorUtils.getMiniMaxErrorMessage`。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `MiniMaxVideoAdapter` | `IVideoGeneratorPort` | `/v1/video_generation`, `/v1/query/video_generation`, `/v1/files/retrieve`, `/v1/video_template_generation` | 4 模式 + Agent 模板 |
| `MiniMaxImageAdapter` | `IImageGeneratorPort` | `/v1/image_generation` | T2I / I2I，模型 image-01/image-01-live |
| `MiniMaxVoiceAdapter` | `IVoicePort` | `/v1/audio/speech`, `/v1/t2a_*`, `/v1/voice_clone/*`, `wss://api.minimaxi.com/ws/v1/t2a_v2` | 全能力（克隆/设计/删除/流式 WebSocket） |
| `MiniMaxMusicAdapter` | `IMusicPort` | `/v1/music_generation`, `/v1/lyrics_generation`, `/v1/music_cover_preprocess` | 音乐/歌词/翻唱 |
| `MiniMaxTextAdapter` | `ITextGenerationPort` | `/v1/chat/completions`（OpenAI 兼容）, `/anthropic/v1/messages`（Anthropic 兼容） | 同步/流式，支持 cache_control/thinking |
| `MiniMaxTextSplitterAdapter` | `ITextSplitterPort` | 通过 `ITextGenerationPort` 实现 | 智能降级（构造注入 fallback） |
| `MiniMaxStoryBreakdownAdapter` | `IStoryBreakdownPort` | 通过 `ITextGenerationPort` 实现 | 智能降级 |
| `MiniMaxModelAdapter` | `IModelManagementPort` | `/v1/models` | **硬编码 MiniMax，不接入 platformRouter** |
| `MiniMaxFileAdapter` | `IFileManagementPort` | `/v1/files/list`, `/v1/files/delete` | **硬编码 MiniMax，不接入 platformRouter** |
| `FFmpegAdapter` | `IFFmpegPort` | 本地 WASM | 浏览器端视频处理，@ffmpeg/ffmpeg 0.12.6 动态 import 懒加载 |
| `WhisperAdapter` | `IWhisperPort` | 占位 | `transcribe` 返回空数组（注释中标注三种可选实现方案） |
| `MockTextSplitter` | `ITextSplitterPort` | — | 按段落/句号/字符切分，模拟 2000ms 延迟 |
| `MockStoryBreakdown` | `IStoryBreakdownPort` | — | 启发式提取角色/背景，模拟 1000ms 延迟 |

### 8.2 火山引擎 Volcengine 适配器（api/volcengine/）

**共性设计**：共享 `VolcengineHttpClient`（构造注入 ApiConfig）。鉴权 `Authorization: Bearer {volcArkOpenAiApiKey}`，baseURL 统一为 `/volcengine-ark`（由 Vite proxy 智能 rewrite 分流到 `/api/plan/v3` 或 `/api/v3`），timeout 120s。图片/视频适配器使用 `createAgentPlan` 工厂方法。错误处理 `VolcengineApiError`（含 `httpStatus`/`errorCode`/`rawMessage`/`isRetryable`，仅 429 可重试）+ `withRetry`（指数退避，最多 3 次）。支持 SSE 流式（fetch + ReadableStream）。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `VolcengineVideoAdapter` | `IVideoGeneratorPort` | `POST /contents/generations/tasks`, `GET /contents/generations/tasks/{id}` | 模型 doubao-seedance-2-pro，content 数组含 text/image_url |
| `VolcengineImageAdapter` | `IImageGeneratorPort` | `POST /images/generations` | Agent Plan 套餐，模型 doubao-seedream-5.0-lite，支持 url/b64_json |
| `VolcengineTextAdapter` | `ITextGenerationPort` | `POST /chat/completions` | OpenAI 兼容，模型 doubao-pro-32k |
| `VolcengineVoiceAdapter` | `IVoicePort`（能力全闭，仅 TTS） | `POST /audio/speech`, `POST /audio/async/create`, `GET /audio/async/retrieve` | 模型 doubao-tts-base/pro/pro-max |

### 8.3 Hunyuan 适配器（api/hunyuan/）

**共性设计**：共享 `HunyuanHttpClient`。**鉴权方式最复杂 — TC3-HMAC-SHA256 签名**（腾讯云标准），基于 `SecretId + SecretKey` 派生签名密钥链（SecretDate → SecretService → SecretSigning → Signature），用 WebCrypto API 实现。所有 API 通过 `POST /` 发送，Action 通过 `X-TC-Action` 头指定。错误处理 `HunyuanApiError`，`isRetryable` 在 429/InternalError/RequestLimitExceeded 时为 true。

| 适配器 | 实现端口 | API Action | 说明 |
|--------|----------|-----------|------|
| `HunyuanVideoAdapter` | `IVideoGeneratorPort` | `SubmitHunyuanToVideoJob`, `QueryHunyuanVideoJob` | T2V (hunyuan-video) / I2V (hunyuan-video-i2v) |
| `HunyuanImageAdapter` | `IImageGeneratorPort` | `TextToImageLite` | 同步，ResultImage 为 base64 PNG |
| `HunyuanTextAdapter` | `ITextGenerationPort` | `ChatCompletions` | **流式降级为同步+逐字符推送**（每 2 字符 16ms 延迟） |
| `HunyuanVoiceAdapter` | `IVoicePort`（能力全闭） | `TextToVoice` | Audio 字段为 base64 编码音频 |

### 8.4 Kling 适配器（api/kling/）

**共性设计**：共享 `KlingHttpClient`。**鉴权方式 — JWT (HS256)**，AccessKey + SecretKey 派生，payload `{iss, exp: now+30min, nbf, iat}`，HTTP Header `Authorization: Bearer <JWT>`。JWT 内存缓存 30 分钟，请求拦截器自动注入最新 JWT。WebCrypto 实现 HMAC-SHA256。错误处理 `KlingApiError`，仅 429 可重试。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `KlingVideoAdapter` | `IVideoGeneratorPort` | `POST /v1/videos/text2video`, `POST /v1/videos/image2video`, `GET /v1/videos/.../{task_id}` | 模型 kling-v2.1/v2-master/v1.6，T2V/I2V/S2V |
| `KlingImageAdapter` | `IImageGeneratorPort` | `POST /v1/images/generations` | 模型 kling-v1 |

### 8.5 Vidu 适配器（api/vidu/）

**共性设计**：共享 `ViduHttpClient`。**鉴权方式 — `Authorization: Token {viduApiKey}`**（注意是 `Token` 前缀，非 Bearer）。错误处理 `ViduApiError`，仅 429 可重试。仅 `post`/`get` 方法，无 stream。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `ViduVideoAdapter` | `IVideoGeneratorPort` | `POST /v1/video/generations`, `GET /v1/videos/{id}` | 4 种 input.type（text/image/start_end_frame/reference），模型 viduq1/vidu-1/vidu-2 |
| `ViduImageAdapter` | `IImageGeneratorPort` | `POST /v1/images/generations` | OpenAI 兼容 |

### 8.6 Wan 适配器（api/wan/）

**共性设计**：共享 `WanHttpClient`。鉴权 `Authorization: Bearer {wanApiKey}`，异步任务附加 `X-DashScope-Async: enable` 头。错误处理 `WanApiError`，仅 429 可重试。OpenAI 兼容路径 `/compatible-mode/v1/chat/completions`。支持 SSE 流式。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `WanVideoAdapter` | `IVideoGeneratorPort` | `POST /services/aigc/video-generation/video-synthesis`, `GET /tasks/{task_id}` | 模型 wanx2.1-t2v-turbo/plus/i2v/vace |
| `WanImageAdapter` | `IImageGeneratorPort` | `POST /services/aigc/text2image/image-synthesis`, `GET /tasks/{task_id}` | **两步异步**：提交→轮询（2s 间隔，最多 60 次） |
| `WanTextAdapter` | `ITextGenerationPort` | `POST /compatible-mode/v1/chat/completions` | 模型 qwen-max/plus/turbo/long，支持 reasoning_content 思维链 |
| `WanVoiceAdapter` | `IVoicePort`（能力全闭） | `POST /services/aigc/text2audio` | 模型 cosyvoice-v1，base64 音频 |

### 8.7 Zhipu 适配器（api/zhipu/）

**共性设计**：共享 `ZhipuHttpClient`。鉴权 `Authorization: Bearer {zhipuApiKey}`。错误处理 `ZhipuApiError`，仅 429 可重试。支持 SSE 流式。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `ZhipuVideoAdapter` | `IVideoGeneratorPort` | `POST /videos/generations`, `GET /videos/generations/{id}` | 统一入口多模式：T2V cogvideox-2/flash, I2V/FL2V/S2V vidu2-* |
| `ZhipuImageAdapter` | `IImageGeneratorPort` | `POST /images/generations` | 模型 cogview-3-plus/cogview-3 |
| `ZhipuTextAdapter` | `ITextGenerationPort` | `POST /chat/completions` | 模型 glm-4-plus/air/flash/long |
| `ZhipuVoiceAdapter` | `IVoicePort`（能力全闭） | `POST /audio/speech` | **不使用 ZhipuHttpClient**（二进制音频流需 arraybuffer），模型 glm-tts |

### 8.8 Coze 适配器（api/coze/）

**共性设计**：共享 `CozeHttpClient`。鉴权 `Authorization: Bearer {cozePatToken}`（PAT）。响应 `{code, msg, data}` 包裹格式，`code !== 0` 时 reject。支持 SSE 流式。

| 适配器 | 实现端口 | API 端点 | 说明 |
|--------|----------|----------|------|
| `CozeBotAdapter` | `IBotPort` | `POST /v1/bots/create`, `POST /v1/bots/publish`, `POST /v1/space/published_bots_list`, `GET /v1/bots/{botId}` | Bot CRUD |
| `CozeDialogAdapter` | `IDialogPort` | `POST /v1/conversations/create`, `POST /v3/chat`, `GET /v3/chat/message/list` | 同步/流式对话 |

### 8.9 跨平台鉴权方式对比

| 平台 | 鉴权方式 | 配置字段 |
|------|----------|----------|
| MiniMax | Bearer API Key + group_id query | `minimaxApiKey` / `minimaxGroupId` |
| Volcengine | Bearer API Key | `volcArkOpenAiApiKey` / `volcArkAnthropicApiKey` |
| Hunyuan | TC3-HMAC-SHA256 签名（最复杂） | `hunyuanSecretId` / `hunyuanSecretKey` |
| Kling | JWT (HS256) 派生自 AccessKey+SecretKey | `klingAccessKey` / `klingSecretKey` |
| Vidu | Token API Key（注意非 Bearer） | `viduApiKey` |
| Wan | Bearer API Key + X-DashScope-Async | `wanApiKey` |
| Zhipu | Bearer API Key | `zhipuApiKey` |
| Coze | Bearer PAT Token | `cozePatToken` |

### 8.10 配置管理（config/）

#### ApiConfigStore + secureStorage

文件：[ApiConfigStore.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/config/ApiConfigStore.ts) / [secureStorage.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/config/secureStorage.ts)

**加密机制**：
- 算法：**AES-GCM 256**（认证加密，防篡改）
- 密钥派生：`PBKDF2` + `SHA-256`，**100,000 次迭代**
- 派生材料：应用密钥（固定常量）作 password + 设备指纹（navigator.userAgent+language+hardwareConcurrency+deviceMemory）作 salt
- 密文格式：`enc:v1:<base64(iv)>:<base64(ciphertext)>`
- 安全限制（设计上承认）：纯前端加密无法抵御具备完整同源执行能力的攻击者，但能防开发者工具直接查看明文 + XSS 读取明文 + 本地存储文件被直接查阅

**`ApiConfig` 字段**：覆盖 8 个平台（minimaxApiKey/GroupId/BaseUrl/AnthropicBaseUrl、volcArkOpenAiApiKey/AnthropicApiKey、cozePatToken/SpaceId、klingAccessKey/SecretKey、wanApiKey、hunyuanSecretId/SecretKey、zhipuApiKey、viduApiKey）+ `activePlatform` + `theme`。

**关键方法**：`init()`（启动时解密 localStorage 密文到 `_cache`，**必须在渲染前调用**）、`load()`、`save()`（异步加密持久化 + 脱敏日志）、`isPlatformConfigured()`、`getActivePlatform()`、`_migrateProxyPaths()`（代理路径迁移）、`_migrateLegacyVolcArkConfig()`（旧版火山方舟字段迁移）。

#### ApiConfigStoreAdapter

文件：[ApiConfigStoreAdapter.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/config/ApiConfigStoreAdapter.ts)

实现 `IApiConfigStore`，新增订阅能力（`onPlatformChange`/`onConfigChange`）与脱敏能力（`getApiKeyMasked`：前4+******+尾4，长度<12 全返回 12 个星号）。`getToken(platform)`：Kling/Hunyuan 返回 `${accessKey}|||${secretKey}` 复合格式。

#### LogViewerConfigStore

文件：[LogViewerConfigStore.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/config/LogViewerConfigStore.ts)

`ILogViewerConfigPort` 的 LocalStorage 实现，key: `ai_video_studio_log_viewer_config`。配置：`enabled`（默认 DEV=true/PROD=false）、`maxEntries`（默认 1000）、`defaultOpen`、`defaultLevel`。

### 8.11 横切关注点适配器（infrastructure/）

#### 日志系统（重点）

| 适配器 | 实现端口 | 说明 |
|--------|----------|------|
| `ConsoleLoggerAdapter` | `ILoggerPort` | 输出格式 `[ISO时间] [LEVEL] [service.method] message {context}`。**安全策略 redaction**：`SENSITIVE_KEY_RE` 匹配 key/token/secret/password/authorization/auth/cookie/credential/jwt → `[REDACTED]`；`SENSITIVE_VALUE_RE` 匹配 Bearer/sk-/ghp_ 长字符串 → `[REDACTED]`；递归处理嵌套对象（最大深度 5） |
| `CompositeLoggerAdapter` | `ILoggerPort` | 把多个 sink（ConsoleLogger + 任何 ILogSinkPort）合并，业务侧透明。`emit` 遍历 sinks 调用 `write`，**单个 sink 抛错被隔离** |
| `RingBufferLogSinkAdapter` | `ILogSinkPort` | UI 日志面板数据源。容量固定（默认 1000），FIFO 丢弃最旧。`write` 通过 `queueMicrotask` 异步触发订阅者 |
| `GlobalErrorCapture` | — | `installGlobalErrorCapture(sink)`：监听 `window.onerror` 和 `unhandledrejection`，写入 ILogSinkPort。返回 dispose 函数移除监听器（热重载时必须调用） |

#### 其他横切关注点

| 适配器 | 实现端口 | 说明 |
|--------|----------|------|
| `MemoryEventBusAdapter` | `IEventBus` | 单进程 pub/sub，handler 抛错被隔离。默认导出 `defaultEventBus` |
| `NoopMetricsAdapter` | `IMetricsPort` | 占位实现，Counter/Histogram 均 no-op |
| `DefaultResilienceAdapter` | `IResiliencePort` | `retry`（指数退避/线性退避）+ `withCircuitBreaker`（Open/Half-Open 两态） |
| `BrowserNetworkStatusAdapter` | `INetworkStatusPort` | 监听 online/offline + `navigator.connection.effectiveType`（slow-2g/2g → unstable） |
| `PlatformCapabilitiesAdapter` | `IPlatformCapabilitiesPort` | 封装 `PLATFORM_METADATA`，特殊能力规则：bot/dialog→coze |

### 8.12 仓储适配器（repositories/）

#### DexieDatabase（数据库定义 + 迁移历史）

文件：[DexieDatabase.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/repositories/DexieDatabase.ts)

**数据库名**：`AiVideoDatabase`，**当前版本 v12**，**15 张表**：

| 表名 | 索引字段 | 版本 |
|------|----------|------|
| `storySpaces` | `id`, `name`, `createdAt` | v3 |
| `characters` | `id`, `spaceId`, `name`, `createdAt` | v3 |
| `backgrounds` | `id`, `spaceId`, `name`, `createdAt` | v3 |
| `stories` | `id`, `spaceId`, `status`, `createdAt` | v3 |
| `segments` | `id`, `storyId`, `sequenceOrder` | v1 |
| `videoTasks` | `id`, `segmentId`, `status`, `createdAt` | v1 |
| `pipelineTasks` | `id`, `storyId`, `status`, `createdAt` | v7 |
| `finalCuts` | `id`, `storyId`, `pipelineTaskId`, `createdAt` | v7 |
| `savedImages` | `id`, `spaceId`, `name`, `sourceType`, `createdAt` | v8 |
| `savedVoices` | `id`, `spaceId`, `name`, `sourceType`, `createdAt` | v8 |
| `savedPrompts` | `id`, `spaceId`, `name`, `category`, `createdAt` | v8 |
| `savedVideos` | `id`, `spaceId`, `name`, `sourceType`, `createdAt` | v11 |
| `snapshots` | `id`, `spaceId`, `createdAt` | v9 |
| `timelines` | `id`, `storyId`, `createdAt`, `updatedAt` | v9 |
| `generatedFiles` | `id`, `spaceId`, `fileType`, `sourceEntityType`, `sourceEntityId`, `storagePath`, `createdAt`, `lastAccessedAt`, `compressedAt` | v10 |

**版本迁移历史**：

| 版本 | 变更 |
|------|------|
| v1 | 初始 5 张表 |
| v2 | character 加 `characterBackground` |
| v3 | 新增 `storySpaces` 表，所有实体加 `spaceId`，迁移到默认空间 |
| v4 | character 加 `voiceId` |
| v5 | segments 加 BGM 字段 |
| v6 | videoTasks 加 mode/model/resolution/duration |
| v7 | 新增 `pipelineTasks` 和 `finalCuts` |
| v8 | 新增 `savedImages`/`savedVoices`/`savedPrompts` 素材库 |
| v9 | 新增 `snapshots`/`timelines` |
| v10 | 新增 `generatedFiles`（OPFS 元数据） |
| v11 | 新增 `savedVideos` |
| v12 | generatedFiles 加压缩元数据（originalSize/compressedAt/compressionRatio） |

#### 仓储适配器

| 适配器 | 实现端口 | 说明 |
|--------|----------|------|
| `IndexedDBAdapters.ts`（7 个） | 7 个核心仓储 | 简单 CRUD + Dexie where 查询 |
| `AssetLibraryRepositories.ts`（4 个） | 4 个素材库仓储 | 统一 `AssetQueryParams`（spaceId+keyword+tags+sourceType） |
| `GeneratedFileRepository` | `IGeneratedFileRepository` | **元数据 vs 文件二进制分离**：Dexie 存元数据 + storagePath 指针，实际 Blob 由 IFileStoragePort 单独存储。LRU 淘汰：`findLeastRecentlyUsed` + `touchAccessTime` |
| `ModelCacheAdapter<T>` | `IModelCachePort<T>` | localStorage + TTL（默认 30 分钟），用 localStorage 因数据量小读多写少需同步访问 |
| `SnapshotRepositoryAdapter` | `ISnapshotRepository` | 含旧 localStorage→IndexedDB 数据迁移 |
| `TimelineRepositoryAdapter` | `ITimelineRepository` | save 自动设置 updatedAt |

### 8.13 文件存储降级链（storage/）

文件：[FileStorageAdapterFactory.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/storage/FileStorageAdapterFactory.ts)

**用户偏好**（来自 `localStorage.ai_vido_storage_preference`，默认 `'local'`）：
- `'local'`（默认）：`FilesLocalAdapter`（落盘到配置目录）
- `'opfs'`：`OPFSFileStorageAdapter`，浏览器不支持时直接抛错（**不再降级到 IndexedDB**）
- `'auto'`：依次探测 FilesLocal → OPFS

**降级链为 2 级：FilesLocal → OPFS**。文件以文件格式存储到配置目录或 OPFS，**不存入 IndexedDB**（IndexedDB 仅存元数据）。

| 适配器 | 实现端口 | 存储后端 | 关键特性 |
|--------|----------|----------|----------|
| `FilesLocalAdapter` | `IFileStoragePort` | 本地磁盘（Vite 插件路由） | 通过 HTTP 端点 POST/DELETE/HEAD/GET，无配额限制，`getObjectUrl` 返回 HTTP URL，`evictLRU` 返回 0 |
| `OPFSFileStorageAdapter` | `IFileStoragePort` | 浏览器 OPFS | 沙箱内，Chrome 86+/Safari 15.2+/Firefox 111+，默认配额 500MB，`getDirectoryHandle` 必须逐级行走，`getObjectUrl` 用 `createTrackedObjectUrl` |
| `IndexedDBFileStorageAdapter` | `IFileStoragePort` | IndexedDB | **工厂已不再降级使用**，仍可独立使用 |
| `OfflineCacheMigration` | — | 旧库→新文件存储 | 旧 `minimax-offline-cache` IndexedDB → OPFS，一次性迁移 |

### 8.14 Service → Port 包装适配器（services/）

| 适配器 | 包装的 Service | 实现的 Port | 用途 |
|--------|---------------|-------------|------|
| `AgentPortAdapter` | AgentService | IAgentPort | 把 `chat(messages)` 包装成 `chat(context)` |
| `AssetExportAdapter` | 7 个仓储 | IAssetExportPort | JSON 导出/导入空间数据 |
| `AutoEditPortAdapter` | AutoEditService | IAutoEditPort | 纯依赖反转包装 |
| `BGMPortAdapter` | BGMRecommendationService | IBGMRecommendationPort | 纯包装 |
| `CinematographyPortAdapter` | CinematographyService | ICinematographyPort | 纯转接头 |
| `PostProcessPortAdapter` | PostProcessService + TimelineRenderService + TimelineService | IPostProcessPort | **方法名翻译**：`mixBgm`→`mixBGM`；`exportFinalVideo` 通过 renderer+timelineService 实现真正渲染 |
| `SubtitlePortAdapter` | SubtitleService | ISubtitlePort | **方法名翻译**：`generateSrt`→`generateSrtFromSegments` |
| `TimelineRenderPortAdapter` | TimelineRenderService | ITimelineRenderPort | 纯包装 |

### 8.15 UI Port 适配器（ui/）

**事件桥模式**：模块级单例 + 事件总线，让非 React 上下文（Service 层）也能调用 UI 能力，Provider 内部订阅事件渲染。

| 适配器 | 实现的 Port | 事件桥 | 用途 |
|--------|-------------|--------|------|
| `I18nextTranslationAdapter` | ITranslationPort | `localeEventBus` | 包装 i18next，监听 `'languageChanged'` 转发 |
| `ReactConfirmAdapter` | IConfirmPort | `confirmEventBus` | `ask(input)` emit 请求，ConfirmProvider 弹框后 resolve |
| `ReactNotificationAdapter` | INotificationPort | `toastEventBus` | `toast(input)` emit 事件，ToastContext 显示 |
| `ReactThemeAdapter` | IThemePort | `themeEventBus` | 支持 dark/light/blue/warm 四主题 |

### 8.16 清晰度提升适配器（enhance/）

| 适配器 | 实现端口 | 算法原理 |
|--------|----------|----------|
| `CanvasImageEnhanceAdapter` | `IImageEnhancePort` | **算法链**：去噪（双边滤波，sigmaSpace=1.5）→ 放大（Canvas drawImage 高品质插值）→ 锐化（USM Unsharp Mask：`原图 + amount*(原图-3×3 高斯模糊图)`）。mode 决定步骤数 |
| `FFmpegVideoEnhanceAdapter` | `IVideoEnhancePort` | FFmpeg 抽帧 → 逐帧 CanvasImageEnhanceAdapter → FFmpeg 重编码（concat 帧 + trim 音频 + merge） |
| `PdfEnhanceAdapter` | `IPdfEnhancePort` | **CDN 动态加载** pdf.js + pdf-lib，高 DPI 渲染（scale=outputDpi/72）→ Canvas 增强 → pdf-lib 重新封装。保留原始页面尺寸 |

### 8.17 去水印适配器（inpaint/）

#### CanvasInpaintAdapter（6 种算法）

文件：[CanvasInpaintAdapter.ts](file:///d:/projects/ai-video-studio/src/adapters/outbound/api/inpaint/CanvasInpaintAdapter.ts)

| 算法 | 原理 |
|------|------|
| `fast_fill` | 选区四周边缘像素平均色填充，最快 |
| `edge_interpolation` | 从四条边向内双线性插值渐变，**推荐** |
| `texture_synthesis` | edge_interpolation 基础 + 外围采样带 + 随机噪声 |
| `telea` | **Telea 快速行进法**：按距离场由近及远填充，8 邻域按距离倒数加权 |
| `navier_stokes` | **Navier-Stokes 流体动力学**：求解拉普拉斯方程 ∇²I = 0，高斯-塞德尔迭代 50 次 |
| `content_aware` | **Content-Aware Fill / Patch-Match**：edge_interpolation 初始 + 7×7 patch 网格 + 随机采样 24 候选 + SSD 最小 + 3 次迭代传播 |

#### 视频去水印

| 适配器 | 模式 | 原理 |
|--------|------|------|
| `DelogoVideoInpaintAdapter` | fast | FFmpeg `delogo` 滤镜单次执行，时序与音频完全保留，仅支持矩形 |
| `FFmpegVideoInpaintAdapter` | quality | 探测 duration → 按 fps 抽帧 → 逐帧 CanvasInpaintAdapter（edge_interpolation）→ 提取原音频 → `encodeFromFrames` 重编码。**修复了原实现硬编码 duration=10 的致命缺陷** |

#### PDF/视频地址解析

| 适配器 | 实现端口 | 说明 |
|--------|----------|------|
| `PdfWatermarkAdapter` | `IPdfWatermarkPort` | pdf.js 渲染 → CanvasInpaintAdapter.inpaintRegion（edge_interpolation）→ pdf-lib 重新封装，regions 按 scale=renderDpi/72 缩放 |
| `DouyinVideoAddressResolver` | `IVideoAddressResolverPort` | 直链识别 + 抖音完整链接 `www.douyin.com/video/{id}` 解析为无水印直链。**抖音短链接 v.douyin.com/xxx 无法纯前端解析**（需后端跟随重定向） |
| `NotImplementedVideoAddressResolver` | `IVideoAddressResolverPort` | 占位实现，直接抛错 |

### 8.18 Vite 文件存储插件

文件：[filesStoragePlugin.ts](file:///d:/projects/ai-video-studio/vite/filesStoragePlugin.ts)

**插件名**：`ai-video-studio:files-storage`，`apply: 'serve'`（**仅 dev server，生产构建不注册**）

**提供的路由**：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/__files/upload?path=<dir>/<name>` | 写入 Blob 到磁盘（流式累计字节防 DoS） |
| DELETE | `/__files/delete?path=<>` | 删除文件 |
| HEAD | `/__files/exists?path=<>` | 检查存在性 |
| GET | `/__files/list?dir=<>` | 列出目录文件 |
| GET | `/__files/stats` | 聚合统计 |
| GET | `/__files/config` | 返回服务端配置 |
| POST | `/__files/config` | **运行时切换 rootDir**（含可选迁移） |
| GET | `/files/<dir>/<name>` | 静态访问（Cache-Control 1 小时） |

**安全**：`safeResolve` 禁止 `..`/绝对路径/协议前缀，防路径穿越。MIME 按扩展名映射。上传大小限制 50MB（可由 `FILES_MAX_SIZE_MB` 环境变量覆盖）。

---

## 9. 依赖注入容器 (Dependencies)

文件：[dependencies.ts](file:///d:/projects/ai-video-studio/src/dependencies.ts)

这是整个应用的组装层，负责实例化所有适配器和服务，并注入依赖关系。核心结构：

```
┌─ 仓储实例 ─────────────────────────────────────────┐
│ spaceRepo / characterRepo / storyRepo / segmentRepo │
│ backgroundRepo / videoTaskRepo / finalCutRepo         │
│ snapshotRepo / timelineRepo / generatedFileRepo       │
├─ 文件存储层（异步初始化） ─────────────────────────┤
│ initializeFileStorage() / getFileStorage()           │
│ createFileStorageAdapter（FilesLocal → OPFS）        │
├─ 横切关注点 ───────────────────────────────────────┤
│ logger（CompositeLogger + ConsoleSink + logSink）     │
│ eventBus / metrics / resilience                       │
├─ 基础设施实例 ─────────────────────────────────────┤
│ videoAdapter / imageAdapter / voiceAdapter            │
│ musicAdapter / textAdapter / modelAdapter            │
│ fileAdapter / ffmpegAdapter / whisperAdapter          │
├─ 智能降级实例 ─────────────────────────────────────┤
│ mockTextSplitter / mockStoryBreakdown                 │
│ smartTextSplitter = MiniMax + Mock 降级               │
│ smartStoryBreakdown = MiniMax + Mock 降级            │
├─ 创作域服务（注入 platformRouter + apiConfigStore）─┤
│ storyService / imageGenerationService                 │
│ textGenerationService / textLabService                │
├─ 视音频域服务 ──────────────────────────────────────┤
│ videoGenerationService / videoLabService              │
│ voiceService / musicService / musicLabService         │
│ postProcessService / subtitleService                  │
│ timelineService                                       │
├─ 管线服务 ──────────────────────────────────────────┤
│ pipelineService                                       │
├─ 空间 / 模型 / 文件管理 ────────────────────────────┤
│ storySpaceService / modelManagementService           │
│ fileManagementService                                 │
├─ AI 增强服务 ───────────────────────────────────────┤
│ agentService / autoEditService                        │
│ cinematographyService / bgmRecommendationService      │
├─ 素材库 ────────────────────────────────────────────┤
│ savedImageRepo / savedVoiceRepo / savedPromptRepo    │
│ savedVideoRepo / assetLibraryService                  │
├─ 时间线渲染 ────────────────────────────────────────┤
│ timelineRenderService                                 │
├─ 快照服务 ──────────────────────────────────────────┤
│ snapshotService                                       │
├─ Port 适配器（Service → Port 包装） ────────────────┤
│ agentPort / bgmPort / cinematographyPort              │
│ postProcessPort / subtitlePort                        │
│ timelineRenderPort / autoEditPort / assetExportPort   │
├─ UI 副作用 Port ────────────────────────────────────┤
│ notifier / confirmer / themePort                      │
│ translationPort / networkPort                         │
├─ 去水印适配器 ─────────────────────────────────────┤
│ imageInpaintAdapter / pdfWatermarkAdapter             │
│ qualityVideoInpaintAdapter / delogoVideoInpaintAdapter│
│ videoAddressResolver                                  │
└─ 清晰度提升适配器 ─────────────────────────────────┘
    imageEnhanceAdapter / pdfEnhanceAdapter / videoEnhanceAdapter
```

**关键设计点**：

1. **异步文件存储初始化**：`initializeFileStorage()` 必须在应用启动时调用（`main.tsx` 中并行调用），通过 `getFileStorage()` 同步获取。Service 通过 lazy accessor 模式支持应用启动时未完成初始化的场景
2. **PlatformRouter 共享单例**：所有生成类 Service（ImageGeneration/VideoGeneration/Voice/Music/Text/Agent/Cinematography/BGM/Pipeline）通过 `dependencies.ts` 注入共享 `platformRouter` 单例与 `apiConfigStoreAdapter`
3. **硬编码 MiniMax 例外**：`MiniMaxModelAdapter`/`MiniMaxFileAdapter`/`MiniMaxTextSplitterAdapter`/`MiniMaxStoryBreakdownAdapter`/`FFmpegAdapter`/`WhisperAdapter`/`MockTextSplitter`/`MockStoryBreakdown` 在 `dependencies.ts` 中硬编码实例化，不接入 platformRouter
4. **Port 适配器层**：把现有 Service 包装为 Port 契约，业务编排层（PipelineService 等）后续可通过这些 Port 注入

---

## 10. UI 层 (Presentation)

### 10.1 布局

文件：[MainLayout.tsx](file:///d:/projects/ai-video-studio/src/ui/layouts/MainLayout.tsx)

主布局组件，**侧边栏 4 个分组导航**：

| 分组 | 标识 | 包含导航项 |
|------|------|------------|
| 总览 | overview | Dashboard |
| 创作 | creation | CharacterManagement、BackgroundManagement、StoryWorkbench、VideoEditor |
| AI 实验室 | ai | ImageLab、VoiceLab、TextLab、VideoLab、MusicLab、WatermarkLab、EnhanceLab |
| 管理 | manage | StorySpaceManagement、ExportCenter、Settings |

**关键特性**：
- **能力矩阵禁用机制**：导航项根据 `platformCapabilities` 声明的能力动态禁用（如某平台不支持 fl2v/s2v，对应 Tab 禁用 + tooltip 提示）
- **Space Switcher**：侧边栏顶部空间切换器
- **Active Platform Badge**：显示当前激活的 AI 平台
- **Creation Flow 指示器**：创作流程引导
- **移动端响应式**：Drawer + 底部导航 5 项

### 10.2 React Contexts

| Context | 文件 | 说明 |
|---------|------|------|
| `SpaceContext` | [SpaceContext.tsx](file:///d:/projects/ai-video-studio/src/ui/contexts/SpaceContext.tsx) | 当前创作空间状态，localStorage 持久化（key: `ai_vido_current_space_id`），首次加载自动创建 'Default Space' |
| `ToastContext` | [ToastContext.tsx](file:///d:/projects/ai-video-studio/src/ui/contexts/ToastContext.tsx) | 全局消息提示，4 类型（success/error/info/warning），3.5s 自动消失，订阅 `toastEventBus` |
| `ConfirmContext` | [ConfirmContext.tsx](file:///d:/projects/ai-video-studio/src/ui/contexts/ConfirmContext.tsx) | 确认对话框，`confirm(options): Promise<boolean>`，订阅 `confirmEventBus` |
| `ThemeContext` | [ThemeContext.tsx](file:///d:/projects/ai-video-studio/src/ui/contexts/ThemeContext.tsx) | 4 主题（dark/light/blue/warm），从 ApiConfigStore 读取初始主题，setTheme 同步写入 |
| `theme-types.ts` | [theme-types.ts](file:///d:/projects/ai-video-studio/src/ui/contexts/theme-types.ts) | ThemeId/ThemeConfig/THEMES 数组（深邃暗夜/简约日光/静谧蓝海/暖阳赭石） |

### 10.3 自定义 Hooks（17 个）

| Hook | 文件 | 说明 |
|------|------|------|
| `useWorkbenchState` | [useWorkbenchState.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useWorkbenchState.ts) | StoryWorkbench 状态管理，**3 个领域 reducer**（breakdown/bgm/workbench）整合 30+ useState |
| `useSpaceScopedQuery` | [useSpaceScopedQuery.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useSpaceScopedQuery.ts) | 空间作用域查询（替代页面层直调 db），含 useSpaceScopedCharacters/Backgrounds/Stories/PipelineTasks、useStoryScopedSegments、useSegmentScopedVideoTasks |
| `useTimeline` | [useTimeline.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useTimeline.ts) | 时间线编排：加载/构建（buildFromStory 自动铺轨）+ 乐观更新 + 防抖保存（800ms）+ 导出（调用 ITimelineRenderPort.render） |
| `useVideoTaskPolling` | [useVideoTaskPolling.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useVideoTaskPolling.ts) | 视频任务轮询（5s 间隔，最多 120 次） |
| `usePolling` | [usePolling.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/usePolling.ts) | 通用轮询 Hook |
| `useVideoImport` | [useVideoImport.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useVideoImport.ts) | 视频上传导入：校验→探测元数据→抽帧缩略图（25% 位置）→落盘 |
| `useLinkImport` | [useLinkImport.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useLinkImport.ts) | 视频链接导入：解析→下载→探测→抽帧→落盘，支持平台识别（direct/douyin/bilibili 等） |
| `useBatchImageInpaint` | [useBatchImageInpaint.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useBatchImageInpaint.ts) | 批量图片去水印：多文件管理 + 统一选区 + 并发数 1/3/5 + 重试 |
| `useWatermarkRemoval` | [useWatermarkRemoval.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useWatermarkRemoval.ts) | 去水印处理：3 类型（image/pdf/video）+ **自动重试 + 备选算法链**（FALLBACK_ALGORITHMS） |
| `useEnhancement` | [useEnhancement.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useEnhancement.ts) | 清晰度提升：3 类型 + **自动重试（maxRetries=2）** + 备选算法链 |
| `useSavedAssets` | [useSavedAssets.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useSavedAssets.ts) | 素材查询（useSavedImages/Voices/Prompts/Videos） |
| `useAssetPicker` | [useAssetPicker.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useAssetPicker.ts) | 素材选择器状态管理 |
| `useStreamingAudioPlayer` | [useStreamingAudioPlayer.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useStreamingAudioPlayer.ts) | 流式音频播放：MediaSource API + SourceBuffer，降级到 Blob 累积 + Audio |
| `useNetworkStatus` | [useNetworkStatus.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useNetworkStatus.ts) | 网络状态监听 |
| `useObjectUrl` | [useObjectUrl.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useObjectUrl.ts) | Blob → Object URL 自动管理（useMemo + cleanup revoke） |
| `useSharedForm` | [useSharedForm.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useSharedForm.ts) | 共享图片上传逻辑（3 模式：url/upload/generate） |
| `useLogStore` | [useLogStore.ts](file:///d:/projects/ai-video-studio/src/ui/hooks/useLogStore.ts) | 日志存储：初始 snapshot + subscribe 增量 + 筛选（级别/服务/关键字） |

### 10.4 通用组件（47 个文件）

#### LogViewer 子目录（7 个）

| 组件 | 说明 |
|------|------|
| `LogViewerContainer` | 日志面板容器：FAB + Drawer + 快捷键 `Ctrl/Cmd + \`` |
| `LogViewerDrawer` | 抽屉：可拖拽调整高度，**react-window FixedSizeList 虚拟滚动**（1000+ 条稳定） |
| `LogViewerFab` | 悬浮按钮：未读错误显示红点 + 数量徽标 |
| `LogToolbar` | 工具栏：自动滚动、复制、导出 .txt、清空 |
| `LogFilterBar` | 筛选栏：关键字搜索 + 级别 chip + 服务下拉 |
| `LogEntryRow` | 单条日志行：默认折叠 context/error.stack，单击展开 |
| `logFormatter` | 日志格式化工具 + **redactContext 脱敏** |

#### 其他组件（40 个）

| 组件 | 文件 | 说明 |
|------|------|------|
| `AgentChatPanel` | [AgentChatPanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/AgentChatPanel.tsx) | AI 助手对话面板，4 个快捷操作 |
| `PipelinePanel` | [PipelinePanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/PipelinePanel.tsx) | 管线流程面板，10 阶段状态机 |
| `StoryListPanel` | [StoryListPanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/StoryListPanel.tsx) | 故事列表 |
| `SegmentCard` | [SegmentCard.tsx](file:///d:/projects/ai-video-studio/src/ui/components/SegmentCard.tsx) | **React.memo** 分镜卡片 |
| `TimelineEditor` | [TimelineEditor.tsx](file:///d:/projects/ai-video-studio/src/ui/components/TimelineEditor.tsx) | **React.memo** 时间线编排：3 轨道排序、缩放（20-240 pxPerSecond）、8px 吸附 |
| `VideoTaskCard` | [VideoTaskCard.tsx](file:///d:/projects/ai-video-studio/src/ui/components/VideoTaskCard.tsx) | **React.memo** 视频任务卡片 |
| `VideoCompare` | [VideoCompare.tsx](file:///d:/projects/ai-video-studio/src/ui/components/VideoCompare.tsx) | 视频版本对比 |
| `BGMPanel` | [BGMPanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/BGMPanel.tsx) | BGM 编辑面板，4 模式 + 5 风格预设 |
| `BreakdownPreview` | [BreakdownPreview.tsx](file:///d:/projects/ai-video-studio/src/ui/components/BreakdownPreview.tsx) | 一键分解预览 |
| `CameraDirectivePanel` | [CameraDirectivePanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/CameraDirectivePanel.tsx) | 运镜指令面板，7 组 15 种指令 |
| `PostProductionPanel` | [PostProductionPanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/PostProductionPanel.tsx) | 后期处理面板，6 工具 |
| `ImageGallery` | [ImageGallery.tsx](file:///d:/projects/ai-video-studio/src/ui/components/ImageGallery.tsx) | 图片画廊 |
| `ImageUploadField` / `AudioUploadField` / `VideoUploadField` | — | 上传字段组件 |
| `ImageAdvancedSettings` | [ImageAdvancedSettings.tsx](file:///d:/projects/ai-video-studio/src/ui/components/ImageAdvancedSettings.tsx) | 图片高级设置 |
| `AudioPreviewPlayer` | [AudioPreviewPlayer.tsx](file:///d:/projects/ai-video-studio/src/ui/components/AudioPreviewPlayer.tsx) | 音频预览（Canvas 波形 + 自动重试 MAX_RETRY=2 + 延迟错误显示 3000ms） |
| `LyricsDisplay` | [LyricsDisplay.tsx](file:///d:/projects/ai-video-studio/src/ui/components/LyricsDisplay.tsx) | 歌词展示，17 种结构标签高亮 |
| `AssetPicker` | [AssetPicker.tsx](file:///d:/projects/ai-video-studio/src/ui/components/AssetPicker.tsx) | 素材选择器弹窗，3 类型，图源缺失红色提示卡 |
| `BatchCompressDialog` | [BatchCompressDialog.tsx](file:///d:/projects/ai-video-studio/src/ui/components/BatchCompressDialog.tsx) | 批量图片压缩对话框 |
| `ThinkingBlock` | [ThinkingBlock.tsx](file:///d:/projects/ai-video-studio/src/ui/components/ThinkingBlock.tsx) | AI 思考过程展示 |
| `TokenUsageBar` | [TokenUsageBar.tsx](file:///d:/projects/ai-video-studio/src/ui/components/TokenUsageBar.tsx) | Token 用量展示 |
| `LanguageSwitcher` | [LanguageSwitcher.tsx](file:///d:/projects/ai-video-studio/src/ui/components/LanguageSwitcher.tsx) | 语言切换器，10 种语言 |
| `ErrorBoundary` | [ErrorBoundary.tsx](file:///d:/projects/ai-video-studio/src/ui/components/ErrorBoundary.tsx) | 错误边界，2 种 variant（root/route），componentDidCatch 写入 logSink |
| `PageSkeleton` | [PageSkeleton.tsx](file:///d:/projects/ai-video-studio/src/ui/components/PageSkeleton.tsx) | 路由级骨架屏 |
| `AsyncState` | [AsyncState.tsx](file:///d:/projects/ai-video-studio/src/ui/components/AsyncState.tsx) | 统一异步状态组件（3 种 loading 子态 + error + empty） |
| `LabPageLayout` | [LabPageLayout.tsx](file:///d:/projects/ai-video-studio/src/ui/components/LabPageLayout.tsx) | 实验室页面统一布局 |
| `InputWithCounter` / `TextAreaWithCounter` | — | **软限制模式**：不透传 maxLength，超限时计数器变红 + 提示 |
| `SavedRecordsPanel` | [SavedRecordsPanel.tsx](file:///d:/projects/ai-video-studio/src/ui/components/SavedRecordsPanel.tsx) | 已保存记录面板 |
| enhance/ | `EnhanceCompare`、`EnhanceParts`（EnhanceUploadZone / EnhanceParamSlider / EnhanceProgressBar / EnhanceRetryHint / EnhanceActionButtons / EnhanceAsyncWrapper） | 增强模块零件集合 |
| settings/ | `FormField`、`PlatformSelect`、`SettingsSection`、`StatusBadge`、`ThemeSelector`、`ValidationButton` | 设置页组件 |
| watermark/ | `InpaintPreview`、`RegionSelector`（矩形框选 + 自由涂抹） | 去水印组件 |

---

## 11. 路由与页面

文件：[App.tsx](file:///d:/projects/ai-video-studio/src/App.tsx)

### 11.1 路由表

| 路径 | 页面组件 | 导航分组 | 说明 |
|------|----------|----------|------|
| `/` | `Dashboard` | 总览 | 仪表盘，5 步引导 + 统计 + 快捷入口 |
| `/characters` | `CharacterManagement` | 创作 | 角色管理 |
| `/backgrounds` | `BackgroundManagement` | 创作 | 场景背景管理 |
| `/workbench` | `StoryWorkbench` | 创作 | 故事工作台（核心创作入口） |
| `/spaces` | `StorySpaceManagement` | 管理 | 空间管理 |
| `/spaces/:id` | `SpaceDetailPage` | — | 空间详情（4 Tab） |
| `/export` | `ExportCenter` | 创作 | 导出中心 |
| `/labs/image` | `ImageLab` | AI 实验室 | 图片生成实验室（t2i/i2i） |
| `/labs/voice` | `VoiceLab` | AI 实验室 | 音色与配音实验室（5 Tab） |
| `/labs/text` | `TextLab` | AI 实验室 | 文本润色实验室（chat/refine/models） |
| `/labs/video` | `VideoLab` | AI 实验室 | 视频生成实验室（6 Tab：t2v/i2v/fl2v/s2v/agent/tasks） |
| `/labs/music` | `MusicLab` | AI 实验室 | 音乐生成实验室（compose/lyrics/cover） |
| `/labs/watermark` | `WatermarkLab` | AI 实验室 | 去水印实验室（image/pdf/video，浏览器端本地处理） |
| `/labs/enhance` | `EnhanceLab` | AI 实验室 | 清晰度提升实验室（image/pdf/video，浏览器端本地处理） |
| `/editor` | `VideoEditor` | 创作 | 视频剪辑工作台（URL 参数 `?storyId=xxx`） |
| `/settings` | `Settings` | 管理 | 设置（8 平台配置 + 模型/文件/存储/缓存管理） |

### 11.2 应用启动序列

```
main.tsx bootstrap()
       │
       ▼
并行初始化：
  ① ApiConfigStore.init()  — 解密 localStorage 密文到内存缓存
  ② initializeFileStorage() — createFileStorageAdapter（FilesLocal → OPFS）
       │
       ▼
createRoot().render(<App />)
       │
       ▼
React.useEffect:
  ① videoGenerationService.resumeActivePolling()  — 恢复活跃任务轮询
  ② installGlobalErrorCapture(logSink)             — 全局错误捕获
  ③ preloadCriticalChunks()                         — requestIdleCallback 预加载高频页面
```

### 11.3 路由代码分割策略

- 所有页面 `lazy()` 动态 import，首屏只下载当前路由 chunk
- `preloadCriticalChunks()` 在浏览器空闲时预加载 StoryWorkbench/ExportCenter/CharacterManagement chunk
- 配合 Vite `manualChunks` vendor 拆分（vendor-react/vendor-router/vendor-i18n/vendor-icons/vendor-db/vendor-http/vendor-ffmpeg）

### 11.4 页面功能详解

| 页面 | 文件 | 核心功能 |
|------|------|----------|
| `Dashboard` | [Dashboard.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/Dashboard.tsx) | 5 步引导卡片 + AI 实验室快捷入口 + 视频任务统计 + 最近故事 |
| `CharacterManagement` | [CharacterManagement.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/CharacterManagement.tsx) | 角色 CRUD + 图片三模式（URL/上传/AI 生成）+ 音色克隆/设计 + AI 润色 + 跨空间复制 |
| `StoryWorkbench` | [StoryWorkbench.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/StoryWorkbench.tsx) | **核心工作台**：3 reducer + 故事 CRUD + 分镜拆分 + 一键分解 + 视频批量生成 + 旁白轮询 + BGM + 一键合成 |
| `VideoEditor` | [VideoEditor.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/VideoEditor.tsx) | 视频剪辑工作台，子组件拆到 editor/ 目录（EditorToolbar/ExportModal/InspectorPanel/MediaPanel/PreviewStage） |
| `Settings` | [Settings.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/Settings.tsx) | 8 平台配置 + 模型管理 + 文件管理 + 本地存储配置 + 媒体缓存 |
| `WatermarkLab` | [WatermarkLab.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/WatermarkLab.tsx) | 3 Tab（image/pdf/video）+ 完全浏览器端本地处理 + 6 种算法 + 批量并发 |
| `EnhanceLab` | [EnhanceLab.tsx](file:///d:/projects/ai-video-studio/src/ui/pages/EnhanceLab.tsx) | 3 Tab（image/pdf/video），子面板拆到 enhance/ 目录 |

---

## 12. 国际化 (i18n)

文件：[i18n.ts](file:///d:/projects/ai-video-studio/src/i18n.ts)

### 支持语言（10 种）

| 代码 | 语言 | 原生名称 |
|------|------|----------|
| `en` | English | English |
| `zh` | Chinese (Simplified) | 简体中文 |
| `ja` | Japanese | 日本語 |
| `ko` | Korean | 한국어 |
| `es` | Spanish | Español |
| `fr` | French | Français |
| `de` | German | Deutsch |
| `ru` | Russian | Русский |
| `pt` | Portuguese | Português |
| `it` | Italian | Italiano |

### 配置

- **回退语言**：`en`
- **语言检测顺序**：`localStorage` → `navigator` → `htmlTag`
- **缓存**：`localStorage` (key: `i18nextLng`)
- **资源加载**：静态 import 各语言 JSON（无 HTTP 请求）
- **翻译完整性校验**：`scripts/i18n-check.mjs` 以 `zh` 为基准对比其他 9 种语言，`--strict` 模式缺失键时 exit 1

---

## 13. 数据持久化 (IndexedDB + OPFS)

### 13.1 双层存储架构

本项目采用 **元数据 / 文件二进制分离** 的存储架构：

```
┌──────────────────────────────────────────────────────────┐
│              IndexedDB (Dexie AiVideoDatabase)             │
│                                                            │
│  ┌─ 核心业务表（7 张） ─────────────────────────────┐    │
│  │ storySpaces / characters / backgrounds / stories  │    │
│  │ segments / videoTasks / pipelineTasks / finalCuts  │    │
│  ├─ 素材库表（4 张） ─────────────────────────────────┤    │
│  │ savedImages / savedVoices / savedPrompts          │    │
│  │ savedVideos                                         │    │
│  ├─ 编排表（2 张） ───────────────────────────────────┤    │
│  │ snapshots / timelines                               │    │
│  └─ 文件元数据表（1 张） ───────────────────────────┤    │
│  │ generatedFiles（storagePath 指针 + LRU 字段）      │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                          │
                          │ storagePath 指针
                          ▼
┌──────────────────────────────────────────────────────────┐
│              File Binary Storage (IFileStoragePort)        │
│                                                            │
│  ┌─ FilesLocal（默认） ─────────────────────────────┐    │
│  │ 本地磁盘 docs/files/{images,audio,video,other}/   │    │
│  │ 通过 Vite 插件 HTTP 端点存取，无配额限制           │    │
│  ├─ OPFS（降级） ────────────────────────────────────┤    │
│  │ 浏览器 Origin Private File System 沙箱内          │    │
│  │ Chrome 86+/Safari 15.2+/Firefox 111+，配额 500MB  │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 13.2 LRU 淘汰机制

- `GeneratedFileRepository.findLeastRecentlyUsed(limit)` 按 `lastAccessedAt` 升序返回
- `GeneratedFileRepository.touchAccessTime(id)` 访问时更新
- `IFileStoragePort.evictLRU(maxSizeBytes)` 按目标大小淘汰，返回释放字节数

### 13.3 OPFS 持久化贯穿全程（Phase 2-A/B/C）

| Phase | 持久化对象 | 存储路径 | 用途 |
|-------|----------|----------|------|
| 2-A | 旁白音频 | `audio/narration_{segmentId}.mp3` | segment.narrationAudioStoragePath |
| 2-B | 视频 | `video/{taskId}.mp4` | videoTask.videoStoragePath（>200MB 跳过） |
| 2-B | BGM 音频 | `audio/bgm_{segmentId}.mp3` | segment.bgmStoragePath |
| 2-C | 角色参考图 | `images/{characterId}.png` | character.referenceImageStoragePath |
| 2-C | 背景参考图 | `images/{backgroundId}.png` | background.referenceImageStoragePath |
| 2-C | 成片缩略图 | `thumbnails/{finalCutId}.jpg` | finalCut.thumbnailStoragePath |
| 2-C | 最终成片 | `video/{finalCutId}.mp4` | finalCut.videoStoragePath（消除 videoBlob 庞大对 Dexie 的压力） |

---

## 14. 工具与基础设施

### 14.1 通用工具 (src/utils/)

| 文件 | 说明 |
|------|------|
| [offlineCache.ts](file:///d:/projects/ai-video-studio/src/utils/offlineCache.ts) | 旧 IndexedDB 离线缓存（DB: `minimax-offline-cache`，LRU 淘汰 500MB/200 条），`getOrFetch` |
| [cacheMonitor.ts](file:///d:/projects/ai-video-studio/src/utils/cacheMonitor.ts) | 文本生成缓存命中率监控（localStorage 持久化 + 订阅器模式），`recordTextGenUsage` Helper |
| [imageCache.ts](file:///d:/projects/ai-video-studio/src/utils/imageCache.ts) | 主线程 CacheStorage 媒体缓存，**`isSWActive()` 始终返回 false**（SW 已按设计约束移除） |
| [objectUrlRegistry.ts](file:///d:/projects/ai-video-studio/src/utils/objectUrlRegistry.ts) | Object URL 统一追踪注册表：`createTrackedObjectUrl` / `revokeAllTrackedObjectUrls` + beforeunload 兜底释放 |
| [retryUtils.ts](file:///d:/projects/ai-video-studio/src/utils/retryUtils.ts) | 智能重试：`retryWithBackoff`（指数退避 + jitter + AbortSignal），`isRetryableError`（不可重试：authentication/api_key/forbidden/insufficient_balance；可重试：timeout/5xx/429/network） |

### 14.2 UI 工具 (src/ui/utils/)

| 文件 | 说明 |
|------|------|
| [errorUtils.ts](file:///d:/projects/ai-video-studio/src/ui/utils/errorUtils.ts) | `getErrorMessage(e, fallback)` 统一错误消息提取 |
| [imageCompress.ts](file:///d:/projects/ai-video-studio/src/ui/utils/imageCompress.ts) | 主线程 Canvas 图片压缩（近无损策略，PNG 透明图自动保留），**logger.info 打印入参/出参** |
| [imageUtils.ts](file:///d:/projects/ai-video-studio/src/ui/utils/imageUtils.ts) | `fileToBase64`、`validateImageFile`（JPG/PNG/WebP + 20MB 限制） |
| [validateTextLimit.ts](file:///d:/projects/ai-video-studio/src/ui/utils/validateTextLimit.ts) | `validateTextLimit` 单字段 + `validateTextLimits` 批量，**不做截断**，超限 toast 提示 |
| [videoAddress.ts](file:///d:/projects/ai-video-studio/src/ui/utils/videoAddress.ts) | `detectVideoAddressType`（direct/share/local）、`fetchVideoAsFile` |

### 14.3 关键设计模式

#### 软限制文本输入模式（贯穿全项目）

- **不在原生 input/textarea 上透传 maxLength**（不阻止输入）
- **超限时**：计数器变红 + 边框变红 + 提示文本
- **提交时**：调用 `validateTextLimit` 拦截，超限则 toast 警告并阻止提交
- **常量集中管理**：`TEXT_LIMITS`（UI 跨平台最小）+ `ADAPTER_TEXT_LIMITS`（平台硬限制）

#### Blob URL 生命周期管理（三重保障）

1. **组件级**：`useObjectUrl` hook（useMemo + cleanup）
2. **跨层级**：`objectUrlRegistry`（beforeunload 兜底）
3. **页面级**：Lab 页面内 `registerBlobUrl` / `revokeBlobUrl` ref Set 管理

#### 性能优化

- **react-window 虚拟滚动**：LogViewerDrawer FixedSizeList（1000+ 条稳定）
- **React.memo**：SegmentCard、TimelineEditor、VideoTaskCard、LogEntryRow
- **Dexie useLiveQuery**：响应式查询替代手动 refetch
- **动态 import**：FFmpeg 模块按需加载、路由 chunk 拆分

---

## 15. 核心业务流程

### 15.1 一键成片流程 (Pipeline)

```
用户输入故事文本
       │
       ▼
  ┌─────────┐    AI 拆分    ┌──────────────┐
  │  Story   │ ──────────► │ StorySegments │
  │ (DRAFT)  │             │   (SPLIT)     │
  └─────────┘              └──────┬───────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ 生成图片  │ │ 生成旁白  │ │ 生成 BGM  │
             │(Image API)│ │(Voice API)│ │(Music API)│
             └────┬─────┘ └────┬─────┘ └────┬─────┘
                  │            │             │
                  └─────────────┼─────────────┘
                                ▼
                        ┌──────────────┐
                        │  生成视频     │
                        │ (Video API)  │
                        │ T2V/I2V/S2V  │
                        └──────┬───────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
             ┌──────────┐ ┌────────┐ ┌──────────┐
             │后期合成   │ │字幕生成 │ │字幕烧录  │
             │(FFmpeg)  │ │(Whisper)│ │(FFmpeg)  │
             └────┬─────┘ └───┬────┘ └────┬─────┘
                  │           │           │
                  └───────────┼───────────┘
                              ▼
                      ┌──────────────┐
                      │  FinalCut    │
                      │  (成片导出)   │
                      └──────────────┘
```

### 15.2 视频生成模式

| 模式 | 说明 | 输入 |
|------|------|------|
| `t2v` | 文本生成视频 | 文本 Prompt |
| `i2v` | 图片生成视频 | 首帧图片 + Prompt |
| `fl2v` | 首尾帧生成视频 | 首帧图片 + 尾帧图片 + Prompt |
| `s2v` | 主体参考生成视频 | 角色参考图 + Prompt |

### 15.3 多平台路由流程

```
UI 调用 Service 方法
       │
       ▼
Service 调用 PlatformRouter.resolveVideo/Image/Text/Voice/Music(config)
       │
       ▼
ensureCap(platform, capability) — 不支持抛 UnsupportedCapabilityError
       │
       ▼
检查适配器实例缓存（isMatchingPlatform 比对类名前缀）
       │
       ├─ 命中缓存 → 返回缓存实例
       │
       └─ 未命中 → switch(config.activePlatform) 实例化对应平台适配器
                   │
                   ▼
              调用适配器方法（API Key 从 IApiConfigStore 读取）
                   │
                   ▼
              平台切换时 PlatformRouter.reset() 清空缓存
```

### 15.4 时间线渲染流程

```
VideoEditor 页面
       │
       ▼
useTimeline Hook
  ├─ 加载时间线（loadByStoryId）
  ├─ 无则 buildFromStory 自动铺轨（4 轨：video/narration/bgm/subtitle）
  ├─ 乐观更新（updateTimeline）+ 防抖保存（800ms）
  │
       ▼
导出按钮 → ExportModal
       │
       ▼
ITimelineRenderPort.render(timeline, options, onProgress)
       │
       ▼
TimelineRenderService
  ① 加载 FFmpeg
  ② 解析视频轨 clips sourceRef → Blob（含入出点裁切）
  ③ 视频轨转场 + concat
  ④ 音频混音 → merge
  ⑤ 字幕烧录
  ⑥ 后处理 resize/compress/convertFormat
       │
       ▼
返回 Blob → 下载 render-{timestamp}.mp4
```

### 15.5 依赖关系图

```
PipelineService
├── StoryRepository ─────────► 加载故事
├── StorySegmentRepository ──► 加载/保存分镜
├── CharacterRepository ─────► 查找角色
├── BackgroundRepository ────► 查找背景
├── VideoTaskRepository ─────► 保存视频任务
├── FinalCutRepository ──────► 保存成片
├── PlatformRouter ──────────► 多平台路由（视频/图片/语音/音乐/文本）
│   ├── IVideoGeneratorPort
│   ├── IImageGeneratorPort
│   ├── IVoicePort
│   ├── IMusicPort
│   └── ITextGenerationPort
├── PostProcessService ──────► FFmpeg 后期
│   ├── IFFmpegPort
│   └── IWhisperPort
├── SubtitleService ─────────► 字幕生成
│   ├── IWhisperPort
│   └── ITextGenerationPort
├── IFileStoragePort ────────► OPFS 文件持久化
├── ILoggerPort ─────────────► 结构化日志
├── IEventBus ───────────────► 领域事件
└── IApiConfigStore ─────────► API 配置
```

---

## 16. 项目运行方式

### 16.1 环境要求

- Node.js >= 18
- npm >= 9

### 16.2 一键启动（推荐）

跨平台启动脚本，自动检测环境 + 安装依赖 + 启动 Vite dev server：

```bash
# Windows
scripts\start.bat           # CMD（GBK 编码）
powershell -ExecutionPolicy Bypass -File scripts\start.ps1

# Linux / macOS
bash scripts/start.sh

# 通用入口（需已安装 Node.js）
npm start                   # node scripts/lib/run-dev.mjs
```

**启动流程**（`scripts/lib/run-dev.mjs`）：

```
start.sh / start.ps1 / start.bat
            │
            ▼
   node lib/run-dev.mjs
            │
   ┌────────┴────────┐
   │ 1. env-check    │  检测 node/npm/project/deps/port/disk/network
   │ 2. .env init    │  生成默认 .env（如不存在）
   │ 3. install-deps │  npm ci 优先，失败降级 npm install
   │ 4. port check   │  isPortFree → findFreePort
   │ 5. vite start   │  vite --no-open，解析 stdout 提取实际端口
   └────────┬────────┘
            │
            ▼
   自动打开浏览器到实际端口
            │
            ▼
   SIGINT/SIGTERM → 优雅退出（清理子进程）
```

### 16.3 开发命令

```bash
# 安装依赖
npm install

# 开发模式（直接 Vite，跳过启动脚本的环境检测）
npm run dev

# 生产构建（tsc 类型检查 + Vite 打包）
npm run build

# 预览生产构建
npm run preview

# 代码检查
npm run lint
npm run lint:fix

# 类型检查
npm run typecheck

# 单元测试
npm test
npm run test:watch
npm run test:coverage

# 国际化完整性校验
npm run i18n:check
npm run i18n:check:strict
```

### 16.4 开发环境配置

1. 启动开发服务器后，访问控制台输出的 URL（默认 `http://localhost:5173/ai-video-studio/`）
2. 进入 **设置页面** (`/settings`) 配置：
   - 选择激活平台（默认 MiniMax）
   - 配置对应平台的 API Key（敏感配置会通过 AES-GCM 加密后存入 localStorage）
   - 可选：配置自建反代地址（解决 CORS 问题）

### 16.5 本地文件存储配置

`.env` 文件（Vite 自动读取）：

```bash
# 本地文件保存根目录（相对 Vite 项目根，默认 docs/files）
FILES_DIR=docs/files

# 单次上传最大字节数（MB，默认 50，大文件场景建议调大到 200+）
# FILES_MAX_SIZE_MB=50
```

修改后需重启 Vite dev server。也支持运行时通过 POST `/__files/config` 切换 rootDir。

### 16.6 合并到 GitHub 前的检查

```bash
npm run lint
npm run typecheck
npm run test
```

---

## 17. 关键设计决策与约束

### 17.1 架构耦合点（已知妥协）

- `PlatformId` 与 `ApiConfig` 类型定义在 `adapters/outbound/config/ApiConfigStore.ts`，被 domain 多处 import。这是已知架构妥协
- Timeline 相关实体定义在 `ports/PostProcessPorts.ts`，SpaceSnapshot 定义在 `ports/PersistencePorts.ts`，按所属端口就近定义
- 两套 Capability 类型：`services/platformCapabilities.ts` 的 `Capability`（7 种）用于 UI 能力摘要，`ports/PlatformPorts.ts` 的 `PlatformCapability`（12 种）用于 Port 契约

### 17.2 用户规则落地

**用户规则**："所有接口出入参数都通过日志打印出来"

落地方式：
- **横切关注点端口**：`CrossCuttingPorts.ILoggerPort` + `LoggingPorts.ILogSinkPort` 体系支撑
- **各 Service 普遍注入 `ILoggerPort`**：在关键方法入口/出口打印 `LogContext`（含 service/method/taskId/spaceId 等结构化字段）
- **ConsoleLoggerAdapter 安全脱敏**：`SENSITIVE_KEY_RE`（key/token/secret/password/authorization/auth/cookie/credential/jwt）→ `[REDACTED]`；`SENSITIVE_VALUE_RE`（Bearer/sk-/ghp_ 长字符串）→ `[REDACTED]`
- **ApiConfigStore.save 脱敏日志**：仅输出 activePlatform 和各平台是否已配置的布尔值，不输出 Key 内容
- **明确遵循该规则的文件**：`src/ui/utils/imageCompress.ts`、`src/ui/contexts/SpaceContext.tsx`、`scripts/lib/run-dev.mjs`、`scripts/lib/env-check.mjs`、所有平台 HttpClient 适配器、`DelogoVideoInpaintAdapter` 等

### 17.3 项目硬约束（来自项目记忆）

- **Service Worker 必须不注册**：避免媒体预览问题（SW 的 cache-first 策略和跨源媒体拦截导致图片/音频/视频预览失败）。`main.tsx` 已按设计约束移除 SW 注册，老用户浏览器中残留的旧 SW 由 `index.html` 内联脚本一次性卸载清理
- **数据必须直接从 IndexedDB（元数据）和配置目录/OPFS（文件）获取**，不经 SW 缓存
- **文件二进制存储必须用 FilesLocal（配置目录）→ OPFS fallback**；IndexedDB 仅存元数据
- **所有文本长度限制必须在 textLimits.ts 定义**；适配器/Service 层必须引用这些常量，禁止硬编码数字
- **文本输入字段不得截断输入文本**；超限时提示用户调整文本（软限制模式）

### 17.4 工程约定

- UI 层文本输入长度限制使用跨平台最小兼容值
- 文件存储路径元数据存储在 IndexedDB 的 `generatedFiles` 表的 `storagePath` 字段
- 存储偏好默认 `'local'`（配置目录优先，OPFS 作为 fallback）

### 17.5 经验教训

- Service Worker 配合激进的 cache-first 策略和跨源媒体拦截会导致媒体预览失败：SW 会缓存 502 错误响应并干扰浏览器原生渲染流程，造成图片/音频/视频预览黑屏或加载失败。解决方案是彻底移除 SW 注册，并在 `index.html` 内联一次性卸载脚本清理老用户浏览器中残留的旧 SW
- IndexedDB 早期版本曾把文件二进制数据（Blob）直接存入表中，导致配额快速耗尽和性能下降。Phase 2 重构后改为「IndexedDB 仅存元数据 + 配置目录/OPFS 存二进制」双层架构，并保留 `OfflineCacheMigration` 做旧数据迁移
- 文本输入若在适配器层使用 `slice/substring` 硬截断，会让用户输入内容丢失且不可见。改为软限制模式：UI 层显示红色边框 + 计数器超限提示 + toast 警告，适配器层透传原始文本，由用户决定是否调整
- 文本长度限制硬编码在各适配器中会导致维护成本高且易遗漏。统一收敛到 `textLimits.ts` 的 `TEXT_LIMITS`（UI 跨平台最小值）与 `ADAPTER_TEXT_LIMITS`（平台硬限制）常量后，新增平台只需改一处
- Blob URL 若不统一管理会存在内存泄漏。采用三重保障：`useObjectUrl` hook（组件卸载自动 revoke）+ `objectUrlRegistry`（全局注册表兜底）+ 页面 ref Set（页面卸载批量清理）

---

## 18. 附录

### 18.1 关键文件速查表

| 用途 | 文件路径 |
| --- | --- |
| 应用入口 | `src/main.tsx` |
| 路由与启动序列 | `src/App.tsx` |
| 依赖注入容器 | `src/dependencies.ts` |
| Vite 构建配置 | `vite.config.ts` |
| 文件存储插件 | `vite-plugins/filesStorage.ts` |
| 数据库 Schema | `src/adapters/outbound/repositories/db.ts` |
| 文本限制常量 | `src/domain/constants/textLimits.ts` |
| 平台路由 | `src/domain/services/PlatformRouter.ts` |
| API 配置加密 | `src/adapters/outbound/config/ApiConfigStore.ts` |
| i18next 初始化 | `src/i18n.ts` |
| 环境变量示例 | `.env.example` |
| 系统设计文档（原始 SDD） | `System_Design.md` |

### 18.2 术语表

| 术语 | 含义 |
| --- | --- |
| Port（端口） | 领域层定义的接口，隔离核心逻辑与外部依赖 |
| Adapter（适配器） | 端口的具体实现，负责与外部系统交互 |
| PlatformRouter | 根据能力声明路由到具体平台适配器的分发器 |
| FilesLocal | 基于配置目录（`FILES_DIR`）的本地文件存储 |
| OPFS | Origin Private File System，浏览器私有文件系统 |
| Pipeline | 从故事到成片的 9 阶段全流程编排 |
| 软限制 | 文本输入超限时提示而非截断的模式 |
| CompositeLogger | 多 Sink 聚合的日志适配器 |
| RingBuffer | 环形缓冲日志池，用于应用内日志面板 |

### 18.3 文档版本

- **版本**：1.0
- **更新日期**：2026-07-02
- **适用代码版本**：当前 main 分支
- **维护说明**：本文档随项目架构演进同步更新；新增平台适配器、端口接口或重大重构后请同步修订对应章节

---

*本文档为 ai-video-studio 项目的结构化 Code Wiki，涵盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系以及项目运行方式等关键信息。*