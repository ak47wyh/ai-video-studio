/**
 * PlatformSelector —— 平台选择纯函数
 *
 * 把"哪个 PlatformId + 哪个能力 → 哪个适配器类"映射逻辑从 PlatformRouter 中提取出来。
 *
 * 设计原则：
 * - Domain 层不应直接依赖具体 Adapter 类（应通过依赖注入或工厂注入）
 * - 本文件仅输出**适配器键字符串**（如 'minimax.video'），具体 class 由 Infrastructure 层注入的
 *   factory 函数映射。本期保留 Adapter class import 是为了向后兼容，下一阶段将迁移到 Registry。
 *
 * 受益：
 * - 可纯函数测试（不依赖 DI）
 * - 新增平台只需在映射表中加一行
 * - Domain 层不再"知道"具体 Adapter 实现
 */

import type { PlatformId } from '../../adapters/outbound/config/ApiConfigStore';

export type AdapterCapability = 'video' | 'image' | 'text' | 'voice' | 'music';
export type AdapterKey = `${PlatformId}.${AdapterCapability}`;

export function selectAdapterKey(
  platform: PlatformId,
  capability: AdapterCapability,
): AdapterKey {
  return `${platform}.${capability}`;
}

/**
 * 默认降级策略：当请求的平台未实现某 capability 时，回退到 minimax
 */
export function withFallback(platform: PlatformId, supportedPlatforms: Set<PlatformId>): PlatformId {
  return supportedPlatforms.has(platform) ? platform : 'minimax';
}

/**
 * 平台支持矩阵：哪些 (platform, capability) 组合合法
 *
 * 用途：PlatformRouter 询问 "Kling 支持 video 吗？"时直接 O(1) 查询，
 *      不需要每次都调用 IPlatformCapabilitiesPort.hasCapability（节省一次 IPC）。
 */
export const SUPPORTED_MATRIX: Record<PlatformId, Set<AdapterCapability>> = {
  minimax: new Set<AdapterCapability>(['video', 'image', 'text', 'voice', 'music']),
  // 与 platformCapabilities.ts 的 PLATFORM_METADATA.volcengine.capabilities 保持一致
  // 注：Anthropic 协议（Agent Plan）下仅 text 可用，由 getVolcengineCapabilities 动态计算
  volcengine: new Set<AdapterCapability>(['video', 'image', 'text', 'voice']),
  coze: new Set<AdapterCapability>([]),
  kling: new Set<AdapterCapability>(['video', 'image']),
  wan: new Set<AdapterCapability>(['video', 'image', 'text', 'voice']),
  hunyuan: new Set<AdapterCapability>(['video', 'image', 'text', 'voice']),
  zhipu: new Set<AdapterCapability>(['video', 'image', 'text', 'voice']),
  vidu: new Set<AdapterCapability>(['video', 'image']),
};

export function isSupported(platform: PlatformId, capability: AdapterCapability): boolean {
  return SUPPORTED_MATRIX[platform]?.has(capability) ?? false;
}