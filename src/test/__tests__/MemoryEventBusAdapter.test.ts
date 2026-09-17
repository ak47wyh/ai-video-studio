/**
 * MemoryEventBusAdapter 单元测试
 *
 * 验证：
 * - emit/on 双向通信
 * - 类型安全的 payload
 * - onAny 接收所有事件
 * - unsubscribe 正确解除订阅
 * - handler 抛错不影响其他 handler
 */

import { describe, it, expect, vi } from 'vitest';
import { MemoryEventBusAdapter } from '../../adapters/outbound/infrastructure/MemoryEventBusAdapter';

describe('MemoryEventBusAdapter', () => {
  it('emits and receives typed events', () => {
    const bus = new MemoryEventBusAdapter();
    const handler = vi.fn();
    bus.on('platform.changed', handler);

    bus.emit('platform.changed', { type: 'platform.changed' as const, from: 'minimax', to: 'kling' });
    expect(handler).toHaveBeenCalledWith({ type: 'platform.changed' as const, from: 'minimax', to: 'kling' });
  });

  it('routes events to the correct handler by type', () => {
    const bus = new MemoryEventBusAdapter();
    const changeHandler = vi.fn();
    const deleteHandler = vi.fn();

    bus.on('platform.changed', changeHandler);
    bus.on('space.deleted', deleteHandler);

    bus.emit('platform.changed', { type: 'platform.changed' as const, from: 'a', to: 'b' });
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(deleteHandler).not.toHaveBeenCalled();

    bus.emit('space.deleted', { type: 'space.deleted' as const, spaceId: 's1' });
    expect(deleteHandler).toHaveBeenCalledWith({ type: 'space.deleted' as const, spaceId: 's1' });
  });

  it('returns an unsubscribe function that stops the listener', () => {
    const bus = new MemoryEventBusAdapter();
    const handler = vi.fn();
    const unsub = bus.on('video.task.completed', handler);

    bus.emit('video.task.completed', { type: 'video.task.completed' as const, taskId: 't1', videoUrl: 'v1' });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit('video.task.completed', { type: 'video.task.completed' as const, taskId: 't2', videoUrl: 'v2' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onAny receives all event types', () => {
    const bus = new MemoryEventBusAdapter();
    const handler = vi.fn();
    bus.onAny(handler);

    bus.emit('platform.changed', { type: 'platform.changed' as const, from: 'a', to: 'b' });
    bus.emit('video.task.failed', { type: 'video.task.failed' as const, taskId: 't', error: 'e' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('isolates handler errors from other handlers (via ILoggerPort)', () => {
    const bus = new MemoryEventBusAdapter();
    const errorSpy = vi.fn();
    bus.setLogger({
      error: errorSpy,
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as Parameters<MemoryEventBusAdapter['setLogger']>[0]);
    const goodHandler = vi.fn();

    bus.on('platform.changed', () => { throw new Error('boom'); });
    bus.on('platform.changed', goodHandler);

    bus.emit('platform.changed', { type: 'platform.changed' as const, from: 'a', to: 'b' });
    expect(errorSpy).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('handles multiple subscribers on the same event', () => {
    const bus = new MemoryEventBusAdapter();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('voice.cloned', h1);
    bus.on('voice.cloned', h2);

    bus.emit('voice.cloned', { type: 'voice.cloned' as const, voiceId: 'v1' });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});