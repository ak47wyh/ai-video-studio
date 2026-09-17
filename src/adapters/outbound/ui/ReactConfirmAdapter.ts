/**
 * ReactConfirmAdapter —— IConfirmPort 的 React 实现
 *
 * 通过全局 Promise 桥接 ConfirmContext。
 * 业务 Service 调用 reactConfirmAdapter.ask({...}) 返回 Promise<boolean>。
 * ConfirmProvider 内部的 useConfirmBridge() 订阅此事件，弹出确认框，用户点击后 resolve。
 *
 * 与 ReactNotificationAdapter 的实现模式相同：模块级单例 + 事件桥。
 */

import type { IConfirmPort, ConfirmInput, ConfirmBridgeRequest, ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { BaseEventBus } from '../infrastructure/BaseEventBus';

/** 兼容旧引用：从 domain re-export ConfirmBridgeRequest */
export type { ConfirmBridgeRequest };

type ConfirmListener = (req: ConfirmBridgeRequest) => void;

/**
 * Confirm 事件总线（adapter 内部使用）。
 *
 * Phase 2 后：UI 层应通过 IConfirmPort.subscribe 订阅，
 * 不再直接 import 此单例。仅为 adapter 内部解耦与测试需要保留。
 */
class ConfirmEventBus extends BaseEventBus<ConfirmListener> {
  constructor(logger?: ILoggerPort) {
    super({ service: 'ReactConfirmAdapter' });
    this.setLogger(logger);
  }

  emit(req: ConfirmBridgeRequest): void {
    this.emitAll(req);
  }
}

export const confirmEventBus = new ConfirmEventBus();

class ReactConfirmAdapter implements IConfirmPort {
  ask(input: ConfirmInput): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      confirmEventBus.emit({
        id,
        title: input.title,
        message: input.message,
        confirmText: input.confirmText,
        cancelText: input.cancelText,
        destructive: input.destructive,
        resolve,
      });
    });
  }

  /** Phase 2 DIP：暴露订阅入口，UI 通过 Port 订阅，不再直接依赖 confirmEventBus */
  subscribe(listener: (req: ConfirmBridgeRequest) => void): () => void {
    return confirmEventBus.subscribe(listener);
  }
}

export const reactConfirmAdapter: IConfirmPort = new ReactConfirmAdapter();
