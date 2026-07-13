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
// 依赖反转：类型定义迁到 domain/entities/platform.ts，
// 此处 re-export 以保持 adapters 层对外 API 兼容。

export type { PlatformId, ThemeId, VolcArkProtocol, ApiConfig } from '../../../domain/entities/platform';
import type { PlatformId, ThemeId, VolcArkProtocol, ApiConfig } from '../../../domain/entities/platform';

// ===== ApiConfig 接口 =====
// （类型已迁移到 domain 层，此处仅为向后兼容保留 re-export；
//   如需修改字段结构，请直接编辑 domain/entities/platform.ts）

const STORAGE_KEY = 'ai_video_studio_api_config';

// ===== 默认值 =====

// CORS 策略：MiniMax 直连（平台已支持 CORS），火山引擎开发环境走 Vite proxy。
// - 开发环境 (import.meta.env.DEV)：火山 baseURL 用相对路径 /volc-ark/*，由 vite.config.ts 的 server.proxy 转发
// - 生产环境 (import.meta.env.PROD)：火山 baseURL 直连官方域名，需部署 nginx 反代相同路径
// - MiniMax 始终直连 https://api.minimaxi.com，不随环境变化
const IS_DEV = import.meta.env.DEV;

// 火山方舟 baseURL：开发环境走 /volc-ark proxy 规避 CORS，生产环境直连官方域名
const VOLC_ARK_BASE_URL = IS_DEV
  ? '/volc-ark/api/v3'
  : 'https://ark.cn-beijing.volces.com/api/v3';
const VOLC_ARK_ANTHROPIC_BASE_URL = IS_DEV
  ? '/volc-ark/api/plan'
  : 'https://ark.cn-beijing.volces.com/api/plan';

const DEFAULT_CONFIG: ApiConfig = {
  // MiniMax 默认值（始终直连，平台已支持 CORS）
  minimaxApiKey: '',
  minimaxGroupId: '',
  minimaxBaseUrl: 'https://api.minimaxi.com/v1',
  minimaxAnthropicBaseUrl: 'https://api.minimaxi.com/anthropic',

  // 火山方舟默认值（开发环境走 proxy，生产环境直连）
  volcArkApiKey: '',
  volcArkBaseUrl: VOLC_ARK_BASE_URL,
  volcArkAnthropicBaseUrl: VOLC_ARK_ANTHROPIC_BASE_URL,
  // 默认 Anthropic 协议（Agent Plan 订阅）：进入设置页默认显示 Anthropic Base URL，
  // 用户可通过下拉框切换到 OpenAI 协议配置 OpenAI 格式 URL。
  volcArkProtocol: 'anthropic' as VolcArkProtocol,
  volcArkAnthropicModel: 'doubao-seed-2.0-pro',
  // Anthropic CORS 拦截时自动降级到 OpenAI 协议（默认开启，可由设置页关闭）
  volcArkAutoFallback: true,
  // 视频生成模型 ID（对齐官方 Model ID，详见 https://www.volcengine.com/docs/82379/1330310）
  volcArkVideoModel: 'doubao-seedance-1-0-pro-250528',
  // 图片生成模型 ID（Seedream 4.5 最新版本）
  volcArkImageModel: 'doubao-seedream-4-5-251128',
  // Ark TTS 模型 ID
  volcArkTtsModel: 'doubao-tts-base',

  // 火山引擎语音技术默认值（独立于方舟 Ark，需单独开通语音技术服务）
  volcVoiceAppId: '',
  volcVoiceAccessToken: '',
  volcVoiceCluster: 'volcano_icl',          // 克隆音色 cluster
  volcVoiceStandardCluster: 'volcano_tts',  // 标准音色 cluster（P0 修复：与克隆 cluster 分离）
  volcVoiceCloneModelType: 1,                // 默认 ICL 1.0 模型

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

// 旧版 DEV 代理路径迁移映射。
// 迁移目标自动跟随 DEFAULT_CONFIG：开发环境迁移到 /volc-ark/*（新 proxy 路径），
// 生产环境迁移到完整外部 URL。其他旧代理路径（/anthropic /kling 等）迁移到完整 URL。
const PROXY_PATH_MIGRATIONS: Record<string, Partial<ApiConfig>> = {
  '/anthropic': { minimaxAnthropicBaseUrl: DEFAULT_CONFIG.minimaxAnthropicBaseUrl },
  '/kling': { klingBaseUrl: DEFAULT_CONFIG.klingBaseUrl },
  '/wan': { wanBaseUrl: DEFAULT_CONFIG.wanBaseUrl },
  '/hunyuan': { hunyuanBaseUrl: DEFAULT_CONFIG.hunyuanBaseUrl },
  '/zhipu': { zhipuBaseUrl: DEFAULT_CONFIG.zhipuBaseUrl },
  '/vidu': { viduBaseUrl: DEFAULT_CONFIG.viduBaseUrl },
  '/volcengine-ark': { volcArkBaseUrl: DEFAULT_CONFIG.volcArkBaseUrl },
  // 旧版完整官方 URL 迁移：开发环境自动切换到 /volc-ark/* proxy 路径规避 CORS，
  // 生产环境保持官方 URL（需部署 nginx 反代）。
  // 解决用户 localStorage 中残留的直连 URL 导致 CORS 拦截的问题。
  'https://ark.cn-beijing.volces.com/api/v3': { volcArkBaseUrl: DEFAULT_CONFIG.volcArkBaseUrl },
  'https://ark.cn-beijing.volces.com/api/plan': { volcArkAnthropicBaseUrl: DEFAULT_CONFIG.volcArkAnthropicBaseUrl },
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
        // 迁移后若字段有变化，重新加密持久化，避免下次启动重复迁移
        void this._persistEncrypted(config);
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