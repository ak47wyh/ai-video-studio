# 全站 UI 交互与视觉优化设计文档

> 文档类型：UI/UX 设计规格（Spec）
> 范围：`src/ui/` 全量页面与组件（MainLayout、Dashboard、各 Lab、StoryWorkbench、Settings、VideoEditor、FileManager、ExportCenter 等）
> 状态：待评审 · 本文档仅描述设计与交互方案，**不包含任何代码改动**
> 关联文档：[Settings_UIDesign_Optimization.md](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/Settings_UIDesign_Optimization.md)（设置页专项，本文档不重复其结论，仅做横向对齐）

---

## 一、文档概述

### 1.1 背景

`ai-video-studio` 已具备完整的 AI 多模态创作链路（图片/视频/语音/音乐/文本/去水印/增强/剪辑/导出），设计令牌体系（`src/index.css` 中的 `--space-*` / `--font-size-*` / `--motion-*` / 4 套主题）也已落地。但随着功能膨胀，**视觉与交互一致性出现裂缝**：

- 28 个页面/组件文件中共出现 **757 处内联 `style={{}}`**，硬编码 `minWidth`/`background`/颜色，绕过令牌系统；
- 21 个文件中 **161 处十六进制颜色**直接写死（`#6366f1`/`#ec4899`/`#34d399`…），导致 4 套主题切换时这些颜色**不随主题变化**，破坏护眼基调；
- 已有的好组件 `AsyncState`、`PageSkeleton` **仅在 2 个页面被复用**，其余 11 个 Lab/管理页仍用「红字 + spin 图标」简陋处理；
- `src/ui/pages/` 目录下 **0 个 `@media` 媒体查询**，WatermarkLab/EnhanceLab 固定 `min-width: 400px`，窄屏必然横向滚动；
- 全目录仅 **3 处 `aria-label`**，可点击 `div` 普遍无 `role`/`tabIndex`，键盘用户不可达。

### 1.2 设计目标

| 目标 | 衡量指标（验收） |
| --- | --- |
| 视觉一致性 | 内联 `style` 中硬编码颜色清零；Lab Tab 配色、状态色 100% 走 `var(--*)` 令牌 |
| 主题可切换性 | 4 套主题（dark/light/blue/warm）下，任意页面无「不随主题变化的硬编码色块」 |
| 三态治理统一 | 空/载/错三态 100% 复用 `AsyncState` + `EmptyState` + `PageSkeleton`；红字裸错误清零 |
| 移动端可用性 | < 768px 无横向滚动；< 480px 关键操作触手可及（底部 44px 安全区） |
| 可访问性基线 | 所有可点击非原生元素具备 `role`+`tabIndex`+`aria-label`+键盘事件；焦点环可见 |
| 护眼基调延续 | 暖色主题（用户偏好）下，对比度 WCAG AA 达标，无纯白纯黑大面积对比 |
| 信息密度合理 | 正文字号 ≥ 0.8rem（13px），行高 ≥ 1.5，紧凑态密度可调但不下探 0.65rem |

### 1.3 不在本次范围

- 后端/适配器层逻辑改动（`ApiConfigStore`、各 `*Adapter.ts` 保持不变）
- 新增 AI 平台接入或新业务功能
- 设置页协议切换交互（已在 [Settings_UIDesign_Optimization.md](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/Settings_UIDesign_Optimization.md) 中专项设计，本文仅做横向对齐）
- 国际化文案补全（仅指出需要 i18n 的位置，不写具体翻译）

---

## 二、现状诊断（基于代码证据）

### 2.1 设计令牌体系已存在但未贯彻

[index.css](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/index.css) 已定义完整令牌：

- 间距：`--space-xs/sm/md/lg/xl`（4/8/16/24/40）
- 字号：`--font-size-xs/sm/base/lg/xl`（12/14/16/20/24）
- 动效：`--motion-fast/normal/slow`（120/200/320ms）+ `--ease-standard`
- 主题：dark / light / blue / **warm**（暖橙赭石 `#e8956b`，用户偏好的护眼基调）

**问题**：令牌定义后，业务页几乎未消费。例如 [Dashboard.tsx:32-68](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L32-L68) 的步骤卡片配色 `#6366f1`/`#ec4899`/`#f59e0b`/`#8b5cf6`/`#10b981` 全部硬编码，warm 主题下这些高饱和色与暖橙主色冲突。

### 2.2 共性问题清单（含证据）

#### P0-1 内联样式滥用，绕过令牌

| 证据 | 问题 |
| --- | --- |
| [VideoLab.tsx:99](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L99) `style={{ minWidth: '180px' }}`（同文件 107/114/526/535 多处） | minWidth 硬编码，未走 `--space-*` |
| [VideoLab.tsx:512](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L512) `style={{ background: '#3b82f6' }}`（576/623/636/670 同模式） | 按钮背景硬编码，主题切换不生效 |
| [Dashboard.tsx:166](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L166) `gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))'` | 网格阈值硬编码，320px 手机横向滚动 |

#### P0-2 颜色硬编码，破坏主题

| 证据 | 问题 |
| --- | --- |
| [Dashboard.tsx:32-68](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L32-L68) 5 个步骤色全硬编码 | warm 主题下高饱和色冲突 |
| [VideoLab.tsx:418-422](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L418-L422) Tab 配色 `#3b82f6`/`#8b5cf6`/`#ec4899`/`#f59e0b`/`#06b6d4` | Lab Tab 配色体系未 Token 化 |
| [VoiceLab.tsx:679-939](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VoiceLab.tsx#L679) 状态色 `#34d399`/`#ef4444`/`#f59e0b` 散落 10+ 处 | 状态色未统一到 `--color-success/danger/warning` |
| [WatermarkLab.css:74-159](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.css#L74) CSS 文件中也写死 `#ec4899`/`#f59e0b` | 即使抽到 CSS 仍未 Token 化 |

#### P0-3 三态治理不均（空/载/错）

| 现状 | 证据 |
| --- | --- |
| 空态仅一行 muted 文字 | [VideoLab.tsx:685](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L685) "暂无任务，请从其他 Tab 提交视频生成任务"；[FileManager.tsx:200](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/FileManager.tsx#L200) "暂无素材。去实验室生成并保存图片吧。" |
| 加载态仅 spin 图标 | [VideoLab.tsx:469](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L469)、[MusicLab.tsx:427](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/MusicLab.tsx#L427) 全部 `<RefreshCw className="spin" />` |
| 错误态仅红字 | [VoiceLab.tsx:848](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VoiceLab.tsx#L848) `<span style={{ color: '#ef4444' }}>失败: {task.error}</span>`；[BackgroundManagement.tsx:209](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/BackgroundManagement.tsx#L209) `color: 'lightcoral'` |
| 正面案例 | [WatermarkLab.tsx:582](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.tsx#L582) 已用 `AsyncState` + `onRetry` —— **应作为全站范式** |

#### P1-1 移动端适配缺失

| 证据 | 问题 |
| --- | --- |
| [WatermarkLab.css:37](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.css#L37) `.watermark-canvas-area { min-width: 400px; }` | < 400px 屏幕横向滚动 |
| [EnhanceLab.css:41](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/EnhanceLab.css#L41) `min-width: 400px;` | 同上 |
| [Settings.tsx:1103](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Settings.tsx#L1103) 4 列表格 | < 768px 挤压溢出，无响应式 |
| `src/ui/pages/` 全目录 | **0 个 `@media`**，所有响应式集中在 `index.css`，页面级断点缺失 |

#### P1-2 可访问性薄弱

| 证据 | 问题 |
| --- | --- |
| [ExportCenter.tsx:153](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ExportCenter.tsx#L153) `<div style={{ cursor: 'pointer' }} onClick={...}>` | 缺 `role`/`tabIndex`/`aria-label`/`onKeyDown` |
| [WatermarkLab.tsx:400](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.tsx#L400) modal overlay div + onClick | 缺 `role="dialog"`/`aria-modal="true"` |
| [KeyframePreviewPanel.tsx:103](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/editor/KeyframePreviewPanel.tsx#L103) modal overlay | 同上 |
| 全目录 | 仅 3 处 `aria-label`（Dashboard ×2、StoryWorkbench ×1） |

#### P2-1 信息密度两极

| 证据 | 问题 |
| --- | --- |
| [ImportVideoModal.tsx:169](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/editor/ImportVideoModal.tsx#L169) `fontSize: '0.65rem'`（209/260/281 行 `0.6rem`） | 字号过小，< 10px 不可读 |
| [KeyframePreviewPanel.tsx:136](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/editor/KeyframePreviewPanel.tsx#L136) `gap: 4`、180 行 `fontSize: 11` | 密度过高 |
| [TextLab.tsx:338](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/TextLab.tsx#L338) `gap: '0.3rem'` | 按钮组间隙过密 |

### 2.3 既有能力盘点（可复用）

| 组件/能力 | 位置 | 现状 |
| --- | --- | --- |
| `AsyncState` | [AsyncState.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AsyncState.tsx) | 已实现空/载/错三态，仅 2 页面复用 |
| `PageSkeleton` | [PageSkeleton.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/PageSkeleton.tsx) | 路由级骨架屏已实现，列表级未推广 |
| `LabPageLayout` | [LabPageLayout.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/LabPageLayout.tsx) | Lab 页头已统一，但 Tab 配色仍硬编码传入 |
| `MainLayout` 创作流程指示器 | [MainLayout.tsx:276-299](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.tsx#L276-L299) | 桌面端已有，移动端缺失 |
| `prefers-reduced-motion` | [index.css:2437](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/index.css#L2437) | 全局已降级，良好 |
| 4 套主题 + 暖色护眼 | [index.css:152](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/index.css#L152) | 体系完整，待业务页消费 |

---

## 三、设计原则与令牌补全

### 3.1 五条核心原则

1. **令牌优先（Token-First）**：任何颜色、间距、字号、圆角、动效必须走 `var(--*)`，禁止内联硬编码。新增语义令牌见 §3.2。
2. **三态必填（Three-State Mandatory）**：任何异步数据展示位必须有「加载/空/错」三态，统一复用 `AsyncState`。
3. **暖色护眼基调**：默认 warm 主题，禁止大面积纯白（`#fff`）纯黑（`#000`）对比；正文背景使用 `--bg-panel`（暖白 `rgba(255,252,247,0.92)`）。
4. **键盘可达（Keyboard-First）**：所有交互元素必须键盘可触发，焦点环可见（`:focus-visible` 走 `--border-color-focus`）。
5. **移动优先断点**：页面级必须定义 `< 768px` 与 `< 480px` 两档断点，禁止固定 `min-width`。

### 3.2 设计令牌补全（建议新增到 `src/index.css`）

当前令牌缺少**语义色**与**状态色**，导致业务页只能硬编码。建议补全以下令牌（4 套主题各自映射）：

```css
:root {
  /* ===== 语义状态色（补全） ===== */
  --color-success: #34d399;
  --color-success-bg: rgba(52, 211, 153, 0.12);
  --color-success-border: rgba(52, 211, 153, 0.30);

  --color-warning: #fbbf24;
  --color-warning-bg: rgba(251, 191, 36, 0.12);
  --color-warning-border: rgba(251, 191, 36, 0.30);

  --color-danger: #f87171;
  --color-danger-bg: rgba(248, 113, 113, 0.12);
  --color-danger-border: rgba(248, 113, 113, 0.30);

  --color-info: #60a5fa;
  --color-info-bg: rgba(96, 165, 250, 0.12);
  --color-info-border: rgba(96, 165, 250, 0.30);

  /* ===== Lab 分类语义色（补全） ===== */
  --lab-color-image: #ec4899;    /* 图片 */
  --lab-color-video: #3b82f6;    /* 视频 */
  --lab-color-voice: #10b981;    /* 语音 */
  --lab-color-music: #8b5cf6;    /* 音乐 */
  --lab-color-text: #f59e0b;     /* 文本 */
  --lab-color-watermark: #06b6d4;/* 去水印 */
  --lab-color-enhance: #a78bfa;  /* 增强 */

  /* ===== 焦点环（补全，a11y） ===== */
  --focus-ring: 0 0 0 3px var(--border-color-focus);

  /* ===== z-index 层级（补全，避免散落） ===== */
  --z-sidebar: 10;
  --z-dropdown: 20;
  --z-sticky: 30;
  --z-overlay: 40;
  --z-drawer: 50;
  --z-modal: 60;
  --z-toast: 70;
}

/* warm 主题语义色降饱和（护眼） */
:root[data-theme="warm"] {
  --color-success: #6bbf8a;
  --color-warning: #d9a85a;
  --color-danger: #d97757;
  --color-info: #7ba4d4;

  --lab-color-image: #d4729a;
  --lab-color-video: #6b8fb5;
  --lab-color-voice: #6ba889;
  --lab-color-music: #9a82b5;
  --lab-color-text: #c9954a;
  --lab-color-watermark: #6ba0a8;
  --lab-color-enhance: #a08bbf;
}

/* light 主题保持原值，dark/blue 沿用默认 */
```

### 3.3 间距与字号使用规范

| 用途 | 令牌 | 值 | 禁止 |
| --- | --- | --- | --- |
| 行高最小 | — | `1.5` | `< 1.4` |
| 正文字号 | `--font-size-sm` | `0.875rem` (14px) | 内联 `fontSize < 0.8rem` |
| 辅助文字 | `--font-size-xs` | `0.75rem` (12px) | `fontSize < 0.7rem` |
| 卡片内边距 | `--space-md` | `16px` | 内联 `padding < 0.5rem` |
| 卡片间隙 | `--space-sm` | `8px` | `gap < 0.4rem` |
| 区块间隙 | `--space-lg` | `24px` | — |
| 圆角 | `--radius-md/lg` | 8/12px | 内联 `borderRadius` 硬编码 |

---

## 四、全局组件优化

### 4.1 MainLayout 侧边栏（[MainLayout.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.tsx)）

#### 现状问题
- 激活平台徽标 [L211-235](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.tsx#L211-L235) 用 11 行内联 `style` 拼接，颜色 `${activeMeta.accentColor}1a` 等透明度魔法值散落；
- 创作流程指示器 [L276-299](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.tsx#L276-L299) 仅桌面端展示，移动端无等效引导；
- 侧边栏宽度 260px 在 1024px 笔记本上略宽，挤压主内容。

#### 优化方案

| 项 | 方案 |
| --- | --- |
| 平台徽标 | 抽 `.active-platform-badge` 专用 class，背景走 `color-mix(in srgb, var(--platform-accent) 10%, transparent)`，边框走 30% 透明度；移除内联 style |
| 流程指示器 | 移动端在抽屉内增加紧凑横向版（4 个圆点 + 连线），复用 `.creation-flow` 样式但缩放 0.85 |
| 侧边栏宽度 | 桌面默认 240px；折叠 60px；增加 `@media (max-width: 1280px)` 自动折叠 |
| 导航分组 | 分组标题 `.nav-group-label` 当前 `opacity: 0.6` 过淡，warm 主题下几乎不可见 → 改为 `color: var(--text-muted); opacity: 1` |
| 禁用态 | `.nav-item-disabled` 当前用 `Ban` 图标角标 + dashed 边框，视觉杂乱 → 改为图标灰度 + 单行 tooltip「需在设置中切换平台」 |

#### 视觉规格（暖色基调）

```
侧边栏背景：var(--bg-panel)（暖白 0.92 透明）
分组标题：var(--text-muted)，字号 0.7rem，字重 600，letter-spacing 0.8px
导航项默认：var(--text-muted)，hover 时 var(--text-main) + 背景 var(--bg-panel-hover)
导航项激活：背景 color-mix(var(--primary-color) 10%, transparent)，
          左侧 3px 竖条 var(--primary-color)，文字 var(--primary-color)
导航项圆角：var(--radius-md)（8px）
导航项间距：gap 4px（--space-xs）
```

### 4.2 顶栏与面包屑（新增）

当前页面无面包屑，深层级页面（如 `/spaces/:id`）用户失去位置感。建议：

- 在 `.main-panel` 顶部新增 `breadcrumb` 条（高 36px，背景 `var(--bg-panel)`，底部 1px 分割线）；
- 格式：`空间名 / 模块 / 子页`，例如 `我的空间 / 创作工作台 / 段落编辑`；
- 末级不可点，前级可点跳转；
- 移动端折叠为「返回箭头 + 当前页名」。

### 4.3 三态组件统一（核心治理）

#### 4.3.1 `AsyncState` 推广计划

[AsyncState.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AsyncState.tsx) 已具备 `loading/empty/error/success` 四态，需推广到以下 11 个页面：

| 页面 | 替换位置 | 当前实现 |
| --- | --- | --- |
| VideoLab | 任务列表区 [L685](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L685) | 纯文字"暂无任务" |
| VoiceLab | 任务/音色列表 [L848](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VoiceLab.tsx#L848) | 红字错误 |
| MusicLab | 生成结果 [L427](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/MusicLab.tsx#L427) | spin 图标 |
| ImageLab | 画廊区 [L477](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ImageLab.tsx#L477) | 仅 `gallery.length > 0` 判断 |
| TextLab | 模型表格 / 结果 | 纯条件渲染 |
| CharacterManagement | 角色网格 [L475](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/CharacterManagement.tsx#L475) | `.character-empty` |
| BackgroundManagement | 背景网格 [L346](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/BackgroundManagement.tsx#L346) | 纯文字 |
| ExportCenter | 导出列表 | 条件渲染 |
| FileManager | 文件列表 [L200](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/FileManager.tsx#L200) | "暂无素材"文字 |
| Dashboard | 视频统计 / 最近故事 [L170/L208](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L170) | 纯文字 |
| StoryWorkbench | 段落列表 | 条件渲染 |

#### 4.3.2 `EmptyState` 视觉规范

空状态统一为「插画图标 + 标题 + 描述 + 主 CTA」四件套：

```
┌─────────────────────────────┐
│        [48px 描边图标]        │
│                             │
│      暂无生成结果             │  ← 0.95rem，var(--text-main)，字重 600
│  描述文案，引导用户操作        │  ← 0.8rem，var(--text-muted)
│                             │
│      [ 立即生成 ]             │  ← btn-primary，可选
└─────────────────────────────┘
```

- 图标用 `lucide-react` 描边图标，48px，颜色 `var(--text-muted)`，opacity 0.5；
- 容器 `padding: var(--space-xl) var(--space-lg)`；
- CTA 按钮可选，有明确下一步时必填。

#### 4.3.3 `ErrorState` 视觉规范

错误态统一为「错误图标 + 错误标题 + 错误详情 + 重试按钮」：

```
┌─────────────────────────────┐
│      [28px 警告图标 红色]     │
│                             │
│       生成失败               │  ← 0.95rem，var(--color-danger)
│  HTTP 429: 请求过于频繁       │  ← 0.8rem，var(--text-muted)，等宽字体
│                             │
│      [ 重试 ]                │  ← btn-secondary，必填
└─────────────────────────────┘
```

- 错误详情用等宽字体（`font-family: 'JetBrains Mono', monospace`），便于排查；
- 重试按钮必填，调用 `AsyncState` 的 `onRetry`；
- 禁止裸红字（如 `color: 'lightcoral'` / `#ef4444`）。

#### 4.3.4 `LoadingState` 视觉规范

- **路由级**：复用 `PageSkeleton`（已实现 shimmer 微光）；
- **列表级**：复用骨架卡片（`.skeleton-block`），网格布局与真实数据一致；
- **按钮内**：保留 `RefreshCw spin`，但增加 `aria-busy="true"` + `aria-live="polite"`；
- **全页加载**：禁止纯文本"加载中…"，必须骨架屏。

### 4.4 Toast 通知（[ToastContext.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/contexts/ToastContext.tsx)）

#### 优化方案
- 增加**动作按钮**：长文案 Toast（如"素材已保存到本地磁盘"）增加「查看」按钮跳转；
- 增加堆叠上限：最多 3 条，超出折叠为「还有 N 条通知」；
- warm 主题下降低阴影强度，避免暖白底上的重阴影刺眼；
- 增加 `role="status"` + `aria-live="polite"`。

### 4.5 确认对话框（[ConfirmContext.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/contexts/ConfirmContext.tsx)）

- 危险操作（删除）用 `btn-danger` 红色按钮，且按钮文案带具体对象名（"删除故事《xxx》"而非"确认"）；
- 增加键盘支持：`Esc` 取消、`Enter` 确认；
- `role="alertdialog"` + 焦点陷阱。

---

## 五、各业务页优化

### 5.1 Dashboard（[Dashboard.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx)）

#### 问题
- 步骤卡片 [L32-68](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L32-L68) 5 个颜色硬编码，warm 主题下冲突；
- AI 实验室入口 [L137-141](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L137-L141) 与步骤卡片视觉无区分，用户分不清「创作流程」与「工具入口」；
- 视频统计 [L166](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L166) 网格 `minmax(300px, 1fr)` 在 320px 手机横向滚动；
- `taskStats.total === 0` 时仅一行文字，无引导。

#### 优化方案

| 项 | 方案 |
| --- | --- |
| 步骤卡片配色 | 5 个颜色改用 `var(--lab-color-*)` 语义令牌；卡片图标背景 `color-mix(in srgb, var(--lab-color-*) 12%, transparent)` |
| 视觉分区 | 「创作流程」区用横向 5 列卡片（带序号徽标）；「AI 实验室」区用 5 列紧凑网格（无序号，更小）；两区之间用 `.dashboard-section-title` + 分割线明确区隔 |
| 统计网格 | `minmax(300px, 1fr)` → `minmax(min(100%, 280px), 1fr)`，移动端单列 |
| 空态 | `taskStats.total === 0` 时用 `EmptyState`：图标 `Film` + "暂无视频任务" + "去工作台生成第一个视频" CTA |
| 卡片 hover | 当前 `transform: translateY(-2px)` + 阴影，warm 主题下阴影过重 → 阴影改 `var(--shadow-card)`，hover 时仅增强边框色 |

### 5.2 Lab 系列页面（7 个）

#### 5.2.1 统一 Lab Tab 配色体系

当前 [VideoLab.tsx:418-422](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx#L418-L422) 等 Tab 配色硬编码。统一为：

| Lab | Tab 语义色令牌 |
| --- | --- |
| ImageLab | `--lab-color-image` |
| VideoLab | `--lab-color-video`（t2v/i2v/fl2v/s2v 共用，用透明度区分） |
| VoiceLab | `--lab-color-voice` |
| MusicLab | `--lab-color-music` |
| TextLab | `--lab-color-text` |
| WatermarkLab | `--lab-color-watermark` |
| EnhanceLab | `--lab-color-enhance` |

`LabPageLayout` 的 `tabs[].color` 入参改为接收令牌名而非色值，组件内部 `var()` 解析。

#### 5.2.2 Lab 页面布局统一

[LabPageLayout](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/LabPageLayout.tsx) 已统一页头，但内容区仍各自为政。建议增加**双栏布局**变体：

```
桌面（≥ 1024px）：
┌──────────────┬──────────────────┐
│  参数面板     │  结果面板         │
│  (380px 固定) │  (flex 1，sticky) │
│  - 表单       │  - 画廊/播放器     │
│  - 高级设置   │  - 历史记录        │
│  - 生成按钮   │                  │
└──────────────┴──────────────────┘

移动（< 768px）：
┌──────────────────┐
│  参数面板（可折叠）│
├──────────────────┤
│  结果面板         │
└──────────────────┘
```

- 参数面板 `position: sticky; top: 0`，生成按钮固定在面板底部；
- 结果面板独立滚动，避免生成时参数面板跟着滚；
- 移动端参数面板默认折叠为「展开参数」按钮，结果优先。

#### 5.2.3 表单密度治理

当前 [VideoLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoLab.tsx) `lab-model-config` 内 `minWidth: 180px/120px/200px` 散落。统一为：

- `.lab-model-config-item` 默认 `min-width: 160px`，删除内联 minWidth；
- 模型选择/比例选择并列两栏，高级设置折叠；
- 生成按钮全宽，高度 44px（触控安全尺寸）。

#### 5.2.4 生成结果展示统一

- 图片画廊：`grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr))`；
- 视频结果：卡片式，封面 16:9，下方显示模型/时长/状态；
- 音频结果：波形条 + 播放控件，高度 48px；
- 所有结果卡片支持 hover 显示操作按钮（下载/保存/用作参考）。

### 5.3 StoryWorkbench（[StoryWorkbench.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/StoryWorkbench.tsx)）

#### 问题
- 左右分栏 [L1192-L1212](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/StoryWorkbench.tsx) 固定 320px，移动端已堆叠但缺少切换；
- 段落卡片密度高，BGM/旁白/视频结果混排；
- 进度统计仅数字，无可视化。

#### 优化方案

| 项 | 方案 |
| --- | --- |
| 分栏 | 桌面 320px → 300px；增加可拖拽分隔条（与侧边栏折叠按钮同范式） |
| 段落卡片 | 段落序号用圆形徽标（28px，`--lab-color-video` 底）；内容/角色/旁白/BGM/视频结果用纵向分段，每段之间用 1px 虚线分隔 |
| 进度可视化 | 顶部进度条改为 5 段彩色（成功绿/处理黄/失败红/待生成灰/就绪蓝），鼠标悬浮显示数值 |
| 空故事 | 用 `EmptyState`：`BookOpen` 图标 + "暂无故事" + "新建第一个故事" CTA |

### 5.4 Settings（横向对齐，不重复 Settings 专项）

仅补充两点横向对齐：

- 平台卡片网格 [Settings.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Settings.tsx) 在 warm 主题下，卡片边框 `rgba(120,90,60,0.15)` 偏淡，hover 时增强为 `rgba(120,90,60,0.25)`；
- 模型清单表格 [L1103](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Settings.tsx#L1103) 4 列在 < 768px 改为卡片式堆叠（每行一个模型，标签+值纵向排列）。

### 5.5 VideoEditor（[VideoEditor.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/VideoEditor.tsx)）

- 已用 `AsyncState`，良好；
- 时间线编辑器在 < 1024px 下工具栏图标会溢出 → 增加可滚动工具栏 + 溢出阴影提示；
- 预览舞台 16:9 固定比例，移动端可改为 `aspect-ratio: 16/9; width: 100%`。

### 5.6 FileManager / ExportCenter

- [FileManager.tsx:200](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/FileManager.tsx#L200) 空态用 `EmptyState` + "去图片实验室" CTA；
- [ExportCenter.tsx:153](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ExportCenter.tsx#L153) 可点击缩略图 div 改 `<button>` 或加 `role="button"` + `tabIndex={0}` + `onKeyDown`；
- 导出列表在 < 768px 改为单列卡片。

---

## 六、可访问性专项（A11y）

### 6.1 焦点管理

```css
/* 全局焦点环（补全到 index.css） */
*:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-md);
}

/* 移除默认 outline 时必须提供替代 */
*:focus:not(:focus-visible) {
  outline: none;
}
```

### 6.2 可点击元素语义化清单

| 文件 | 行号 | 现状 | 改造 |
| --- | --- | --- | --- |
| [ExportCenter.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/ExportCenter.tsx#L153) | 153 | `<div onClick>` | 改 `<button>` 或加 `role="button" tabIndex={0} aria-label="预览片段" onKeyDown` |
| [Dashboard.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Dashboard.tsx#L213) | 213 | `<div onClick>` 故事项 | 同上，`aria-label="打开故事《xxx》"` |
| [WatermarkLab.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.tsx#L400) | 400 | modal overlay div | 加 `role="dialog" aria-modal="true" aria-labelledby` |
| [KeyframePreviewPanel.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/editor/KeyframePreviewPanel.tsx#L103) | 103 | modal overlay | 同上 |

### 6.3 模态对话框规范

所有 Modal 统一：

- `role="dialog"` + `aria-modal="true"`；
- `aria-labelledby` 指向标题；
- 焦点陷阱：打开时焦点移入，`Tab` 循环，`Esc` 关闭；
- 关闭后焦点返回触发元素；
- 背景滚动锁定（`body { overflow: hidden }`）。

### 6.4 色彩对比度

- warm 主题正文 `#3d3530` on `#faf8f5`：对比度 11.2:1 ✓（AAA）；
- warm 主题 `--text-muted` `#6e635a` on `#faf8f5`：对比度 5.3:1 ✓（AA）；
- warm 主题 `--lab-color-text` `#c9954a` on `#faf8f5`：对比度 3.1:1 ✗（仅适用于大字号/图标，正文不可用）→ 大面积文字场景降级为 `--text-muted`。

### 6.5 动效降级

[index.css:2437](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/index.css#L2437) 已全局处理 `prefers-reduced-motion`，保持现状。新增动效需同步检查。

---

## 七、移动端适配专项

### 7.1 断点体系

| 断点 | 含义 | 行为 |
| --- | --- | --- |
| `≥ 1280px` | 桌面宽屏 | 侧边栏 240px + 双栏 Lab 布局 |
| `1024px - 1279px` | 笔记本 | 侧边栏可折叠 + 双栏 Lab 布局 |
| `768px - 1023px` | 平板 | 侧边栏默认折叠 + Lab 单栏 |
| `480px - 767px` | 手机横屏/大屏手机 | 抽屉式侧边栏 + 底部导航 + 单栏 |
| `< 480px` | 手机竖屏 | 同上 + 卡片网格 2 列 → 1 列 |

### 7.2 固定宽度治理清单

| 文件 | 现状 | 改造 |
| --- | --- | --- |
| [WatermarkLab.css:37](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.css#L37) `min-width: 400px` | < 400px 横向滚动 | `min-width: 0`，`@media (max-width: 768px)` 改纵向堆叠 |
| [WatermarkLab.css:44](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/WatermarkLab.css#L44) `.watermark-params-panel { width: 280px }` | 固定宽度 | 桌面 280px，移动 `width: 100%` |
| [EnhanceLab.css:41](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/EnhanceLab.css#L41) `min-width: 400px` | 同上 | 同上 |
| [Settings.tsx:1103](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/pages/Settings.tsx#L1103) 表格 | 4 列挤压 | 移动端转卡片式 |

### 7.3 触控安全尺寸

- 所有可点击元素最小 44×44px（iOS HIG / WCAG 2.5.5）；
- 按钮高度：`.btn` 40px、`.btn-generate` 48px、`.btn-sm` 32px、`.btn-xs` 28px（仅次要操作可用）；
- 移动端底部导航项最小 44×44px，已达标 [MainLayout.css:550](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.css#L550)。

### 7.4 安全区适配

- 底部导航已处理 `env(safe-area-inset-bottom)` [MainLayout.css:528](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/layouts/MainLayout.css#L528)；
- 顶部移动顶栏需增加 `padding-top: env(safe-area-inset-top)` 适配刘海屏；
- 横屏时左右增加 `env(safe-area-inset-left/right)`。

---

## 八、视觉细节打磨

### 8.1 排版层次

当前标题层级混乱（`h1` 1.5rem 与 `h2` 1rem 视觉差距过大）。统一为：

| 元素 | 字号 | 字重 | 用途 |
| --- | --- | --- | --- |
| 页面标题 | `--font-size-xl` (24px) | 700 | 每页唯一，`.lab-title` / `.dashboard-title` |
| 区块标题 | `--font-size-lg` (20px) | 600 | `.dashboard-section-title` |
| 卡片标题 | `--font-size-base` (16px) | 600 | `.dashboard-card-title` |
| 正文 | `--font-size-sm` (14px) | 400 | 默认 |
| 辅助 | `--font-size-xs` (12px) | 400 | 标签、时间戳 |

### 8.2 阴影体系

warm 主题阴影过重会显得脏。统一为：

```css
--shadow-xs: 0 1px 2px rgba(60, 50, 35, 0.04);
--shadow-sm: 0 2px 4px rgba(60, 50, 35, 0.06);
--shadow-md: 0 4px 8px rgba(60, 50, 35, 0.08);
--shadow-lg: 0 8px 16px rgba(60, 50, 35, 0.10);
```

dark/blue 主题保留原 `rgba(0,0,0,*)` 阴影。

### 8.3 圆角统一

- 卡片：`--radius-lg` (12px)
- 按钮/输入框：`--radius-md` (8px)
- 标签/徽标：`--radius-full` (999px)
- 暖色主题下圆角可略大（14px），增加柔和感。

### 8.4 动效节奏

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 按钮悬停 | `--motion-fast` (120ms) | `--ease-standard` |
| 卡片展开/折叠 | `--motion-normal` (200ms) | `--ease-standard` |
| 路由切换 fade | `--motion-normal` (200ms) | `ease-out` |
| 模态弹出 | `--motion-slow` (320ms) | `cubic-bezier(0.16, 1, 0.3, 1)` |
| 骨架屏 shimmer | 1.4s | `ease-in-out` |

### 8.5 图标一致性

全站统一用 `lucide-react` 描边图标，线宽 2px，尺寸阶梯：12 / 16 / 18 / 20 / 24 / 32 / 48。禁止混用 emoji 与图标（当前 `theme-types.ts` 用 emoji `🌙☀️🌊🍂`，可保留作主题选择器预览，但导航/按钮用图标）。

---

## 九、实施路线图

### P0（必须，影响一致性与可用性）

| 序号 | 任务 | 影响范围 |
| --- | --- | --- |
| P0-1 | 补全语义令牌（`--color-success/warning/danger/info`、`--lab-color-*`、`--focus-ring`、`--z-*`） | `src/index.css` |
| P0-2 | 全站硬编码颜色替换为令牌（161 处，优先 Dashboard/VideoLab/VoiceLab/ExportCenter） | 21 个文件 |
| P0-3 | `AsyncState` 推广到 11 个页面，红字裸错误清零 | 见 §4.3.1 清单 |
| P0-4 | 可点击 div 语义化（加 role/tabIndex/aria/onKeyDown） | ExportCenter/Dashboard/WatermarkLab 等 |
| P0-5 | 移除固定 `min-width: 400px`，WatermarkLab/EnhanceLab 移动端可堆叠 | 2 个 CSS 文件 |

### P1（重要，影响体验）

| 序号 | 任务 | 影响范围 |
| --- | --- | --- |
| P1-1 | `EmptyState` 组件实现 + 11 处空态替换 | 新增组件 + 各页面 |
| P1-2 | Lab 双栏布局变体（参数 sticky + 结果区） | `LabPageLayout` + 7 个 Lab |
| P1-3 | Lab Tab 配色令牌化（`tabs[].color` 接收令牌名） | `LabPageLayout` + 7 个 Lab |
| P1-4 | 面包屑导航新增 | `MainLayout` + 各页面 |
| P1-5 | 表格响应式（Settings 模型清单、TextLab 模型表）移动端转卡片 | 2 处 |
| P1-6 | 模态对话框 ARIA 规范化 + 焦点陷阱 | WatermarkLab/KeyframePreviewPanel/SegmentPreviewModal/ExportModal/ImportVideoModal |
| P1-7 | 信息密度治理（字号 ≥ 0.75rem，gap ≥ 0.4rem） | ImportVideoModal/KeyframePreviewPanel/TextLab |

### P2（优化，提升精致度）

| 序号 | 任务 | 影响范围 |
| --- | --- | --- |
| P2-1 | warm 主题阴影体系柔化 | `src/index.css` |
| P2-2 | 排版层次统一（h1/h2/h3 字号字重） | 全站 |
| P2-3 | Toast 增加动作按钮 + 堆叠上限 | `ToastContext` |
| P2-4 | 确认对话框危险操作按钮带对象名 + 键盘支持 | `ConfirmContext` |
| P2-5 | StoryWorkbench 进度条 5 段彩色可视化 | `StoryWorkbench` |
| P2-6 | 侧边栏宽度响应式（1280px 自动折叠） | `MainLayout` |
| P2-7 | 移动端创作流程指示器紧凑版 | `MainLayout` |
| P2-8 | 刘海屏安全区适配（顶部/横屏左右） | `MainLayout` |

---

## 十、验收指标

### 10.1 量化指标

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 内联 `style` 中硬编码颜色数 | 161 处 | 0 |
| 内联 `style` 中硬编码 `minWidth`/`width` 数 | 75+ 处 | ≤ 10（仅临时定位） |
| `aria-label` 数量 | 3 | ≥ 40（所有可点击非原生元素） |
| `@media` 媒体查询（页面级） | 0 | ≥ 14（7 个 Lab × 2 档断点） |
| `AsyncState` 复用页面数 | 2 | 13 |
| `EmptyState` 复用页面数 | 0 | 11 |
| 红字裸错误（`color: 'lightcoral'`/`#ef4444` 内联） | 8+ | 0 |
| 字号 < 0.75rem 的内联 | 15+ | 0 |
| 固定 `min-width: 400px` | 2 | 0 |

### 10.2 主观验收（4 套主题切换检查）

在 dark / light / blue / **warm**（重点）四套主题下逐页检查：

1. 无「不随主题变化的硬编码色块」；
2. warm 主题下无高饱和色冲突；
3. 对比度 WCAG AA 达标（正文 ≥ 4.5:1，大字号 ≥ 3:1）；
4. 阴影柔和不脏；
5. 焦点环可见且不刺眼。

### 10.3 移动端验收

在 375px（iPhone 12）/ 414px（iPhone 14 Pro Max）/ 768px（iPad）三档下：

1. 无横向滚动；
2. 关键操作触手可及（底部 44px 安全区）；
3. 表格/网格优雅降级；
4. 抽屉式侧边栏开合顺畅。

### 10.4 可访问性验收

- 键盘 Tab 遍历所有交互元素，焦点环可见；
- `Esc` 关闭所有模态；
- 屏幕阅读器（VoiceOver）能正确朗读页面结构；
- `prefers-reduced-motion` 下动效降级为瞬切。

---

## 附录 A：既有组件复用清单

| 组件 | 路径 | 复用建议 |
| --- | --- | --- |
| `AsyncState` | [AsyncState.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/AsyncState.tsx) | 三态统一入口，增加 `EmptyState` 子组件 |
| `PageSkeleton` | [PageSkeleton.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/PageSkeleton.tsx) | 路由级 + 列表级推广 |
| `LabPageLayout` | [LabPageLayout.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/LabPageLayout.tsx) | Tab 配色令牌化 + 双栏变体 |
| `TextAreaWithCounter` | [TextAreaWithCounter.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/TextAreaWithCounter.tsx) | 已良好，全站 Prompt 输入统一用 |
| `ErrorBoundary` | [ErrorBoundary.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/ErrorBoundary.tsx) | 路由级已用，组件级可推广 |
| `TokenUsageBar` | [TokenUsageBar.tsx](file:///Users/ak47wyh/Downloads/work/kt_project/ai-video-studio/src/ui/components/TokenUsageBar.tsx) | 配额展示统一 |

## 附录 B：暖色主题（用户偏好）专项检查

用户偏好暖色护眼基调（见 `user_profile.md`），所有改动须以 warm 主题为默认验收基准：

1. 主色 `#e8956b`（暖橙赭石），辅色 `#d4a574`（暖金）；
2. 背景 `#faf8f5`（暖白），面板 `rgba(255,252,247,0.92)`；
3. 正文 `#3d3530`（暖深灰），辅助 `#6e635a`（暖灰）；
4. 边框 `rgba(120,90,60,0.15)`（暖褐低透明）；
5. 阴影 `rgba(180,140,100,0.12)`（暖褐阴影）；
6. 禁止：纯白 `#fff` 大面积底、纯黑 `#000` 大面积文字、高饱和蓝/紫/绿大色块。

---

> 文档结束。本文档仅描述设计与交互方案，未改动任何代码。评审通过后按 §九 路线图分批落地。
