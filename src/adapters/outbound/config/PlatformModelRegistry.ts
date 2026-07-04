/**
 * PlatformModelRegistry —— 基于 PlatformMeta 的模型注册表实现
 *
 * M3.3 模型 ID 走 PlatformRouter（EVOLUTION_DESIGN.md §7.3）：
 *   根据当前 activePlatform 的 PlatformMeta.textModel 返回对应模型 ID，
 *   使切换平台后所有 Service 自动使用新平台的模型。
 *
 * 文本模型按用途分档：
 *   - chat: 用 PlatformMeta.textModel（最强档，如 MiniMax-M3 / glm-4-plus / qwen-plus）
 *   - recommendation / translation / splitter: 同上（无更细档位时复用）
 *   - alignment: 同上（轻量任务但无法区分档位时复用）
 *
 * 若平台未配置 textModel（如 kling / vidu），降级到 MiniMax 模型。
 */

import type { IModelRegistry, TextModelCategory, IApiConfigStore } from '../../../domain/ports/PlatformPorts';
import { PLATFORM_METADATA } from '../../../domain/services/platformCapabilities';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import type { VolcArkProtocol } from './ApiConfigStore';

export class PlatformModelRegistry implements IModelRegistry {
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;

  /** MiniMax 默认模型（当前平台不支持 text 能力时的降级） */
  private static readonly FALLBACK_CHAT = 'MiniMax-M3';
  private static readonly FALLBACK_FAST = 'MiniMax-M2.5-highspeed';
  private static readonly FALLBACK_STANDARD = 'MiniMax-M2.5';

  constructor(configStore: IApiConfigStore, logger: ILoggerPort) {
    this.configStore = configStore;
    this.logger = logger;
  }

  resolveTextModel(category: TextModelCategory): string {
    const platformId = this.configStore.getActivePlatform();
    const meta = PLATFORM_METADATA[platformId];

    // 火山方舟 Anthropic 协议（Agent Plan）：使用 volcArkAnthropicModel
    if (platformId === 'volcengine') {
      const config = this.configStore.load();
      const protocol: VolcArkProtocol = config.volcArkProtocol ?? 'openai';
      if (protocol === 'anthropic') {
        const anthropicModel = config.volcArkAnthropicModel || 'doubao-seed-2.0-pro';
        this.logger.info('resolveTextModel from volcengine anthropic (Agent Plan)', {
          service: 'PlatformModelRegistry',
          method: 'resolveTextModel',
          platformId,
          category,
          protocol,
          model: anthropicModel,
        });
        return anthropicModel;
      }
    }

    // 平台有 text 能力且有 textModel 配置
    if (meta?.textModel && meta.capabilities.includes('text')) {
      this.logger.debug('resolveTextModel from platform', {
        service: 'PlatformModelRegistry',
        method: 'resolveTextModel',
        platformId,
        category,
        model: meta.textModel,
      });
      return meta.textModel;
    }

    // 降级到 MiniMax 默认模型（按用途分档）
    const fallback = this.selectFallback(category);
    this.logger.info('resolveTextModel fallback to MiniMax (platform has no text capability)', {
      service: 'PlatformModelRegistry',
      method: 'resolveTextModel',
      platformId,
      category,
      fallbackModel: fallback,
    });
    return fallback;
  }

  resolveImageModel(): string {
    const platformId = this.configStore.getActivePlatform();
    const meta = PLATFORM_METADATA[platformId];
    if (meta?.imageModel && meta.capabilities.includes('image')) {
      return meta.imageModel;
    }
    return 'image-01'; // MiniMax 默认图片模型
  }

  resolveVideoModel(): string {
    const platformId = this.configStore.getActivePlatform();
    const meta = PLATFORM_METADATA[platformId];
    if (meta?.videoModels?.length && meta.capabilities.includes('video')) {
      return meta.videoModels[0]; // 默认取第一个
    }
    return 'T2V-01-Director'; // MiniMax 默认视频模型
  }

  /** 按用途选择 MiniMax 降级模型 */
  private selectFallback(category: TextModelCategory): string {
    switch (category) {
      case 'chat':
        return PlatformModelRegistry.FALLBACK_CHAT;
      case 'alignment':
        return PlatformModelRegistry.FALLBACK_FAST;
      case 'recommendation':
      case 'translation':
      case 'splitter':
        return PlatformModelRegistry.FALLBACK_STANDARD;
      default:
        return PlatformModelRegistry.FALLBACK_STANDARD;
    }
  }
}
