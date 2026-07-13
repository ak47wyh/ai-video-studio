import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { notificationPort } from '../../dependencies';
import type { ToastBridgeEvent } from '../../domain/ports/CrossCuttingPorts';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  removeToast: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext);
}

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, type, message }]);
    const timeoutId = setTimeout(() => {
      timeoutRefs.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
    timeoutRefs.current.set(id, timeoutId);
  }, []);

  const removeToast = useCallback((id: string) => {
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const currentTimeouts = timeoutRefs.current;
    return () => {
      currentTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
      currentTimeouts.clear();
    };
  }, []);

  // 订阅 reactNotificationAdapter 发出的事件桥（Phase 2 DIP：走 Port 订阅）
  useEffect(() => {
    const unsubscribe = notificationPort.subscribe((event: ToastBridgeEvent) => {
      // 处理 dismiss 事件（ReactNotificationAdapter 内部约定）
      if (event.message.startsWith('__dismiss__:')) {
        const id = event.message.split(':')[1];
        removeToast(id);
        return;
      }
      showToast(event.type === 'warn' ? 'warning' : event.type, event.message);
    });
    return unsubscribe;
  }, [showToast, removeToast]);

  const getToastStyle = (type: ToastType): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: '0.75rem 1.25rem',
      borderRadius: 'var(--radius-md)',
      fontSize: '0.875rem',
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      animation: 'fadeIn 0.3s ease',
      cursor: 'pointer',
      minWidth: '280px',
      maxWidth: '480px',
    };
    switch (type) {
      case 'success':
        return { ...base, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' };
      case 'error':
        return { ...base, background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' };
      case 'warning':
        return { ...base, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' };
      case 'info':
        return { ...base, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' };
    }
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
    }
  };

  // Provider value 稳定化，避免每次渲染派发新对象
  const contextValue = useMemo(
    () => ({ showToast, removeToast }),
    [showToast, removeToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed',
        top: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{ ...getToastStyle(toast.type), pointerEvents: 'auto' }}
            onClick={() => removeToast(toast.id)}
          >
            <span style={{ fontSize: '1rem', flexShrink: 0 }}>{getIcon(toast.type)}</span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
