/**
 * ReactThemeAdapter —— IThemePort 的 React 实现
 *
 * 通过全局主题事件桥，让 Service 层（非 React 上下文）也能感知/切换主题。
 *
 * 工作原理：
 * 1. Service 调用 reactThemeAdapter.setMode('warm')
 * 2. 适配器通过 themeEventBus.emit(...) 广播事件
 * 3. ThemeProvider 内部的 useThemeBridge() 订阅此事件并同步到 ApiConfigStore
 *
 * 同时支持主动 getCurrentMode() 查询（无需 UI）。
 */

import type { IThemePort, ThemeMode } from '../../../domain/ports/UiPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { BaseEventBus } from '../infrastructure/BaseEventBus';
import { ConsoleLoggerAdapter } from '../infrastructure/ConsoleLoggerAdapter';
import { apiConfigStoreAdapter } from '../config/ApiConfigStoreAdapter';

export type ThemeChangeEvent = {
  mode: ThemeMode;
};

type ThemeListener = (event: ThemeChangeEvent) => void;

class ThemeEventBus extends BaseEventBus<ThemeListener> {
  constructor(logger?: ILoggerPort) {
    super({ service: 'ReactThemeAdapter' });
    this.setLogger(logger);
  }

  emit(event: ThemeChangeEvent): void {
    this.emitAll(event);
  }
}

export function createThemeEventBus(logger?: ILoggerPort): ThemeEventBus {
  return new ThemeEventBus(logger ?? new ConsoleLoggerAdapter({ service: 'ReactThemeAdapter' }));
}

// 默认实例（向后兼容）；dependencies.ts 可调用 createThemeEventBus(defaultLogger) 覆盖
export const themeEventBus: ThemeEventBus = createThemeEventBus();

class ReactThemeAdapter implements IThemePort {
  private eventBus: ThemeEventBus;

  constructor(eventBus: ThemeEventBus = themeEventBus) {
    this.eventBus = eventBus;
  }

  getCurrentMode(): ThemeMode {
    const config = apiConfigStoreAdapter.load();
    return (config.theme as ThemeMode) || 'dark';
  }

  setMode(mode: ThemeMode): void {
    const config = apiConfigStoreAdapter.load();
    void apiConfigStoreAdapter.save({ ...config, theme: mode });
    this.eventBus.emit({ mode });
  }

  onChange(listener: (mode: ThemeMode) => void): () => void {
    return this.eventBus.subscribe(event => listener(event.mode));
  }
}

export function createReactThemeAdapter(logger?: ILoggerPort): IThemePort {
  return new ReactThemeAdapter(createThemeEventBus(logger));
}

export const reactThemeAdapter: IThemePort = new ReactThemeAdapter();