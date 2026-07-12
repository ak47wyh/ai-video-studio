/**
 * 平台/主题/协议标识 —— 领域层单一权威定义。
 *
 * 说明：
 * - 依赖方向铁律：`domain` 永远不依赖 `adapters`。此文件将平台/主题相关的
 *   字面量联合类型从 adapters 层迁入领域层，adapters 层反向 re-export
 *   以保持既有对外 API 兼容。
 * - 修改此文件的类型定义时，需要同步更新：
 *   1. `src/domain/services/platformCapabilities.ts` 的 `PLATFORM_METADATA`
 *   2. `src/adapters/outbound/config/ApiConfigStore.ts` 的 `DEFAULT_CONFIG`
 *   3. i18n 中的平台名/主题名文案
 */

/** 平台标识 —— 通用 */
export type PlatformId =
  | 'minimax'
  | 'volcengine'
  | 'kling'
  | 'wan'
  | 'hunyuan'
  | 'zhipu'
  | 'vidu';

/** 主题标识 */
export type ThemeId = 'dark' | 'light' | 'blue' | 'warm';

/** 火山方舟接入协议类型
 *  - openai: 标准后付费模式（Base URL: /api/v3，Authorization: Bearer）
 *  - anthropic: Agent Plan 订阅（Base URL: /api/plan，x-api-key + anthropic-version）
 */
export type VolcArkProtocol = 'openai' | 'anthropic';

/**
 * API 配置数据结构 —— 各平台的 Key / BaseURL / 协议参数集合。
 *
 * 存放于领域层的理由：
 *   PlatformRouter、各 Service 都以 ApiConfig 作为决策输入，属于跨层共享的
 *   领域数据契约。持久化实现由 adapter 层（ApiConfigStore）负责。
 */
export interface ApiConfig {
  // --- MiniMax ---
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxBaseUrl: string;
  minimaxAnthropicBaseUrl: string;

  // --- 火山方舟（Ark）---
  volcArkApiKey: string;
  volcArkBaseUrl: string;
  /** Anthropic 协议 Base URL（Agent Plan 专属） */
  volcArkAnthropicBaseUrl: string;
  /** 接入协议选择：openai=标准后付费，anthropic=Agent Plan 订阅 */
  volcArkProtocol: VolcArkProtocol;
  /** Anthropic 协议下使用的文本模型 ID */
  volcArkAnthropicModel: string;
  /** Anthropic 协议 CORS 拦截时是否自动降级到 OpenAI 协议（默认 true） */
  volcArkAutoFallback: boolean;

  // --- 火山引擎语音技术 ---
  volcVoiceAppId: string;
  volcVoiceAccessToken: string;
  volcVoiceCluster: string;
  volcVoiceCloneModelType: 0 | 1 | 2 | 3 | 4;

  // --- 可灵 Kling ---
  klingAccessKey: string;
  klingSecretKey: string;
  klingBaseUrl: string;

  // --- 通义万相 Wan ---
  wanApiKey: string;
  wanBaseUrl: string;

  // --- 腾讯混元 Hunyuan ---
  hunyuanSecretId: string;
  hunyuanSecretKey: string;
  hunyuanBaseUrl: string;

  // --- 智谱 ---
  zhipuApiKey: string;
  zhipuBaseUrl: string;

  // --- Vidu ---
  viduApiKey: string;
  viduBaseUrl: string;

  // --- 激活平台 ---
  activePlatform: PlatformId;

  // --- 主题 ---
  theme: ThemeId;

  // --- 开发者工具 ---
  vconsoleEnabled: boolean;
}
