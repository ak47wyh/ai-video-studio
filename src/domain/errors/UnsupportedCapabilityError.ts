import type { PlatformId } from '../entities/platform';
import type { Capability } from '../services/platformCapabilities';
import { PLATFORM_METADATA, hasCapability } from '../services/platformCapabilities';
import { DomainError, type DomainErrorCode } from './DomainError';

/**
 * 平台不支持指定能力时抛出的错误。
 *
 * 携带平台名、不支持的能力名，以及可操作的建议（推荐支持该能力的平台列表），
 * 供 UI 层展示明确的"该平台不支持此能力"提示。
 *
 * 继承 DomainError，`code === 'UNSUPPORTED_CAPABILITY'`，UI 应按 code 分派 i18n。
 */
export class UnsupportedCapabilityError extends DomainError {
  readonly code: DomainErrorCode = 'UNSUPPORTED_CAPABILITY';
  readonly platform: PlatformId;
  readonly capability: Capability;

  constructor(
    platform: PlatformId,
    capability: Capability,
  ) {
    const platformName = PLATFORM_METADATA[platform]?.name ?? platform;
    const capabilityLabels: Record<Capability, string> = {
      video: '视频生成',
      videoFl2v: '首尾帧生视频',
      videoS2v: '主体参考生视频',
      image: '图片生成',
      text: '文本生成',
      voice: '语音合成',
      music: '音乐生成',
    };
    const capLabel = capabilityLabels[capability] ?? capability;
    // 推荐支持该能力的其他平台
    const allPlatforms = Object.keys(PLATFORM_METADATA) as PlatformId[];
    const recommendations = allPlatforms
      .filter(p => p !== platform && hasCapability(p, capability))
      .map(p => PLATFORM_METADATA[p]?.name ?? p)
      .slice(0, 4);
    const hint = recommendations.length
      ? `，请切换到：${recommendations.join(' / ')}`
      : '';
    super({
      message: `当前平台（${platformName}）不支持${capLabel}${hint}`,
      context: { platform, capability, recommendations },
    });
    this.platform = platform;
    this.capability = capability;
    this.name = 'UnsupportedCapabilityError';
  }
}
