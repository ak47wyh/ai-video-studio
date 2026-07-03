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
export type PlatformId = 'minimax' | 'volcengine' | 'coze' | 'kling' | 'wan' | 'hunyuan' | 'zhipu' | 'vidu';

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

  // --- Coze ---
  cozePatToken: string;
  cozeBaseUrl: string;
  cozeSpaceId: string;

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
  volcArkProtocol: 'openai' as VolcArkProtocol,
  volcArkAnthropicModel: 'doubao-seed-2.0-pro',

  // Coze 默认值
  cozePatToken: '',
  cozeBaseUrl: 'https://api.coze.cn',
  cozeSpaceId: '',

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
  '/coze': { cozeBaseUrl: DEFAULT_CONFIG.cozeBaseUrl },
};

export const ApiConfigStore = {
  /** 内存缓存（init 后填充，load 同步返回） */
  _cache: null as ApiConfig | null,

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
    // 同步更新内存缓存
    this._cache = config;
    // 异步加密持久化（不阻塞调用方）
    void this._persistEncrypted(config);
    // 脱敏日志：仅输出激活平台与各平台配置状态，不输出 Key 内容
    const summary = {
      activePlatform: config.activePlatform,
      minimax: !!config.minimaxApiKey.trim(),
      volcengine: !!config.volcArkApiKey.trim() &&
        ((config.volcArkProtocol === 'openai' && !!config.volcArkBaseUrl.trim()) ||
         (config.volcArkProtocol === 'anthropic' && !!config.volcArkAnthropicBaseUrl.trim())),
      coze: !!config.cozePatToken.trim(),
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
        return !!config.volcArkApiKey.trim() &&
          ((config.volcArkProtocol === 'openai' && !!config.volcArkBaseUrl.trim()) ||
           (config.volcArkProtocol === 'anthropic' && !!config.volcArkAnthropicBaseUrl.trim()));
      case 'coze': return !!config.cozePatToken.trim();
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
};