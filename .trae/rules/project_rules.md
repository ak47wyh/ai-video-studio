# AI Video Studio 项目规则

> React 19 + TypeScript 6 + Vite 8,六边形架构(Ports & Adapters)

## 分层与依赖方向

```
src/domain/   领域核心:纯业务逻辑,零框架依赖
src/adapters/ 出站适配器:实现 Port,对接外部 API/存储/浏览器
src/ui/       表现层:React 组件/Hook/Page
```

**铁律:依赖方向只能 `ui → domain ← adapters`,`domain` 永远不依赖外层。**

## 架构边界约束(ESLint 强制,违反即编译失败)

`src/domain/**` 内禁止:

- `react` / `react-dom` → 通过 Port 抽象副作用
- `i18next` / `react-i18next` → 通过 `ITranslationPort`
- `axios` / `fetch` 直调 → 通过 `OutboundPorts`
- `@ffmpeg/*` → 通过 `IFFmpegPort`
- `dexie` / `dexie-react-hooks` → 通过仓储 Port
- `localStorage` / `sessionStorage` / `window.localStorage` → 通过 `ISnapshotRepository` 等 Port
- `alert` / `confirm` → 通过 `IConfirmPort` / `INotificationPort`

Service 优先构造函数注入 Port 接口,而非 import 具体类。

## 命名规范

- 组件文件:PascalCase.tsx(如 `AsyncState.tsx`)
- Hook 文件:`useXxx.ts`
- Service:`XxxService.ts`
- Port 接口文件:复数/语义名(如 `OutboundPorts.ts`)
- Adapter:`XxxAdapter.ts`(如 `VolcengineImageAdapter.ts`)
- 测试:`*.test.ts` 同目录
- Port 接口:`IXxxPort`;Adapter:`平台+能力+Adapter`;Service:`XxxService`
- 领域错误:`XxxError`;字面量联合类型集中定义于 Port 或 `entities/models.ts`
- 私有字段用 `private`(不用 `#`);未使用占位用 `_` 前缀

## TypeScript 规范

- **强制** `import type` 导入纯类型(`verbatimModuleSyntax: true`)
- `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch` 严格开启
- 不用 `enum` / namespace(`erasableSyntaxOnly: true`),用字面量联合类型
- 禁用 `any`,确需逃逸用 `unknown` + 收窄
- 优先 `interface` 描述形状,`type` 描述联合/工具类型
- Context 用独立 interface,字段尽量 optional;Result 用独立 interface

```ts
import type { IImageGeneratorPort, ImageGenerationContext } from '../ports/OutboundPorts';
import { PlatformRouter } from './PlatformRouter'; // 值导入分开
```

## Domain 层

### Port

- 相关能力聚合在同一文件(如 `OutboundPorts.ts`)
- 接口前用中文 JSDoc 说明用途
- 平台能力差异通过 `XxxCapabilities` 接口声明;不支持的子能力由 Adapter 抛 `CapabilityNotSupportedError`,**禁止返回 `undefined`**
- 流式方法返回 `AbortController` 或 Handle 对象

### Service

- 构造函数注入所有依赖,字段 `private`
- 类顶部 JSDoc 说明:职责、依赖项、关键设计决策(可标 Phase)
- 公共方法以业务动作命名:`generateCharacterImage`
- 日志走 `ILoggerPort`,统一 `ctx()` 工厂附加 `service` 字段
- 业务校验失败 `throw new Error('英文短句')`,面向用户文案交 UI 层 i18n

```ts
private ctx(extra: LogContext = {}): LogContext {
  return { service: 'ImageGenerationService', ...extra };
}
```

### Entity

- 集中于 `entities/models.ts`,字段附中文行内注释
- 时间戳用 `number`(Unix ms)

## Adapter 层

- 每平台一子目录 `adapters/outbound/api/<platform>/`:
  - `XxxHttpClient.ts` 鉴权/重试/错误归一化
  - `XxxErrorUtils.ts` 平台错误码映射
  - `<Platform><Capability>Adapter.ts` 单一能力,实现一个 Port
- Adapter 只做协议转换 + 错误归一化,**不含业务决策**
- 在 `dependencies.ts` 装配,经 `PlatformRouter` 按激活平台路由
- Mock/降级适配器放 `Mock*.ts`,与真实适配器实现同一 Port

## UI 层

### 组件

- 函数组件 + `React.FC<Props>`,**命名导出**
- Props interface 紧邻组件,字段附中文行内注释
- 复杂组件用 JSDoc 说明用途、用法示例、版本标注
- 统一 `<AsyncState>` 处理 loading/error/empty 三态
- 路由页面放 `ui/pages/`,按 Lab 维度组织

### Hook

- 文件 `useXxx.ts`,命名导出同名函数,顶部 JSDoc
- 配置项 `UseXxxOptions`,返回值 `UseXxxResult<T>`
- `useEffect` 依赖数组对齐 `exhaustive-deps`;豁免用行内 `// eslint-disable-next-line` 并注明原因

### 样式

- 优先语义化 CSS 类(`glass-panel`、`btn`、`skeleton`)
- 颜色/动效**必须**走 CSS 变量:`var(--primary-color)`、`var(--motion-normal)`,禁止硬编码视觉 token
- 可访问性:加载态 `role="status"` + `aria-live="polite"`,进度条 `role="progressbar"` + `aria-valuenow/min/max`

## 国际化

- 面向用户文案必须走 i18n,禁止硬编码中文/英文
- Domain 层多语言通过 `ITranslationPort` 注入,不得 import i18next
- 翻译键分布在 `src/locales/<lang>/translation.json`,10 种语言同步
- 提交前 `npm run i18n:check`

## 错误处理

- 能力不支持:抛 `CapabilityNotSupportedError`(带 `platform` + `capability`)
- Adapter:平台错误码归一化为领域错误,带上下文
- Service:业务校验失败用 `throw new Error('英文短句')`,日志 `logger.warn/error` + `ctx()`
- 持久化降级:失败回退原始 URL/数据,不抛错以保证 UI 不中断
- UI:`<AsyncState error onRetry>` 统一展示;全局兜底 `GlobalErrorCapture`

## 测试

- `*.test.ts` 同目录或 `src/test/__tests__/`
- 必须有架构契约测试(参考 `ServiceArchitectureContract.test.ts`)
- Adapter 用 `fake-indexeddb` + mock,不命中真实 API
- 提交前 `npm run typecheck && npm run lint && npm test`

## 构建与性能

- 路由级代码分割:`App.tsx` 用 `React.lazy()`
- Vendor 拆分遵循 `vite.config.ts` 的 `manualChunks`:`vendor-react` / `vendor-router` / `vendor-i18n` / `vendor-icons` / `vendor-db` / `vendor-http` / `vendor-ffmpeg`
- 重量级库(FFmpeg)用动态 `import()` 按需加载
- 大资源优先落 OPFS,避免 data:URI 膨胀与外部 URL 过期
- 单 chunk 告警阈值 1024KB

## 代理配置

- **仅火山引擎平台**所有接口(Ark OpenAI / Ark Anthropic / Speech HTTP / Speech WebSocket)必须走 Vite dev server proxy,不允许直连
- 代理路径前缀:`/volcengine-ark` / `/volcengine-speech` / `/volcengine-speech-ws`
- 火山引擎 Base URL 默认值统一为代理前缀(`/volcengine-*`),不再区分 DEV/PROD
- 其他平台(MiniMax 原生 / Coze / Kling / Wan / Hunyuan / Zhipu / Vidu 等)保持直连,不使用代理
- Vite proxy 配置位于 `vite.config.ts`,新增火山端点需同步更新代理规则
- WebSocket 代理需显式 `ws: true`
- 禁止使用 Cloudflare Worker / nginx / 其他自建反代方案(统一由 Vite proxy 承载)

## Mock 适配器使用范围

- Mock 适配器(`Mock*.ts`)**仅用于测试场景**(`*.test.ts` / `src/test/__tests__/`)
- 生产/开发运行时**强制使用真实适配器**,API Key 缺失时由 Adapter 抛 `CapabilityNotSupportedError`
- `dependencies.ts` 装配 Mock 时必须增加守卫:`if (import.meta.env.MODE === 'test' || import.meta.env.VITEST)`
- 测试场景可显式构造 Mock 实例注入到 Service,不通过全局装配
- 禁止以"无 API Key 时静默降级到 Mock"为由在生产/开发运行时启用 Mock

## 提交前检查

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint(含架构边界约束)
npm test            # Vitest 单测
npm run i18n:check  # i18n 键完整性
npm run build       # tsc -b && vite build
```

四项全绿方可合并。
