import type { ApiConfig, PlatformId } from '../../adapters/outbound/config/ApiConfigStore';
import type { IVideoGeneratorPort, IImageGeneratorPort, ITextGenerationPort, IVoicePort, IMusicPort } from '../ports/OutboundPorts';
import type { IThreeDGenerationPort, IContextCachePort, IModelResponsePort } from '../ports/VolcenginePorts';
import type { IApiConfigStore, IPlatformCapabilitiesPort, PlatformCapability } from '../ports/PlatformPorts';

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
import { Volcengine3DAdapter } from '../../adapters/outbound/api/volcengine/Volcengine3DAdapter';
import { VolcengineCacheAdapter } from '../../adapters/outbound/api/volcengine/VolcengineCacheAdapter';
import { VolcengineResponseAdapter } from '../../adapters/outbound/api/volcengine/VolcengineResponseAdapter';

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

// 适配器实例缓存
let _videoAdapter: IVideoGeneratorPort | null = null;
let _imageAdapter: IImageGeneratorPort | null = null;
let _textAdapter: ITextGenerationPort | null = null;
let _voiceAdapter: IVoicePort | null = null;
let _musicAdapter: IMusicPort | null = null;
let _threeDAdapter: IThreeDGenerationPort | null = null;
let _cacheAdapter: IContextCachePort | null = null;
let _responseAdapter: IModelResponsePort | null = null;

/**
 * 平台路由器
 *
 * 依赖反转（v2.0）：
 * - 通过 IApiConfigStore 获取配置
 * - 通过 IPlatformCapabilitiesPort 查询能力
 * - 订阅 onPlatformChange 事件，自动 reset 缓存
 */
export class PlatformRouter {
  private configStore: IApiConfigStore;
  private capabilities: IPlatformCapabilitiesPort;
  constructor(
    configStore: IApiConfigStore = apiConfigStoreAdapter,
    capabilities: IPlatformCapabilitiesPort = platformCapabilitiesAdapter
  ) {
    this.configStore = configStore;
    this.capabilities = capabilities;
    this.configStore.onPlatformChange(() => {
      this.reset();
    });
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

  resolveVideo(config: ApiConfig): IVideoGeneratorPort {
    this.ensureCap(config.activePlatform, 'video');
    if (_videoAdapter && this.isMatchingPlatform(_videoAdapter, config.activePlatform)) {
      return _videoAdapter;
    }
    switch (config.activePlatform) {
      case 'volcengine':
        _videoAdapter = new VolcengineVideoAdapter(config);
        break;
      case 'kling':
        _videoAdapter = new KlingVideoAdapter(config);
        break;
      case 'wan':
        _videoAdapter = new WanVideoAdapter(config);
        break;
      case 'hunyuan':
        _videoAdapter = new HunyuanVideoAdapter(config);
        break;
      case 'zhipu':
        _videoAdapter = new ZhipuVideoAdapter(config);
        break;
      case 'vidu':
        _videoAdapter = new ViduVideoAdapter(config);
        break;
      case 'minimax':
      default:
        _videoAdapter = new MiniMaxVideoAdapter();
        break;
    }
    return _videoAdapter;
  }

  resolveImage(config: ApiConfig): IImageGeneratorPort {
    this.ensureCap(config.activePlatform, 'image');
    if (_imageAdapter && this.isMatchingPlatform(_imageAdapter, config.activePlatform)) {
      return _imageAdapter;
    }
    switch (config.activePlatform) {
      case 'volcengine':
        _imageAdapter = new VolcengineImageAdapter(config);
        break;
      case 'kling':
        _imageAdapter = new KlingImageAdapter(config);
        break;
      case 'wan':
        _imageAdapter = new WanImageAdapter(config);
        break;
      case 'hunyuan':
        _imageAdapter = new HunyuanImageAdapter(config);
        break;
      case 'zhipu':
        _imageAdapter = new ZhipuImageAdapter(config);
        break;
      case 'vidu':
        _imageAdapter = new ViduImageAdapter(config);
        break;
      case 'minimax':
      default:
        _imageAdapter = new MiniMaxImageAdapter();
        break;
    }
    return _imageAdapter;
  }

  resolveText(config: ApiConfig): ITextGenerationPort {
    this.ensureCap(config.activePlatform, 'text');
    if (_textAdapter && this.isMatchingPlatform(_textAdapter, config.activePlatform)) {
      return _textAdapter;
    }
    switch (config.activePlatform) {
      case 'volcengine':
        _textAdapter = new VolcengineTextAdapter(config);
        break;
      case 'wan':
        _textAdapter = new WanTextAdapter(config);
        break;
      case 'hunyuan':
        _textAdapter = new HunyuanTextAdapter(config);
        break;
      case 'zhipu':
        _textAdapter = new ZhipuTextAdapter(config);
        break;
      case 'minimax':
      default:
        _textAdapter = new MiniMaxTextAdapter();
        break;
    }
    return _textAdapter;
  }

  resolveVoice(config: ApiConfig): IVoicePort {
    this.ensureCap(config.activePlatform, 'voice');
    if (_voiceAdapter && this.isMatchingPlatform(_voiceAdapter, config.activePlatform)) {
      return _voiceAdapter;
    }
    switch (config.activePlatform) {
      case 'volcengine':
        _voiceAdapter = new VolcengineVoiceAdapter(config);
        break;
      case 'wan':
        _voiceAdapter = new WanVoiceAdapter(config);
        break;
      case 'hunyuan':
        _voiceAdapter = new HunyuanVoiceAdapter(config);
        break;
      case 'zhipu':
        _voiceAdapter = new ZhipuVoiceAdapter(config);
        break;
      case 'minimax':
      default:
        _voiceAdapter = new MiniMaxVoiceAdapter();
        break;
    }
    return _voiceAdapter;
  }

  resolveMusic(config: ApiConfig): IMusicPort {
    this.ensureCap(config.activePlatform, 'music');
    if (_musicAdapter && this.isMatchingPlatform(_musicAdapter, config.activePlatform)) {
      return _musicAdapter;
    }
    _musicAdapter = new MiniMaxMusicAdapter();
    return _musicAdapter;
  }

  resolve3D(config: ApiConfig): IThreeDGenerationPort {
    if (_threeDAdapter) return _threeDAdapter;
    _threeDAdapter = new Volcengine3DAdapter(config, 'volcengine-seed3d');
    return _threeDAdapter;
  }

  resolveCache(config: ApiConfig): IContextCachePort {
    if (_cacheAdapter) return _cacheAdapter;
    _cacheAdapter = new VolcengineCacheAdapter(config);
    return _cacheAdapter;
  }

  resolveResponse(config: ApiConfig): IModelResponsePort {
    if (_responseAdapter) return _responseAdapter;
    _responseAdapter = new VolcengineResponseAdapter(config);
    return _responseAdapter;
  }

  private isMatchingPlatform(adapter: { constructor: { name: string } }, platform: PlatformId): boolean {
    const adapterName = adapter.constructor.name;
    const platformPrefix: Record<PlatformId, string> = {
      minimax: 'MiniMax',
      volcengine: 'Volcengine',
      kling: 'Kling',
      wan: 'Wan',
      hunyuan: 'Hunyuan',
      zhipu: 'Zhipu',
      vidu: 'Vidu',
    };
    return adapterName.startsWith(platformPrefix[platform]);
  }

  hasCapability(capability: PlatformCapability): boolean {
    return this.capabilities.hasCapability(this.getActivePlatform(), capability);
  }

  getActivePlatform(): PlatformId {
    return this.configStore.getActivePlatform();
  }

  reset(): void {
    _videoAdapter = null;
    _imageAdapter = null;
    _textAdapter = null;
    _voiceAdapter = null;
    _musicAdapter = null;
    _threeDAdapter = null;
    _cacheAdapter = null;
    _responseAdapter = null;
  }
}

export const platformRouter = new PlatformRouter();