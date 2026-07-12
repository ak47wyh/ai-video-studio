/**
 * usePlatformCapabilities — 平台能力前置检测 Hook
 *
 * 设计目标（对应"主平台不降级、切换平台后台自动切换、不支持则页面提示"策略）：
 *   1. 响应式读取当前激活平台，平台切换时自动重渲染
 *   2. 提供 `hasCapability` 检测函数，UI 在调用 Service 前判断
 *   3. 提供 `ensureCapability`：不具备则抛 `UnsupportedCapabilityError`，便于在事件处理中精确捕获
 *   4. 暴露当前平台元信息与能力摘要，供页面头部展示
 *
 * 用法示例：
 *   ```ts
 *   const { activePlatform, hasCapability, ensureCapability } = usePlatformCapabilities();
 *   if (!hasCapability('video')) return <UnsupportedNotice capability="video" />;
 *   const handleClick = () => {
 *     try { ensureCapability('video'); videoGenerationService.generateVideo(...); }
 *     catch (e) {
 *       if (e instanceof UnsupportedCapabilityError) showToast('warning', e.message);
 *       else throw e;
 *     }
 *   };
 *   ```
 *
 * 注意：本 Hook 仅做"前置检测"，不修改 PlatformRouter 的运行时路由行为。
 * 路由仍由 `configStore.load().activePlatform` 决定，确保 UI 检测与实际路由同源。
 */

import { useCallback, useMemo } from 'react';
import {
  PLATFORM_METADATA,
  hasCapability as hasCapabilityBase,
  getCapabilitySummary,
  type Capability,
  type PlatformMeta,
} from '../../domain/services/platformCapabilities';
import type { PlatformId } from '../../domain/entities/platform';
import { UnsupportedCapabilityError } from '../../domain/errors/UnsupportedCapabilityError';
import { usePlatform } from '../contexts/PlatformContext';

export interface UsePlatformCapabilitiesResult {
  /** 当前激活平台 ID */
  activePlatform: PlatformId;
  /** 当前平台元信息 */
  platformMeta: PlatformMeta;
  /** 当前平台支持的能力列表 */
  capabilities: Capability[];
  /** 能力摘要文本（中文，如 "视频 / 图片 / 文本"） */
  capabilitySummary: string;
  /** 检测当前激活平台是否具备指定能力 */
  hasCapability: (capability: Capability) => boolean;
  /** 检测指定平台是否具备指定能力（便于提示用户切换） */
  hasCapabilityOn: (platform: PlatformId, capability: Capability) => boolean;
  /** 列出支持某能力的所有平台（用于"请切换到 xxx"提示） */
  listPlatformsSupporting: (capability: Capability) => PlatformMeta[];
  /** 检测能力，不具备则抛 `UnsupportedCapabilityError`（携带推荐切换平台） */
  ensureCapability: (capability: Capability) => void;
}

export function usePlatformCapabilities(): UsePlatformCapabilitiesResult {
  // P4-1：统一走 PlatformContext，消除原本 Hook 内独立 useState + onPlatformChange 订阅
  const { activePlatform, platformMeta } = usePlatform();

  const capabilities = platformMeta.capabilities;
  const capabilitySummary = useMemo(() => getCapabilitySummary(activePlatform), [activePlatform]);

  const hasCapability = useCallback(
    (capability: Capability) => hasCapabilityBase(activePlatform, capability),
    [activePlatform]
  );

  const hasCapabilityOn = useCallback(
    (platform: PlatformId, capability: Capability) => hasCapabilityBase(platform, capability),
    []
  );

  const listPlatformsSupporting = useCallback(
    (capability: Capability) =>
      Object.values(PLATFORM_METADATA).filter(p => p.capabilities.includes(capability)),
    []
  );

  const ensureCapability = useCallback(
    (capability: Capability) => {
      if (!hasCapabilityBase(activePlatform, capability)) {
        throw new UnsupportedCapabilityError(activePlatform, capability);
      }
    },
    [activePlatform]
  );

  return {
    activePlatform,
    platformMeta,
    capabilities,
    capabilitySummary,
    hasCapability,
    hasCapabilityOn,
    listPlatformsSupporting,
    ensureCapability,
  };
}
