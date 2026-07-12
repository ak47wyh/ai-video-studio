/**
 * BrowserNetworkStatusAdapter —— INetworkStatusPort 的浏览器实现
 *
 * 监听 navigator.onLine + online/offline 事件。
 * 扩展：检测 navigator.connection 的 effectiveType，提供 unstable 状态。
 */

import type { INetworkStatusPort, NetworkStatus } from '../../../domain/ports/UiPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { ConsoleLoggerAdapter } from './ConsoleLoggerAdapter';

type NetworkListener = (status: NetworkStatus) => void;

class NetworkEventBus {
  private logger: ILoggerPort;

  constructor(logger: ILoggerPort) {
    this.logger = logger;
  }

  private listeners = new Set<NetworkListener>();

  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(status: NetworkStatus): void {
    this.listeners.forEach(l => {
      try {
        l(status);
      } catch (err) {
        this.logger.error('[NetworkEventBus] listener error', err, {
          service: 'BrowserNetworkStatusAdapter',
          status,
        });
      }
    });
  }
}

export function createNetworkEventBus(logger?: ILoggerPort): NetworkEventBus {
  return new NetworkEventBus(logger ?? new ConsoleLoggerAdapter({ service: 'BrowserNetworkStatusAdapter' }));
}

export const networkEventBus: NetworkEventBus = createNetworkEventBus();

interface NetworkConnectionInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkConnectionInfo & {
    addEventListener?: (event: string, handler: () => void) => void;
    removeEventListener?: (event: string, handler: () => void) => void;
  };
}

class BrowserNetworkStatusAdapter implements INetworkStatusPort {
  private currentStatus: NetworkStatus = 'online';
  private logger: ILoggerPort;
  private cleanupHandlers: (() => void)[] = [];

  constructor(logger?: ILoggerPort) {
    this.logger = logger ?? new ConsoleLoggerAdapter({ service: 'BrowserNetworkStatusAdapter' });
    if (typeof window === 'undefined') return;

    this.currentStatus = navigator.onLine ? 'online' : 'offline';

    const onOnline = () => this.updateStatus('online');
    const onOffline = () => this.updateStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.cleanupHandlers.push(
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('offline', onOffline),
    );

    const conn = (navigator as NavigatorWithConnection).connection;
    if (conn?.addEventListener) {
      const onConnChange = () => {
        if (!navigator.onLine) {
          this.updateStatus('offline');
          return;
        }
        const slow = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
        this.updateStatus(slow ? 'unstable' : 'online');
      };
      conn.addEventListener('change', onConnChange);
      this.cleanupHandlers.push(() => conn.removeEventListener?.('change', onConnChange));
    }
  }

  dispose(): void {
    this.cleanupHandlers.forEach(cleanup => {
      try {
        cleanup();
      } catch (e) {
        this.logger.error('[BrowserNetworkStatusAdapter] dispose error', e, {
          service: 'BrowserNetworkStatusAdapter',
        });
      }
    });
    this.cleanupHandlers = [];
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  isOnline(): boolean {
    return this.currentStatus === 'online' || this.currentStatus === 'unstable';
  }

  onChange(listener: (status: NetworkStatus) => void): () => void {
    return networkEventBus.subscribe(listener);
  }

  private updateStatus(status: NetworkStatus): void {
    if (this.currentStatus === status) return;
    this.logger.info('[BrowserNetworkStatusAdapter] status changed', {
      service: 'BrowserNetworkStatusAdapter',
      from: this.currentStatus,
      to: status,
    });
    this.currentStatus = status;
    networkEventBus.emit(status);
  }
}

export function createBrowserNetworkStatusAdapter(logger?: ILoggerPort): INetworkStatusPort {
  return new BrowserNetworkStatusAdapter(logger);
}

export const browserNetworkStatusAdapter: INetworkStatusPort = new BrowserNetworkStatusAdapter();