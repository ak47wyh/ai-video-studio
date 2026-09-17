/**
 * MemoryEventBusAdapter —— IEventBus 的内存实现
 *
 * 单进程内 pub/sub。
 * 后续可实现：BroadcastChannelEventBus（跨 Tab）/ WebSocketEventBus（远端）。
 */

import type { IEventBus, DomainEvent, EventListener, ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';

export class MemoryEventBusAdapter implements IEventBus {
  private logger?: ILoggerPort;

  setLogger(logger?: ILoggerPort): void {
    this.logger = logger;
  }
  private listeners = new Map<DomainEvent['type'], Set<(e: DomainEvent) => void>>();
  private anyListeners = new Set<(e: DomainEvent) => void>();

  emit<T extends DomainEvent['type']>(
    type: T,
    payload: Extract<DomainEvent, { type: T }>
  ): void {
    const event = payload as DomainEvent;
    this.listeners.get(type)?.forEach(h => {
      try { h(event); } catch (e) {
        this.logger?.error('[EventBus] handler error', e);
      }
    });
    this.anyListeners.forEach(h => {
      try { h(event); } catch (e) {
        this.logger?.error('[EventBus] any handler error', e);
      }
    });
  }

  on<T extends DomainEvent['type']>(
    type: T,
    handler: EventListener<T>
  ): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const wrapped = handler as (e: DomainEvent) => void;
    this.listeners.get(type)!.add(wrapped);
    return () => {
      this.listeners.get(type)?.delete(wrapped);
    };
  }

  onAny(handler: (event: DomainEvent) => void): () => void {
    this.anyListeners.add(handler);
    return () => {
      this.anyListeners.delete(handler);
    };
  }
}

export const defaultEventBus: IEventBus = new MemoryEventBusAdapter();
