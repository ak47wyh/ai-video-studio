# AI Video Studio 代码优化计划

> 范围：P0 严重(7项) + P1 高(12项) + P2 中(10项) = 共 29 项优化点

## 一、当前状态分析

经过三个搜索代理全面探索，发现以下问题分布：

| 优先级 | 数量 | 典型问题 |
|--------|------|---------|
| P0 严重 | 7 | TS编译错误、内存泄漏、Mock规则违反、架构违规、i18n缺失 |
| P1 高 | 12 | 轮询Bug、console日志、重试机制、无障碍、闭包过期 |
| P2 中 | 10 | 硬编码、任务持久化、预加载、模型注册表、构建配置 |

## 二、P0 严重问题修复（7项）

### P0-1. 修复 TextGenerationService.ts IModelRegistry 编译错误

- **文件**: `src/domain/services/TextGenerationService.ts` 第 25 行
- **问题**: fallback 对象缺少 `getPlatformTextModels()` 和 `getDefaultTextModel()` 两个方法，导致 `tsc --noEmit` 报 TS2322 错误
- **修复**: 补全 fallback 对象的两个方法（返回空数组/空字符串），或将 `modelRegistry` 改为必选参数（dependencies.ts 中总是传入）

### P0-2. 修复 useStreamingAudioPlayer Object URL 内存泄漏

- **文件**: `src/ui/hooks/useStreamingAudioPlayer.ts`
- **问题**: 两处泄漏：(A) MediaSource Object URL(第84行) 永不释放；(B) 卸载清理闭包(第137行) 捕获初始 null，Blob URL 全部泄漏
- **修复**: 用 `objectUrlRef` 跟踪所有创建的 URL（参照 `useEnhancement.ts` 的 `resultUrlRef` 模式），卸载时统一 revoke

### P0-3. 修复 6 个非火山图片适配器违反 Mock 规则

- **文件**: `KlingImageAdapter.ts` / `ViduImageAdapter.ts` / `ZhipuImageAdapter.ts` / `WanImageAdapter.ts` / `HunyuanImageAdapter.ts` / `MiniMaxImageAdapter.ts`
- **问题**: API Key 缺失时返回 1x1 透明占位图，违反"API Key 缺失时由 Adapter 抛 CapabilityNotSupportedError"规则
- **修复**: 删除 Mock 占位图逻辑，改为 `throw new CapabilityNotSupportedError(platform, 'image')`

### P0-4. 清除 9 处 Domain 层 fetch() 直调

- **文件**: `ImageGenerationService.ts` / `MusicLabService.ts` / `MusicService.ts` / `VoiceService.ts` / `TimelineRenderService.ts` / `PipelineService.ts` / `AssetLibraryService.ts` / `VideoGenerationService.ts`
- **问题**: Domain 层直接调用 `fetch()`，违反"通过 OutboundPorts"规则。这些 Service 已注入 `IHttpFetchPort`，fetch() 是死代码 fallback
- **修复**: 删除所有 `fetch()` fallback 分支，将 `httpFetch` 改为必选参数

### P0-5. 修复 3 个 Lab 页面零 i18n

- **文件**: `VideoLab.tsx` / `WatermarkLab.tsx` / `EnhanceLab.tsx`
- **问题**: 0 处 `useTranslation` 调用，40+/965/83 处硬编码中文
- **修复**: 添加 `useTranslation` hook，提取所有硬编码文案到翻译键，补充 zh + en 翻译

### P0-6. 修复 i18n 翻译键大量缺失

- **文件**: `src/locales/{ja,de,es,it,fr,ko,pt,ru}/translation.json`
- **问题**: 7 种语言缺失约 33% 翻译键（约 2231 keys）
- **修复**: 以 zh 为基准，批量补全缺失的翻译键（使用英文兜底值）

### P0-7. 修复 MiniMax 适配器群静态调用 ApiConfigStore

- **文件**: `MiniMaxTextAdapter.ts` / `MiniMaxVideoAdapter.ts` / `MiniMaxMusicAdapter.ts` / `MiniMaxVoiceAdapter.ts` / `MiniMaxImageAdapter.ts` / `MiniMaxModelAdapter.ts`（共 26 处）
- **问题**: 方法内部直接调用 `ApiConfigStore.load()` 而非构造函数注入，破坏依赖注入和可测试性
- **修复**: 改为构造函数接收 `config: ApiConfig`（与其他平台适配器一致）

## 三、P1 高优先级修复（12项）

### P1-1. 修复 useAsyncTaskTracker setInterval+async 重入 Bug

- **文件**: `src/ui/hooks/useAsyncTaskTracker.ts` 第 140 行
- **问题**: `setInterval(async () => ...)` 当 pollFn 耗时 > intervalMs 时多个 tick 并发
- **修复**: 改为递归 setTimeout 自调度（参照 `usePolling.ts` 的已修复模式）

### P1-2. 修复 Domain 层 import 外层 utils（localStorage 依赖）

- **文件**: `TextGenerationService.ts`（cacheMonitor）/ `PipelineService.ts`（objectUrlRegistry）/ `MusicLabService.ts`（objectUrlRegistry）
- **问题**: Domain 层通过 import 外层 utils 间接依赖 localStorage 和浏览器 API
- **修复**: 将 cacheMonitor 的 localStorage 访问抽象为 Port 注入；objectUrlRegistry 调用改为通过 Port 或移入 adapters

### P1-3. 修复 ImageGenerationService value import

- **文件**: `src/domain/services/ImageGenerationService.ts` 第 6 行
- **问题**: `import { PlatformRouter }` 应为 `import type { PlatformRouter }`（verbatimModuleSyntax 规则）
- **修复**: 改为 `import type`

### P1-4. 适配器层 console 替换为 ILoggerPort

- **文件**: 几乎所有 `src/adapters/outbound/api/` 下的适配器（约 60 处）
- **问题**: 项目规则要求"日志走 ILoggerPort"，适配器全部使用 console
- **修复**: 为各 HttpClient 基类注入 ILoggerPort，替换 console 调用。优先处理泄露敏感信息的日志（MiniMaxImageAdapter payload 打印等）

### P1-5. 修复 MiniMaxImageAdapter 错误处理不一致

- **文件**: `src/adapters/outbound/api/MiniMaxImageAdapter.ts`
- **问题**: 直接调用 axios.post 而非通过 HttpClient，无 withRetry，无统一 ErrorUtils
- **修复**: 重构为继承 BaseHttpClient 模式，与其他适配器一致

### P1-6. 修复 VideoLab 重试机制形同虚设

- **文件**: `src/ui/pages/VideoLab.tsx` 第 504-522 行
- **问题**: handleRetryTask 仅切换 Tab + Toast 提示，不恢复参数、不重新发起
- **修复**: 缓存失败任务的原始参数，重试时恢复参数并自动重新提交

### P1-7. 修复 ImageLab 生成失败无内联错误展示

- **文件**: `src/ui/pages/ImageLab.tsx` 第 558-581 行
- **问题**: AsyncState 支持 error/onRetry 但未使用，失败仅瞬时 Toast
- **修复**: 添加 error state，将错误传递给 AsyncState 的 error/onRetry 属性

### P1-8. 修复 VideoLab 模型配置双重数据源

- **文件**: `src/ui/pages/VideoLab.tsx` 第 38-122 行
- **问题**: 硬编码 PLATFORM_MODEL_CONFIG 和 PLATFORM_MODE_MODELS，与 platformCapabilities.ts 不一致
- **修复**: 从 platformCapabilities.ts 读取模型列表，UI 层仅保留时长/分辨率联动配置

### P1-9. 补充无障碍性属性

- **文件**: `ImageLab.tsx` / `VideoLab.tsx` / `WatermarkLab.tsx` / `EnhanceLab.tsx` 等 12 个页面
- **问题**: 零 aria-/role 属性，上传区域无键盘支持
- **修复**: 为加载态添加 role="status" + aria-live，上传区域添加 tabIndex + role="button" + 键盘事件，图标按钮添加 aria-label

### P1-10. 修复 useVideoTaskPolling onAllComplete 闭包过期

- **文件**: `src/ui/hooks/useVideoTaskPolling.ts` 第 127 行
- **问题**: statuses 是 effect 创建时的闭包变量，多 tick 后过期
- **修复**: 用 ref 跟踪最新 statuses，onAllComplete 从 ref 读取

### P1-11. 修复 useStoryFilm 卸载时无异步取消

- **文件**: `src/ui/hooks/useStoryFilm.ts`
- **问题**: cancelledRef 仅在显式 cancel/reset 时置位，组件卸载时不置位
- **修复**: 添加 useEffect 卸载时 `cancelledRef.current = true`

### P1-12. 修复 TextLab setTimeout 未清理

- **文件**: `src/ui/pages/TextLab.tsx` 第 240 行
- **问题**: setTimeout 无清理，组件卸载触发已卸载组件 setState
- **修复**: 用 useRef 持有 timer，useEffect 卸载时 clearTimeout

## 四、P2 中优先级修复（10项）

### P2-1. 修复 ImageGenerationService.recordImageCost 硬编码模型名

- **文件**: `src/domain/services/ImageGenerationService.ts` 第 98/126/168 行
- **问题**: 传入 'image-default' 而非实际模型 ID
- **修复**: 传入 `context.model || 'unknown'`

### P2-2. 修复 generateCharacterImage/generateBackgroundImage 未传 model

- **文件**: `src/domain/services/ImageGenerationService.ts` 第 88-94/119-122 行
- **问题**: 构造 ImageGenerationContext 时未设置 model 字段
- **修复**: 从 config.volcArkImageModel 或注册表默认值获取并传入

### P2-3. 修复 Vite 构建配置缺少显式配置

- **文件**: `vite.config.ts`
- **问题**: 缺少 minify/sourcemap/cssCodeSplit/build.target 显式配置
- **修复**: 添加 `build.minify: 'esbuild'`、`build.sourcemap: false`、`build.target: 'es2020'`

### P2-4. 修复 ImageLab 残留硬编码中文

- **文件**: `src/ui/pages/ImageLab.tsx`
- **问题**: 宽高比标签、Toast 消息、AsyncState 文案等约 5 处硬编码
- **修复**: 提取到翻译键

### P2-5. 修复 VideoLab 任务列表刷新丢失

- **文件**: `src/ui/pages/VideoLab.tsx` 第 266 行
- **问题**: tasks 纯 useState 内存态，刷新后空列表
- **修复**: 页面加载时从 videoTaskRepo 恢复任务列表

### P2-6. Lab 页面纳入预加载策略

- **文件**: `src/App.tsx` 第 57-61 行
- **问题**: preloadCriticalChunks 未预加载 ImageLab/VideoLab
- **修复**: 添加 `import('./ui/pages/ImageLab')` 和 `import('./ui/pages/VideoLab')`

### P2-7. 修复多平台图片模型注册表为空但 defaultImageModel 非空

- **文件**: `src/domain/services/platformCapabilities.ts` 第 205-284 行
- **问题**: kling/wan/hunyuan/zhipu/vidu 的 imageModels 为空数组，但 defaultImageModel 非空
- **修复**: 补全各平台的 imageModels 注册表条目

### P2-8. 修复 ImageLab 下载实现不一致

- **文件**: `src/ui/pages/ImageLab.tsx` 第 224-234 行
- **问题**: handleDownload 用 `<a>` 标签，handleSaveConfirm 用 triggerNativeDownload
- **修复**: 统一使用 triggerNativeDownload

### P2-9. 修复 FFmpeg CDN 无降级

- **文件**: `src/adapters/outbound/api/FFmpegAdapter.ts` 第 5-6 行
- **问题**: FFmpeg 核心仅从 unpkg CDN 加载，无备用
- **修复**: 添加 cdnjs 作为备用 CDN，加载失败时自动切换

### P2-10. 修复 SpaceDetailPage 重复订阅模式

- **文件**: `src/ui/pages/SpaceDetailPage.tsx`
- **问题**: 5 个 useEffect 使用相同的 cancelled+subscribe+run 模式
- **修复**: 复用 useSpaceQueryResult 通用封装

## 五、验证步骤

每批修复后执行：

```bash
npm run typecheck   # 确认编译通过（P0-1 修复后应零错误）
npm run lint        # 确认架构边界约束通过
npm test            # 确认单测全部通过
npm run i18n:check  # 确认翻译键完整性（P0-6 修复后缺失数应大幅下降）
npm run build       # 确认构建成功
```

## 六、执行顺序建议

1. **第一批（P0 架构修复）**: P0-1 编译错误 → P0-3 Mock规则 → P0-4 fetch清理 → P0-7 MiniMax注入
2. **第二批（P0 内存/Bug）**: P0-2 内存泄漏
3. **第三批（P0 i18n）**: P0-5 Lab i18n → P0-6 翻译键补全
4. **第四批（P1 Bug）**: P1-1 到 P1-12 按序修复
5. **第五批（P2 优化）**: P2-1 到 P2-10 按序修复
6. **最终验证**: 全量 typecheck + lint + test + i18n:check + build
