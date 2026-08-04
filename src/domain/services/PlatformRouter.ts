import type { ApiConfig, PlatformId } from '../entities/platform';
import type { IVideoGeneratorPort, IImageGeneratorPort, ITextGenerationPort, IVoicePort, IMusicPort } from '../ports/OutboundPorts';
import type { IApiConfigStore, IPlatformCapabilitiesPort, PlatformCapability } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';

// 导入适配器 —— 已有平台
import { MiniMaxVideoAdapter } from '../../adapters/outbound/api/MiniMaxVideoAdapter';
import { MiniMaxImageAdapter } from '../../adapters/outbound/api/MiniMaxImageAdapter';
import { MiniMaxTextAdapter } from '../../adapters/outbound/api/MiniMaxTextAdapter';
import { MiniMaxVoiceAdapter } from '../../adapters/outbound/api/MiniMaxVoiceAdapter';
import { MiniMaxMusicAdapter } from '../../adapters/outbound/api/MiniMaxMusicAdapter';
import { VolcengineVideoAdapter } from '../../adapters/outbound/api/volcengine/VolcengineVideoAdapter';
import { VolcengineImageAdapter } from '../../adapters/outbound/api/volcengine/VolcengineImageAdapter';
import { VolcengineTextAdapter } from '../../adapters/outbound/api/volcengine/VolcengineTextAdapter';
import { VolcengineVoiceAdapter } from '../../adapters/outbound/api/volcengine/VolcengineVoiceAdapter';
// 死代码清理（Architecture_Refactor_Design §9.1）：
//   Volcengine3D/Cache/Response 三个 Adapter 及对应 resolve3D/resolveCache/resolveResponse 方法零消费方，
//   已从 PlatformRouter 移除。若未来需要接入需在 Router 与 dependencies 装配点重新注册。

// 导入适配器 —— 新增 5 个平台
import { KlingVideoAdapter } from '../../adapters/outbound/api/kling/KlingVideoAdapter';
import { KlingImageAdapter } from '../../adapters/outbound/api/kling/KlingImageAdapter';
import { WanVideoAdapter } from '../../adapters/outbound/api/wan/WanVideoAdapter';
import { WanImageAdapter } from '../../adapters/outbound/api/wan/WanImageAdapter';
import { WanTextAdapter } from '../../adapters/outbound/api/wan/WanTextAdapter';
import { WanVoiceAdapter } from '../../adapters/outbound/api/wan/WanVoiceAdapter';
import { HunyuanVideoAdapter } from '../../adapters/outbound/api/hunyuan/HunyuanVideoAdapter';
import { HunyuanImageAdapter } from '../../adapters/outbound/api/hunyuan/HunyuanImageAdapter';
import { HunyuanTextAdapter } from '../../adapters/outbound/api/hunyuan/HunyuanTextAdapter';
import { HunyuanVoiceAdapter } from '../../adapters/outbound/api/hunyuan/HunyuanVoiceAdapter';
import { ZhipuVideoAdapter } from '../../adapters/outbound/api/zhipu/ZhipuVideoAdapter';
import { ZhipuImageAdapter } from '../../adapters/outbound/api/zhipu/ZhipuImageAdapter';
import { ZhipuTextAdapter } from '../../adapters/outbound/api/zhipu/ZhipuTextAdapter';
import { ZhipuVoiceAdapter } from '../../adapters/outbound/api/zhipu/ZhipuVoiceAdapter';
import { ViduVideoAdapter } from '../../adapters/outbound/api/vidu/ViduVideoAdapter';
import { ViduImageAdapter } from '../../adapters/outbound/api/vidu/ViduImageAdapter';

import { apiConfigStoreAdapter } from '../../adapters/outbound/config/ApiConfigStoreAdapter';
import { platformCapabilitiesAdapter } from '../../adapters/outbound/infrastructure/PlatformCapabilitiesAdapter';
import { UnsupportedCapabilityError } from '../errors/UnsupportedCapabilityError';

/**
 * 平台路由器（Phase 3 OCP 重构：注册表模式）
 *
 * 设计要点：
 * - 内部维护 `Map<PlatformCapability, Map<PlatformId, Factory>>` 注册表，
 *   新增平台只需在 `registerDefaults()` 添加一行，零改动 resolve 主体（OCP 闭合）。
 * - 适配器实例按 `(capability, platform)` 缓存，平台切换时 reset 清空全部缓存。
 * - 双协议并存架构：Video/Image 永远走 OpenAI 协议，不再因 Anthropic 协议拦截。
 *   `volcArkTextProtocol` 仅影响 Text 能力的协议选择。
 *
 * 兼容性：保留 `resolveVideo/resolveImage/resolveText/resolveVoice/resolveMusic`
 * 公共 API 不变，调用方无需修改。
 */
type AdapterFactory<T> = (config: ApiConfig) => T;

interface CachedAdapter {
  platform: PlatformId;
  instance: unknown;
}

export class PlatformRouter {
  private configStore: IApiConfigStore;
  private capabilities: IPlatformCapabilitiesPort;
  private logger: ILoggerPort;
  /** 注册表：capability → platform → factory */
  private readonly registry = new Map<PlatformCapability, Map<PlatformId, AdapterFactory<unknown>>>();
  /** 实例缓存：capability → 已实例化的 adapter */
  private readonly cache = new Map<PlatformCapability, CachedAdapter>();

  constructor(
    configStore: IApiConfigStore = apiConfigStoreAdapter,
    capabilities: IPlatformCapabilitiesPort = platformCapabilitiesAdapter,
    logger: ILoggerPort,
  ) {
    this.configStore = configStore;
    this.capabilities = capabilities;
    this.logger = logger;
    this.registerDefaults();
    this.configStore.onPlatformChange(() => {
      this.reset();
    });
  }

  /** 注册全部已知平台×能力的工厂函数（OCP：新增平台在此追加即可） */
  private registerDefaults(): void {
    // video（7 平台）-- VolcengineVideoAdapter 注入 logger 用于接口出入参日志
    this.register('video', 'volcengine', (c) => new VolcengineVideoAdapter(c, this.logger));
    this.register('video', 'kling', (c) => new KlingVideoAdapter(c));
    this.register('video', 'wan', (c) => new WanVideoAdapter(c));
    this.register('video', 'hunyuan', (c) => new HunyuanVideoAdapter(c));
    this.register('video', 'zhipu', (c) => new ZhipuVideoAdapter(c));
    this.register('video', 'vidu', (c) => new ViduVideoAdapter(c));
    this.register('video', 'minimax', (c) => new MiniMaxVideoAdapter(c, this.logger));

    // image（7 平台）-- 注入 logger 用于接口出入参日志
    this.register('image', 'volcengine', (c) => new VolcengineImageAdapter(c, this.logger));
    this.register('image', 'kling', (c) => new KlingImageAdapter(c, this.logger));
    this.register('image', 'wan', (c) => new WanImageAdapter(c, this.logger));
    this.register('image', 'hunyuan', (c) => new HunyuanImageAdapter(c));
    this.register('image', 'zhipu', (c) => new ZhipuImageAdapter(c, this.logger));
    this.register('image', 'vidu', (c) => new ViduImageAdapter(c, this.logger));
    this.register('image', 'minimax', (c) => new MiniMaxImageAdapter(c, this.logger));

    // text（5 平台）-- 注入 logger 用于接口出入参日志
    this.register('text', 'volcengine', (c) => new VolcengineTextAdapter(c, this.logger));
    this.register('text', 'wan', (c) => new WanTextAdapter(c, this.logger));
    this.register('text', 'hunyuan', (c) => new HunyuanTextAdapter(c, this.logger));
    this.register('text', 'zhipu', (c) => new ZhipuTextAdapter(c, this.logger));
    this.register('text', 'minimax', (c) => new MiniMaxTextAdapter(c, this.logger));

    // voice（5 平台；火山引擎语音独立于方舟协议）-- 注入 logger
    this.register('voice', 'volcengine', (c) => new VolcengineVoiceAdapter(c, this.logger));
    this.register('voice', 'wan', (c) => new WanVoiceAdapter(c));
    this.register('voice', 'hunyuan', (c) => new HunyuanVoiceAdapter(c));
    this.register('voice', 'zhipu', (c) => new ZhipuVoiceAdapter(c));
    this.register('voice', 'minimax', (c) => new MiniMaxVoiceAdapter(c, this.logger));

    // music（仅 MiniMax；其他平台通过 ensureCap 拦截，符合 P2-6 修复）-- 注入 logger
    this.register('music', 'minimax', (c) => new MiniMaxMusicAdapter(c, this.logger));
  }

  /** 注册某 (capability, platform) 的工厂 */
  register<T>(capability: PlatformCapability, platform: PlatformId, factory: AdapterFactory<T>): void {
    let capMap = this.registry.get(capability);
    if (!capMap) {
      capMap = new Map();
      this.registry.set(capability, capMap);
    }
    capMap.set(platform, factory as AdapterFactory<unknown>);
  }

  /** 取消注册（capability 省略时清除该平台所有能力） */
  unregister(platform: PlatformId, capability?: PlatformCapability): void {
    if (capability) {
      this.registry.get(capability)?.delete(platform);
    } else {
      for (const capMap of this.registry.values()) {
        capMap.delete(platform);
      }
    }
  }

  /** 查询某平台是否声明支持某能力（基于注册表） */
  hasRegistered(platform: PlatformId, capability: PlatformCapability): boolean {
    return this.registry.get(capability)?.has(platform) ?? false;
  }

  resolve(capability: 'video', config: ApiConfig): IVideoGeneratorPort;
  resolve(capability: 'image', config: ApiConfig): IImageGeneratorPort;
  resolve(capability: 'text', config: ApiConfig): ITextGenerationPort;
  resolve(capability: 'voice', config: ApiConfig): IVoicePort;
  resolve(capability: 'music', config: ApiConfig): IMusicPort;
  resolve(capability: string, config: ApiConfig): unknown {
    switch (capability) {
      case 'video': return this.resolveVideo(config);
      case 'image': return this.resolveImage(config);
      case 'text': return this.resolveText(config);
      case 'voice': return this.resolveVoice(config);
      case 'music': return this.resolveMusic(config);
      default: throw new Error(`Unsupported capability: ${capability}`);
    }
  }

  private ensureCap(platform: PlatformId, cap: PlatformCapability): void {
    if (!this.capabilities.hasCapability(platform, cap)) {
      throw new UnsupportedCapabilityError(platform, cap as 'video' | 'image' | 'text' | 'voice' | 'music');
    }
  }

  /** 通用解析：从注册表查工厂 → 实例化 → 缓存 */
  private resolveAdapter<T>(capability: PlatformCapability, config: ApiConfig): T {
    const platform = config.activePlatform;
    const capMap = this.registry.get(capability);
    if (!capMap || !capMap.has(platform)) {
      throw new UnsupportedCapabilityError(platform, capability as 'video' | 'image' | 'text' | 'voice' | 'music');
    }
    const cached = this.cache.get(capability);
    if (cached && cached.platform === platform) {
      return cached.instance as T;
    }
    const factory = capMap.get(platform)!;
    const instance = factory(config) as T;
    this.cache.set(capability, { platform, instance });
    return instance;
  }

  resolveVideo(config: ApiConfig): IVideoGeneratorPort {
    this.ensureCap(config.activePlatform, 'video');
    // 双协议并存架构：Video 永远走 OpenAI 协议，不再因 Anthropic 协议拦截
    return this.resolveAdapter<IVideoGeneratorPort>('video', config);
  }

  resolveImage(config: ApiConfig): IImageGeneratorPort {
    this.ensureCap(config.activePlatform, 'image');
    // 双协议并存架构：Image 永远走 OpenAI 协议，不再因 Anthropic 协议拦截
    return this.resolveAdapter<IImageGeneratorPort>('image', config);
  }

  resolveText(config: ApiConfig): ITextGenerationPort {
    this.ensureCap(config.activePlatform, 'text');
    return this.resolveAdapter<ITextGenerationPort>('text', config);
  }

  resolveVoice(config: ApiConfig): IVoicePort {
    this.ensureCap(config.activePlatform, 'voice');
    // 火山引擎语音技术（声音复刻 + 大模型 TTS）独立于方舟 Ark 体系，
    // 走原生语音端点（openspeech.bytedance.com），与 volcArkTextProtocol 无关。
    // 因此 Anthropic 协议（Agent Plan）下语音能力仍然可用，不再拦截。
    return this.resolveAdapter<IVoicePort>('voice', config);
  }

  resolveMusic(config: ApiConfig): IMusicPort {
    this.ensureCap(config.activePlatform, 'music');
    // P2-6 修复：music 能力仅 MiniMax 声明支持（platformCapabilities.ts）；
    // 注册表未注册的平台会抛 UnsupportedCapabilityError，避免静默 fallback。
    return this.resolveAdapter<IMusicPort>('music', config);
  }

  hasCapability(capability: PlatformCapability): boolean {
    return this.capabilities.hasCapability(this.getActivePlatform(), capability);
  }

  getActivePlatform(): PlatformId {
    return this.configStore.getActivePlatform();
  }

  reset(): void {
    this.cache.clear();
  }
}
