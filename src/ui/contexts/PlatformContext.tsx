import React, { createContext, useContext, useSyncExternalStore, useMemo, type ReactNode } from 'react';
import { apiConfigStoreAdapter } from '../../dependencies';
import { PLATFORM_METADATA, type PlatformMeta } from '../../domain/services/platformCapabilities';
import type { PlatformId } from '../../domain/entities/platform';

/**
 * PlatformContext —— 全站唯一权威的「当前激活平台」订阅源。
 *
 * 背景（P4-1）：重构前 5 个位置各自 `useState + subscribePlatform`：
 *   - MainLayout.tsx / VoiceLab.tsx / PlatformSwitcher.tsx / useVoiceCapabilities.ts / usePlatformCapabilities.ts
 * 导致状态紊乱（其中 PlatformSwitcher 与 VoiceLab 未订阅，切换平台后不刷新）。
 *
 * 方案：
 *   - 使用 useSyncExternalStore 直接消费 apiConfigStoreAdapter 的发布订阅
 *   - 所有消费者通过 usePlatform() 拿到 activePlatform，天然响应切换
 *   - 避免多份 useState 之间的时序不一致 / 竞态覆盖
 *
 * 与 usePlatformCapabilities 的分工：
 *   - usePlatform: 只提供 activePlatform + platformMeta（轻量核心状态）
 *   - usePlatformCapabilities: 在此基础上增加能力查询（hasCapability / ensureCapability）
 */

interface PlatformContextValue {
  activePlatform: PlatformId;
  platformMeta: PlatformMeta;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

/**
 * useSyncExternalStore 快照函数。
 * 直接读取 apiConfigStoreAdapter 内部激活平台。
 */
function subscribePlatform(listener: () => void): () => void {
  return apiConfigStoreAdapter.onPlatformChange(() => listener());
}

function getPlatformSnapshot(): PlatformId {
  return apiConfigStoreAdapter.getActivePlatform();
}

export const PlatformProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const activePlatform = useSyncExternalStore(
    subscribePlatform,
    getPlatformSnapshot,
    getPlatformSnapshot, // SSR 快照（未使用 SSR 也需要提供）
  );
  const platformMeta = useMemo(
    () => PLATFORM_METADATA[activePlatform],
    [activePlatform],
  );

  // Provider value 稳定化，避免每次渲染派新对象
  const value = useMemo<PlatformContextValue>(
    () => ({ activePlatform, platformMeta }),
    [activePlatform, platformMeta],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
};

/**
 * 消费当前激活平台。
 *
 * 未在 PlatformProvider 内使用时会降级到直接读取快照（兼容单元测试），
 * 但仍强烈建议将 <PlatformProvider> 挂到 App 顶层。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (ctx) return ctx;
  // 兼容降级：Provider 未挂载时直接从 store 快照读取（不订阅，不响应）。
  const activePlatform = getPlatformSnapshot();
  return { activePlatform, platformMeta: PLATFORM_METADATA[activePlatform] };
}
