/**
 * UnsupportedCapabilityNotice — 平台能力不支持提示组件
 *
 * 对应设计策略："如果平台不支持此功能,页面提示平台不支持"。
 * 当用户进入某 Lab 页面但当前激活平台不具备该能力时,渲染此组件替代页面主体,
 * 并提供"一键切换到支持平台"的 CTA。
 *
 * 用法：
 *   ```tsx
 *   const { hasCapability, listPlatformsSupporting, activePlatform } = usePlatformCapabilities();
 *   if (!hasCapability('music')) {
 *     return <UnsupportedCapabilityNotice capability="music" />;
 *   }
 *   ```
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { usePlatformCapabilities } from '../hooks/usePlatformCapabilities';
import { apiConfigStoreAdapter } from '../../dependencies';
import type { Capability } from '../../domain/services/platformCapabilities';
import { UnsupportedCapabilityError } from '../../domain/errors/UnsupportedCapabilityError';

export interface UnsupportedCapabilityNoticeProps {
  /** 不支持的能力 */
  capability: Capability;
  /** 自定义最小高度（默认 320） */
  minHeight?: number;
}

const CAPABILITY_LABELS: Record<Capability, { zh: string; en: string }> = {
  video: { zh: '视频生成', en: 'Video Generation' },
  videoFl2v: { zh: '首尾帧生视频', en: 'First-Last Frame to Video' },
  videoS2v: { zh: '主体参考生视频', en: 'Subject Reference to Video' },
  image: { zh: '图片生成', en: 'Image Generation' },
  text: { zh: '文本生成', en: 'Text Generation' },
  voice: { zh: '语音合成', en: 'Voice Synthesis' },
  music: { zh: '音乐生成', en: 'Music Generation' },
};

export const UnsupportedCapabilityNotice: React.FC<UnsupportedCapabilityNoticeProps> = ({
  capability,
  minHeight = 320,
}) => {
  const { t } = useTranslation();
  const { activePlatform, platformMeta, listPlatformsSupporting } = usePlatformCapabilities();

  const error = useMemo(
    () => new UnsupportedCapabilityError(activePlatform, capability),
    [activePlatform, capability]
  );

  const alternatives = useMemo(
    () => listPlatformsSupporting(capability),
    [listPlatformsSupporting, capability]
  );

  const handleSwitch = (platformId: typeof activePlatform) => {
    void apiConfigStoreAdapter.setActivePlatform(platformId);
  };

  const capLabel = CAPABILITY_LABELS[capability]?.zh ?? capability;

  return (
    <div
      className="glass-panel unsupported-notice"
      style={{ minHeight, padding: 32, textAlign: 'center' }}
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle
        size={48}
        style={{ color: 'var(--warning)', marginBottom: 16 }}
        aria-hidden
      />
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>
        {t('unsupported.title', '{{capability}} 当前平台不可用', { capability: capLabel })}
      </h3>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {error.message}
      </p>

      {alternatives.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            {t('unsupported.switchHint', '点击下方按钮快速切换平台：')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {alternatives.map(alt => (
              <button
                key={alt.id}
                className="btn btn-secondary"
                onClick={() => handleSwitch(alt.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span aria-hidden>{alt.icon}</span>
                <span>{alt.name}</span>
                <ArrowRight size={14} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
        {t('unsupported.currentPlatform', '当前平台：{{name}}', { name: platformMeta.name })}
      </p>
    </div>
  );
};
