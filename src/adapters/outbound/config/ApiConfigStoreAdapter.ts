/**
 * ApiConfigStoreAdapter —— IApiConfigStore 的实现
 *
 * 封装原 ApiConfigStore 单例对象的全部行为，并新增：
 * - onPlatformChange 订阅
 * - onConfigChange 订阅
 * - getApiKeyMasked 脱敏
 * - setActivePlatform 触发事件
 *
 * 原 ApiConfigStore 单例仍然存在（保留向后兼容路径），
 * 本适配器以独立 class 形式提供，可在测试中被 fake 替换。
 */

import type { IApiConfigStore, PlatformChangeListener, ConfigChangeListener } from '../../../domain/ports/PlatformPorts';
import type { ApiConfig, PlatformId } from './ApiConfigStore';
import type { VolcArkProtocol } from '../../../domain/entities/platform';
import { ApiConfigStore as LegacyStore } from './ApiConfigStore';

export class ApiConfigStoreAdapter implements IApiConfigStore {
  private platformListeners = new Set<PlatformChangeListener>();
  private configListeners = new Set<ConfigChangeListener>();
  private lastActivePlatform: PlatformId;

  constructor() {
    this.lastActivePlatform = this.load().activePlatform;
  }

  load(): ApiConfig {
    return LegacyStore.load();
  }

  async save(config: ApiConfig): Promise<void> {
    const prev = this.lastActivePlatform;
    LegacyStore.save(config);
    this.lastActivePlatform = config.activePlatform;
    // 通知平台切换监听者
    if (prev !== config.activePlatform) {
      this.platformListeners.forEach(l => {
        try { l(config.activePlatform, prev); } catch { /* ignore */ }
      });
    }
    // 通知配置变更
    this.configListeners.forEach(l => {
      try { l(config); } catch { /* ignore */ }
    });
  }

  getActivePlatform(): PlatformId {
    return this.load().activePlatform;
  }

  async setActivePlatform(platform: PlatformId): Promise<void> {
    const config = this.load();
    if (config.activePlatform === platform) return;
    await this.save({ ...config, activePlatform: platform });
  }

  /**
   * 获取脱敏的 API Key（用于 UI 显示）。
   * 规则：前 4 + 中间 6 个星号 + 尾 4。
   * 长度 < 12 的值全部返回 12 个星号。
   *
   * 火山引擎双协议并存：同时展示 OpenAI 与 Anthropic 两套 Key 的脱敏值。
   */
  getApiKeyMasked(platform: PlatformId): string {
    const config = this.load();
    if (platform === 'volcengine') {
      // 双协议并存：同时返回两个脱敏 Key
      const openAiMasked = this.maskKey(config.volcArkOpenAiApiKey);
      const anthropicMasked = this.maskKey(config.volcArkAnthropicApiKey);
      if (openAiMasked && anthropicMasked) {
        return `OpenAI: ${openAiMasked} | Anthropic: ${anthropicMasked}`;
      }
      return openAiMasked || anthropicMasked;
    }
    const raw = this.extractRawKey(config, platform);
    return this.maskKey(raw);
  }

  /** 单个 Key 脱敏（内部复用） */
  private maskKey(raw: string): string {
    if (!raw || raw.trim().length === 0) return '';
    if (raw.length < 12) return '*'.repeat(12);
    return `${raw.slice(0, 4)}******${raw.slice(-4)}`;
  }

  getToken(platform: PlatformId): string | undefined {
    const config = this.load();
    return this.extractRawKey(config, platform);
  }

  /**
   * 按协议获取火山引擎 API Key（供 HttpClient 按协议取用）。
   * - openai: 返回 volcArkOpenAiApiKey
   * - anthropic: 返回 volcArkAnthropicApiKey
   */
  getVolcArkKey(protocol: VolcArkProtocol): string {
    const config = this.load();
    return protocol === 'anthropic'
      ? config.volcArkAnthropicApiKey
      : config.volcArkOpenAiApiKey;
  }

  isPlatformConfigured(platform: PlatformId): boolean {
    return LegacyStore.isPlatformConfigured(platform);
  }

  /** Phase 2: 暴露火山语音技术配置状态（AppID/Token/Cluster 三件套） */
  isVolcVoiceConfigured(): boolean {
    return LegacyStore.isVolcVoiceConfigured();
  }

  /** Phase 2: 防抖自动保存；与 save 等价，仅为语义区分（同步触发，避免 UI 调用方丢失） */
  autoSave(config: ApiConfig): void {
    void this.save(config);
  }

  onPlatformChange(listener: PlatformChangeListener): () => void {
    this.platformListeners.add(listener);
    return () => this.platformListeners.delete(listener);
  }

  onConfigChange(listener: ConfigChangeListener): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  private extractRawKey(config: ApiConfig, platform: PlatformId): string {
    switch (platform) {
      case 'minimax': return config.minimaxApiKey;
      case 'volcengine':
        // 双协议并存：返回两个 Key 中非空的一个（用于脱敏显示的兜底）
        // 具体协议 Key 由 getVolcArkKey(protocol) 按协议取用
        return config.volcArkOpenAiApiKey || config.volcArkAnthropicApiKey;
      case 'kling': return `${config.klingAccessKey}|||${config.klingSecretKey}`;
      case 'wan': return config.wanApiKey;
      case 'hunyuan': return `${config.hunyuanSecretId}|||${config.hunyuanSecretKey}`;
      case 'zhipu': return config.zhipuApiKey;
      case 'vidu': return config.viduApiKey;
      default: return '';
    }
  }
}

/** 默认单例（与原 ApiConfigStore 平级） */
export const apiConfigStoreAdapter = new ApiConfigStoreAdapter();
