import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { apiConfigStoreAdapter } from '../../dependencies';
import { THEMES, type ThemeId, type ThemeConfig } from './theme-types';

interface ThemeContextValue {
  currentTheme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeConfig[];
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => {
    const config = apiConfigStoreAdapter.load();
    return (config.theme as ThemeId) || 'dark';
  });
  const [isLoading, setIsLoading] = useState(false);

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
  }, [currentTheme]);

  const setTheme = useCallback((theme: ThemeId) => {
    setIsLoading(true);
    try {
      const config = apiConfigStoreAdapter.load();
      // 走 Port 持久化（save 异步，但 theme 立即生效）
      void apiConfigStoreAdapter.save({ ...config, theme });
      setCurrentTheme(theme);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Provider value 稳定化：避免每次渲染派发新对象引发全体消费者重渲染
  const value = useMemo<ThemeContextValue>(
    () => ({ currentTheme, setTheme, themes: THEMES, isLoading }),
    [currentTheme, setTheme, isLoading],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// useTheme 不是组件，但 react-refresh 规则允许导出 hook：将其拆到单独文件会增加调用方负担，
// 这里使用 eslint-disable 局部豁免（仅此一行），保留单文件聚合 API。
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
