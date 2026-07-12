import type { VoiceCapabilities } from '../ports/OutboundPorts';
import { DomainError, type DomainErrorCode } from './DomainError';

/**
 * 语音子能力（clone/design/delete/stream）不被当前平台支持时抛出。
 *
 * 与 `UnsupportedCapabilityError`（面向大能力：video/image/text/voice/music）配合使用：
 *   - UnsupportedCapabilityError：整个能力域不支持（如"该平台不支持视频生成"）
 *   - VoiceSubCapabilityNotSupportedError：能力域支持，但某个子方法不支持
 *     （如"该平台支持 TTS 但不支持声音克隆"）
 *
 * 继承 DomainError，`code === 'UNSUPPORTED_CAPABILITY'`，UI 可按 code 统一分派 i18n。
 *
 * 命名保留 `CapabilityNotSupportedError` 别名以兼容既有 Adapter 抛出点，
 * 详见 `ports/OutboundPorts.ts` 中的 re-export。
 */
export class VoiceSubCapabilityNotSupportedError extends DomainError {
  readonly code: DomainErrorCode = 'UNSUPPORTED_CAPABILITY';
  readonly platform: string;
  readonly capability: keyof VoiceCapabilities;

  constructor(platform: string, capability: keyof VoiceCapabilities) {
    super({
      message: `Voice capability "${capability}" is not supported by platform "${platform}"`,
      context: { platform, capability, kind: 'voice-subcapability' },
    });
    this.platform = platform;
    this.capability = capability;
    this.name = 'VoiceSubCapabilityNotSupportedError';
  }
}
