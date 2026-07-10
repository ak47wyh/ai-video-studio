import { useState, useEffect } from 'react';
import type { VoiceCapabilities } from '../../domain/ports/OutboundPorts';
import { voiceService } from '../../dependencies';
import { ApiConfigStore } from '../../adapters/outbound/config/ApiConfigStore';

/** 默认降级值（全 false），保证 UI 在适配器初始化失败时不中断 */
const FALLBACK_CAPABILITIES: VoiceCapabilities = {
  supportsClone: false,
  supportsDesign: false,
  supportsDelete: false,
  supportsStream: false,
  supportsConversion: false,
};

interface UseVoiceCapabilitiesResult {
  /** 当前激活平台的语音子能力声明 */
  capabilities: VoiceCapabilities;
  /** 是否正在加载 */
  loading: boolean;
  /** 火山引擎语音技术（AppID/Token/Cluster）是否已配置完整 */
  volcVoiceConfigured: boolean;
}

/**
 * 查询当前激活平台的语音子能力。
 *
 * 设计意图：
 *  - VoiceLab 据此动态置灰不支持的 Tab（克隆/设计/流式），避免用户点击后才发现不支持
 *  - 订阅平台变更事件，切换平台后自动刷新
 *  - 火山引擎需额外配置语音技术三件套，未配置时克隆 Tab 也应置灰
 *
 * 使用示例：
 * ```ts
 * const { capabilities, loading, volcVoiceConfigured } = useVoiceCapabilities();
 * const cloneDisabled = !capabilities.supportsClone || (activePlatform === 'volcengine' && !volcVoiceConfigured);
 * ```
 */
export function useVoiceCapabilities(): UseVoiceCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<VoiceCapabilities>(FALLBACK_CAPABILITIES);
  const [volcVoiceConfigured, setVolcVoiceConfigured] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const caps = await voiceService.getVoiceCapabilities();
        if (!cancelled) {
          setCapabilities(caps);
          setVolcVoiceConfigured(ApiConfigStore.isVolcVoiceConfigured());
        }
      } catch {
        if (!cancelled) {
          setCapabilities(FALLBACK_CAPABILITIES);
          setVolcVoiceConfigured(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadCapabilities();

    // 订阅平台变更：切换平台后重新查询能力
    const unsubscribe = ApiConfigStore.subscribePlatform(() => {
      setLoading(true);
      void loadCapabilities();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { capabilities, loading, volcVoiceConfigured };
}
