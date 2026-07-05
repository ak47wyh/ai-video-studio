/**
 * ApiConfigStore — 负责读写 API 配置（Token、BaseURL 等）。
 * 数据持久化到 localStorage，纯前端，无需后端。
 *
 * 安全：敏感配置通过 Web Crypto API（AES-GCM）加密后持久化，
 * 避免在开发者工具中直接看到明文 API Key。
 * 启动时需调用 `await ApiConfigStore.init()` 解密到内存缓存；
 * 此后 load() 同步返回缓存，save() 同步更新缓存并异步加密写入。
 */

import {
  encryptJSON,
  decryptJSON,
  isEncryptedPayload,
  isSecureStorageAvailable,
} from './secureStorage';

// ===== 平台标识类型 =====

/** 平台标识 —— 通用 */
export type PlatformId = 'minimax' | 'volcengine' | 'kling' | 'wan' | 'hunyuan' | 'zhipu' | 'vidu';

/** 主题标识 */
export type ThemeId = 'dark' | 'light' | 'blue' | 'warm';

/** 火山方舟接入协议类型
 *  - openai: 标准后付费模式（Base URL: /api/v3，Authorization: Bearer）
 *  - anthropic: Agent Plan 订阅（Base URL: /api/plan，x-api-key + anthropic-version）
 */
export type VolcArkProtocol = 'openai' | 'anthropic';

// ===== ApiConfig 接口 =====

export interface ApiConfig {
  // --- MiniMax ---
  minimaxApiKey: string;
  minimaxGroupId: string;
  minimaxBaseUrl: string;
  minimaxAnthropicBaseUrl: string;

  // --- 火山方舟（Ark）---
  volcArkApiKey: string;
  volcArkBaseUrl: string;
  /** Anthropic 协议 Base URL（Agent Plan 专属，如 https://ark.cn-beijing.volces.com/api/plan） */
  volcArkAnthropicBaseUrl: string;
  /** 接入协议选择：openai=标准后付费，anthropic=Agent Plan 订阅 */
  volcArkProtocol: VolcArkProtocol;
  /** Anthropic 协议下使用的文本模型 ID（Agent Plan 支持的模型，如 doubao-seed-2.0-pro） */
  volcArkAnthropicModel: string;
  /** Anthropic 协议 CORS 拦截时是否自动降级到 OpenAI 协议（默认 true）。
   *  Agent Plan 用户直连 ark.cn-beijing.volces.com 时浏览器预检会因 anthropic-version
   *  头被拒，降级到 OpenAI 协议可恢复文本生成能力（注意计费模式差异）。 */
  volcArkAutoFallback: boolean;

  // --- 火山引擎语音技术（声音复刻 + 大模型 TTS，独立于方舟 Ark 体系）---
  /** 语音技术 AppID（从火山引擎控制台「语音技术」获取，与方舟 APIKey 不同体系） */
  volcVoiceAppId: string;
  /** 语音技术 Access Token（鉴权头格式为 `Bearer;<Token>`，注意分号分隔） */
  volcVoiceAccessToken: string;
  /** 业务集群：volcano_tts（标准音色）/ volcano_icl（复刻字符版）/ volcano_icl_concurr（复刻并发版） */
  volcVoiceCluster: string;
  /** 声音复刻模型版本：1=ICL1.0 / 2=DiT标准 / 3=DiT还原 / 4=ICL2.0 */
  volcVoiceCloneModelType: 0 | 1 | 2 | 3 | 4;

  // --- 可灵 Kling（快手） ---
  klingAccessKey: string;
  klingSecretKey: string;
  klingBaseUrl: string;

  // --- 通义万相 Wan（阿里 DashScope） ---
  wanApiKey: string;
  wanBaseUrl: string;

  // --- 腾讯混元 Hunyuan ---
  hunyuanSecretId: string;
  hunyuanSecretKey: string;
  hunyuanBaseUrl: string;

  // --- 智谱 CogVideoX / GLM ---
  zhipuApiKey: string;
  zhipuBaseUrl: string;

  // --- Vidu（生数科技） ---
  viduApiKey: string;
  viduBaseUrl: string;

  // --- 激活的平台（唯一可用）---
  activePlatform: PlatformId;

  // --- 主题设置 ---
  theme: ThemeId;

  // --- 开发者工具 ---
  vconsoleEnabled: boolean;
}

const STORAGE_KEY = 'ai_video_studio_api_config';

// ===== 默认值 =====

// 所有平台默认直连完整外部 URL,DEV 与 PROD 行为一致。
// 按设计约束不做 CORS 处理：不可直连的平台视为能力不可用，UI 自动置灰。
const DEFAULT_CONFIG: ApiConfig = {
  // MiniMax 默认值
  minimaxApiKey: '',
  minimaxGroupId: '',
  minimaxBaseUrl: 'https://api.minimaxi.com/v1',
  minimaxAnthropicBaseUrl: 'https://api.minimaxi.com/anthropic',

  // 火山方舟默认值
  volcArkApiKey: '',
  volcArkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  volcArkAnthropicBaseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
  // 默认 Anthropic 协议（Agent Plan 订阅）：进入设置页默认显示 Anthropic Base URL，
  // 用户可通过下拉框切换到 OpenAI 协议配置 OpenAI 格式 URL。
  volcArkProtocol: 'anthropic' as VolcArkProtocol,
  volcArkAnthropicModel: 'doubao-seed-2.0-pro',
  // Anthropic CORS 拦截时自动降级到 OpenAI 协议（默认开启，可由设置页关闭）
  volcArkAutoFallback: true,

  // 火山引擎语音技术默认值（独立于方舟 Ark，需单独开通语音技术服务）
  volcVoiceAppId: '',
  volcVoiceAccessToken: '',
  volcVoiceCluster: 'volcano_icl',  // 默认复刻字符版集群
  volcVoiceCloneModelType: 1,        // 默认 ICL 1.0 模型

  // 可灵 Kling 默认值
  klingAccessKey: '',
  klingSecretKey: '',
  klingBaseUrl: 'https://api.klingai.com',

  // 通义万相 Wan 默认值
  wanApiKey: '',
  wanBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',

  // 腾讯混元 Hunyuan 默认值
  hunyuanSecretId: '',
  hunyuanSecretKey: '',
  hunyuanBaseUrl: 'https://hunyuan.tencentcloudapi.com',

  // 智谱 Zhipu 默认值
  zhipuApiKey: '',
  zhipuBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',

  // Vidu 默认值
  viduApiKey: '',
  viduBaseUrl: 'https://api.vidu.cn',

  // 默认激活 MiniMax
  activePlatform: 'minimax',

  // 主题默认值
  theme: 'dark' as ThemeId,

  // 开发者工具默认值
  vconsoleEnabled: false,
};

// 旧版 DEV 代理路径 → 完整外部 URL 的迁移映射。
// 直连架构下不再使用代理路径,需把 localStorage 中残留的旧值替换为默认完整 URL。
const PROXY_PATH_MIGRATIONS: Record<string, Partial<ApiConfig>> = {
  '/anthropic': { minimaxAnthropicBaseUrl: DEFAULT_CONFIG.minimaxAnthropicBaseUrl },
  '/kling': { klingBaseUrl: DEFAULT_CONFIG.klingBaseUrl },
  '/wan': { wanBaseUrl: DEFAULT_CONFIG.wanBaseUrl },
  '/hunyuan': { hunyuanBaseUrl: DEFAULT_CONFIG.hunyuanBaseUrl },
  '/zhipu': { zhipuBaseUrl: DEFAULT_CONFIG.zhipuBaseUrl },
  '/vidu': { viduBaseUrl: DEFAULT_CONFIG.viduBaseUrl },
  '/volcengine-ark': { volcArkBaseUrl: DEFAULT_CONFIG.volcArkBaseUrl },
};

export const ApiConfigStore = {
  /** 内存缓存（init 后填充，load 同步返回） */
  _cache: null as ApiConfig | null,

  /** 平台变更订阅监听器集合（发布订阅模式，避免引入 React Context 全局重渲染） */
  _platformListeners: new Set<(platform: PlatformId) => void>(),

  /**
   * 订阅激活平台变更事件。
   * 返回取消订阅函数，配合 useEffect 的清理逻辑使用，避免监听器泄漏。
   *
   * 设计意图：Settings 页切换平台后，MainLayout 侧边栏徽标需要即时刷新。
   * 走发布订阅而非 Context，是为了避免全局重渲染开销，并保持 ApiConfigStore
   * 在 adapter 层的纯 TS 单例性质（不依赖 React）。
   */
  subscribePlatform(listener: (platform: PlatformId) => void): () => void {
    this._platformListeners.add(listener);
    return () => {
      this._platformListeners.delete(listener);
    };
  },

  /** 通知所有订阅者平台已变更（仅在 activePlatform 实际变化时触发） */
  _notifyPlatformChange(platform: PlatformId): void {
    this._platformListeners.forEach(fn => {
      try {
        fn(platform);
      } catch (err) {
        console.error('[ApiConfigStore] 平台变更监听器执行异常:', err);
      }
    });
  },

  /** 迁移旧版 DEV 代理路径 → 完整外部 URL（直连架构） */
  _migrateProxyPaths(config: ApiConfig): ApiConfig {
    for (const proxyPath of Object.keys(PROXY_PATH_MIGRATIONS) as Array<keyof typeof PROXY_PATH_MIGRATIONS>) {
      const migration = PROXY_PATH_MIGRATIONS[proxyPath];
      for (const field of Object.keys(migration) as Array<keyof ApiConfig>) {
        if (config[field] === proxyPath) {
          // 迁移字段均为 string 类型（baseUrl），安全断言
          (config as unknown as Record<string, string>)[field as string] = migration[field] as string;
        }
      }
    }
    return config;
  },

  /**
   * 启动时异步初始化：解密 localStorage 中的密文到内存缓存。
   * 必须在渲染前调用一次（main.tsx），以便 load() 能同步返回正确配置。
   * - 密文：解密并迁移代理路径
   * - 旧明文 JSON：解析、迁移，并立即加密重写（一次性升级）
   * - 无数据：使用默认配置
   * - Web Crypto 不可用：降级为明文读写
   */
  async init(): Promise<void> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this._cache = { ...DEFAULT_CONFIG };
        return;
      }
      if (isEncryptedPayload(raw)) {
        const config = this._migrateProxyPaths({ ...DEFAULT_CONFIG, ...await decryptJSON<ApiConfig>(raw) });
        this._cache = config;
      } else {
        // 旧版明文：解析、迁移，并异步加密重写升级
        const config = this._migrateProxyPaths({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
        this._cache = config;
        void this._persistEncrypted(config);
      }
    } catch {
      this._cache = { ...DEFAULT_CONFIG };
    }
  },

  /** 加密并写入 localStorage（异步，失败静默降级明文） */
  async _persistEncrypted(config: ApiConfig): Promise<void> {
    try {
      if (!isSecureStorageAvailable()) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        return;
      }
      const payload = await encryptJSON(config);
      localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      // 加密失败时降级为明文，保证可用性优先
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
    }
  },

  load(): ApiConfig {
    // 优先返回内存缓存（init 后的常态）
    if (this._cache) return this._cache;
    // 未 init 的降级路径：同步读 localStorage（兼容旧调用方 / 测试环境）
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      if (isEncryptedPayload(raw)) {
        // 密文无法同步解密，返回默认值（init 完成后会被纠正）
        return { ...DEFAULT_CONFIG };
      }
      return this._migrateProxyPaths({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  },

  save(config: ApiConfig): void {
    // 检测平台是否变化（在覆盖缓存前捕获旧值）
    const prevPlatform = this._cache?.activePlatform;
    // 同步更新内存缓存
    this._cache = config;
    // 异步加密持久化（不阻塞调用方）
    void this._persistEncrypted(config);
    // 平台实际变化时通知订阅者（避免相同平台重复触发）
    if (prevPlatform !== undefined && prevPlatform !== config.activePlatform) {
      this._notifyPlatformChange(config.activePlatform);
    }
    // 脱敏日志：仅输出激活平台与各平台配置状态，不输出 Key 内容
    const summary = {
      activePlatform: config.activePlatform,
      minimax: !!config.minimaxApiKey.trim(),
      volcengine: !!config.volcArkApiKey.trim() &&
        ((config.volcArkProtocol === 'openai' && !!config.volcArkBaseUrl.trim()) ||
         (config.volcArkProtocol === 'anthropic' && !!config.volcArkAnthropicBaseUrl.trim())),
      kling: !!config.klingAccessKey.trim() && !!config.klingSecretKey.trim(),
      wan: !!config.wanApiKey.trim(),
      hunyuan: !!config.hunyuanSecretId.trim() && !!config.hunyuanSecretKey.trim(),
      zhipu: !!config.zhipuApiKey.trim(),
      vidu: !!config.viduApiKey.trim(),
    };
    // 使用 console 输出脱敏摘要（ApiConfigStore 是底层适配器，不注入 logger 以避免循环依赖）
    console.log('[ApiConfigStore] 配置已保存:', summary);
  },

  /** 自动保存（防抖调用） */
  autoSave(config: ApiConfig): void {
    this.save(config);
  },

  get<K extends keyof ApiConfig>(key: K): ApiConfig[K] {
    return this.load()[key];
  },

  /** 判断指定平台是否已配置（有有效 Token） */
  isPlatformConfigured(platform: PlatformId): boolean {
    const config = this.load();
    switch (platform) {
      case 'minimax': return !!config.minimaxApiKey.trim();
      case 'volcengine':
        // 方舟 Ark 文本/视频/图片能力：仅需 API Key + Base URL
        // 语音能力（克隆/TTS）需额外配置 AppID/Token/Cluster，由调用方按需校验
        return !!config.volcArkApiKey.trim() &&
          ((config.volcArkProtocol === 'openai' && !!config.volcArkBaseUrl.trim()) ||
           (config.volcArkProtocol === 'anthropic' && !!config.volcArkAnthropicBaseUrl.trim()));
      case 'kling': return !!config.klingAccessKey.trim() && !!config.klingSecretKey.trim();
      case 'wan': return !!config.wanApiKey.trim();
      case 'hunyuan': return !!config.hunyuanSecretId.trim() && !!config.hunyuanSecretKey.trim();
      case 'zhipu': return !!config.zhipuApiKey.trim();
      case 'vidu': return !!config.viduApiKey.trim();
      default: return false;
    }
  },

  /** 获取当前激活的平台 */
  getActivePlatform(): PlatformId {
    return this.load().activePlatform;
  },

  /** 判断火山引擎语音技术（声音复刻 + 大模型 TTS）是否已配置完整。
   *  语音能力独立于方舟 Ark 体系，需单独配置 AppID/Token/Cluster 三件套。
   *  调用方（如 VoiceLab UI、PlatformSwitcher）应在使用克隆/TTS 前校验。 */
  isVolcVoiceConfigured(): boolean {
    const config = this.load();
    return !!config.volcVoiceAppId.trim() &&
      !!config.volcVoiceAccessToken.trim() &&
      !!config.volcVoiceCluster.trim();
  },
};