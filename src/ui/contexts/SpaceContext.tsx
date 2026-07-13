import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { storySpaceService, spaceQueryPort, createLogger } from '../../dependencies';
import type { StorySpace } from '../../domain/entities/models';

// 独立 logger 实例，避免循环依赖
const logger = createLogger('SpaceContext');

interface SpaceContextType {
  currentSpaceId: string | null;
  setCurrentSpaceId: (id: string | null) => void;
}

const SpaceContext = createContext<SpaceContextType>({
  currentSpaceId: null,
  setCurrentSpaceId: () => {},
});

function useSpaceContext() {
  return useContext(SpaceContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export { useSpaceContext as useSpace };

// localStorage 持久化当前选中空间 ID，刷新后恢复，避免素材库查询 spaceId 错位
const CURRENT_SPACE_ID_KEY = 'ai_vido_current_space_id';

function readPersistedSpaceId(): string | null {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(CURRENT_SPACE_ID_KEY)
      : null;
  } catch {
    return null;
  }
}

function writePersistedSpaceId(id: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (id) {
      window.localStorage.setItem(CURRENT_SPACE_ID_KEY, id);
    } else {
      window.localStorage.removeItem(CURRENT_SPACE_ID_KEY);
    }
    logger.info('[SpaceContext] persist spaceId', { action: id ? 'save' : 'clear', spaceId: id ?? undefined });
  } catch (e) {
    logger.warn('[SpaceContext] persist spaceId failed', { error: String(e) });
  }
}

export const SpaceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Phase 2 DIP：通过 spaceQueryPort.listSpaces 订阅 Dexie 变更，替代 useLiveQuery + db 直查
  const [spaces, setSpaces] = useState<StorySpace[] | undefined>(undefined);
  // 初始化时从 localStorage 读取上次选择的空间
  const [explicitSpaceId, setExplicitSpaceId] = useState<string | null>(readPersistedSpaceId);

  // 订阅空间列表变更（首次加载 + 后续 CRUD 自动刷新）
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      spaceQueryPort.listSpaces()
        .then((list) => {
          if (!cancelled) setSpaces(list);
        })
        .catch((e) => {
          logger.warn('[SpaceContext] listSpaces failed', { error: String(e) });
        });
    };
    run();
    const unsubscribe = spaceQueryPort.subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // 包装 setter：同步写入 localStorage（必须在 useEffect 之前定义，避免 TDZ）
  const setCurrentSpaceId = useCallback((id: string | null) => {
    setExplicitSpaceId(id);
    writePersistedSpaceId(id);
  }, []);

  // Create default space if none exist (side effect in useEffect, not in render)
  useEffect(() => {
    if (spaces !== undefined && spaces.length === 0) {
      storySpaceService.createSpace('Default Space', 'Default workspace').then(space => {
        // 自动创建默认空间时也走持久化 setter
        setCurrentSpaceId(space.id);
      }).catch(console.error);
    }
  }, [spaces, setCurrentSpaceId]);

  // Derive currentSpaceId: explicit selection > first space > null (loading)
  // 修复 B-21：渲染期不再写 localStorage；副作用移到下方 useEffect。
  const currentSpaceId = useMemo<string | null>(() => {
    if (spaces === undefined) return null; // still loading
    if (explicitSpaceId !== null && spaces.find(s => s.id === explicitSpaceId)) {
      return explicitSpaceId;
    }
    // 显式选择无效（被删除等）→ 回退到第一个空间
    return spaces.length > 0 ? spaces[0].id : null;
  }, [spaces, explicitSpaceId]);

  // 显式选择失效后回填持久化：作为副作用而非渲染期写入
  useEffect(() => {
    if (currentSpaceId && currentSpaceId !== explicitSpaceId) {
      writePersistedSpaceId(currentSpaceId);
    }
  }, [currentSpaceId, explicitSpaceId]);

  // Provider value 稳定化，避免每次派生 currentSpaceId 时触发全体消费者重渲染
  const contextValue = useMemo(
    () => ({ currentSpaceId, setCurrentSpaceId }),
    [currentSpaceId, setCurrentSpaceId],
  );

  return (
    <SpaceContext.Provider value={contextValue}>
      {children}
    </SpaceContext.Provider>
  );
};
