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
   */
  getApiKeyMasked(platform: PlatformId): string {
    const config = this.load();
    const raw = this.extractRawKey(config, platform);
    if (!raw || raw.trim().length === 0) return '';
    if (raw.length < 12) return '*'.repeat(12);
    return `${raw.slice(0, 4)}******${raw.slice(-4)}`;
  }

  getToken(platform: PlatformId): string | undefined {
    const config = this.load();
    return this.extractRawKey(config, platform);
  }

  isPlatformConfigured(platform: PlatformId): boolean {
    return LegacyStore.isPlatformConfigured(platform);
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
      case 'volcengine': return config.volcArkApiKey;
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
