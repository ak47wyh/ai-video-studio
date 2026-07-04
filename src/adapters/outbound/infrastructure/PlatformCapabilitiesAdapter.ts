/**
 * PlatformCapabilitiesAdapter —— IPlatformCapabilitiesPort 的实现
 *
 * 封装 platformCapabilities.ts 中的 PLATFORM_METADATA / hasCapability / 等函数，
 * 使外部可通过接口查询，便于测试中 mock。
 */

import type { IPlatformCapabilitiesPort, PlatformMeta, PlatformCapability } from '../../../domain/ports/PlatformPorts';
import type { PlatformId } from '../config/ApiConfigStore';
import {
  PLATFORM_METADATA,
  hasCapability as hasCapabilityLegacy,
} from '../../../domain/services/platformCapabilities';

const CAPABILITY_LABELS: Record<PlatformCapability, string> = {
  video: '视频',
  videoFl2v: '首尾帧',
  videoS2v: '参考生',
  image: '图片',
  text: '文本',
  voice: '语音',
  music: '音乐',
  threeD: '3D',
  cache: '缓存',
  modelResponse: 'Responses',
};

export class PlatformCapabilitiesAdapter implements IPlatformCapabilitiesPort {
  getMeta(platform: PlatformId): PlatformMeta {
    return PLATFORM_METADATA[platform] as unknown as PlatformMeta;
  }

  hasCapability(platform: PlatformId, capability: PlatformCapability): boolean {
    // legacy 平台元数据只声明了 video/image/text/voice/music 及其子能力；
    // 3D/cache/bot/dialog/modelResponse 视为"非通用能力"，需查专门表。
    const basicCaps: PlatformCapability[] = [
      'video', 'videoFl2v', 'videoS2v',
      'image', 'text', 'voice', 'music',
    ];
    if (basicCaps.includes(capability)) {
      return hasCapabilityLegacy(platform, capability as 'video' | 'videoFl2v' | 'videoS2v' | 'image' | 'text' | 'voice' | 'music');
    }
    // 特殊能力：基于平台默认规则
    if (capability === 'threeD') return platform === 'volcengine';
    if (capability === 'cache') return platform === 'volcengine';
    if (capability === 'modelResponse') return platform === 'volcengine';
    return false;
  }

  listAll(): PlatformMeta[] {
    return Object.values(PLATFORM_METADATA) as unknown as PlatformMeta[];
  }

  getCapabilitySummary(platform: PlatformId): string {
    const caps = PLATFORM_METADATA[platform]?.capabilities ?? [];
    if (caps.length === 0) return '无生成能力';
    return caps
      .map(c => CAPABILITY_LABELS[c as PlatformCapability] ?? String(c))
      .join(' / ');
  }
}

export const platformCapabilitiesAdapter = new PlatformCapabilitiesAdapter();
