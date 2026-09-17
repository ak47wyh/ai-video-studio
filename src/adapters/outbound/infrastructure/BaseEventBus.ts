import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

/**
 * BaseEventBus —— 抽取各 Adapter 内联 EventBus 的公共 pub/sub 骨架（§8 废弃清单）。
 *
 * - 泛型 L 为监听器签名 `(event: X) => void`
 * - 统一错误隔离：单个 listener 抛错不影响其它 listener
 * - 错误经 ILoggerPort 输出（可注入），logger 未注入时静默
 */
export abstract class BaseEventBus<L extends (event: never) => void> {
  protected listeners = new Set<L>();
  private logger?: ILoggerPort;
  private readonly logContext?: { service?: string };

  constructor(logContext?: { service?: string }) {
    this.logContext = logContext;
  }

  setLogger(logger?: ILoggerPort): void {
    this.logger = logger;
  }

  subscribe(listener: L): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emitAll(event: Parameters<L>[0]): void {
    this.listeners.forEach(l => {
      try {
        l(event);
      } catch (err) {
        this.logger?.error('[EventBus] listener error', err, this.logContext);
      }
    });
  }
}
