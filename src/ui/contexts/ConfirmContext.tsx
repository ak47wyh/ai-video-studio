import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmPort } from '../../dependencies';
import type { ConfirmBridgeRequest } from '../../domain/ports/CrossCuttingPorts';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: () => Promise.resolve(false),
});

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  return useContext(ConfirmContext);
}

// Inner component that can use hooks
const ConfirmDialog: React.FC<{
  dialog: ConfirmOptions & { resolve: (value: boolean) => void };
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ dialog, onConfirm, onCancel }) => {
  const { t } = useTranslation();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease'
      }}
      onClick={onCancel}
    >
      <div
        className="glass-panel"
        style={{
          padding: '2rem', minWidth: '360px', maxWidth: '440px',
          animation: 'fadeIn 0.2s ease'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: '0.75rem', fontSize: '1.1rem' }}>{dialog.title}</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          {dialog.message}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-secondary"
            onClick={onCancel}
          >
            {dialog.cancelLabel || t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            style={dialog.danger ? { background: 'linear-gradient(135deg, #ef4444, #dc2626)' } : undefined}
          >
            {dialog.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ConfirmProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  // 订阅 reactConfirmAdapter 发出的事件桥（Phase 2 DIP：走 Port 订阅）
  useEffect(() => {
    const unsubscribe = confirmPort.subscribe((req: ConfirmBridgeRequest) => {
      setDialog({
        title: req.title,
        message: req.message,
        confirmLabel: req.confirmText,
        cancelLabel: req.cancelText,
        danger: req.destructive,
        resolve: req.resolve,
      });
    });
    return unsubscribe;
  }, []);

  const handleConfirm = () => {
    dialog?.resolve(true);
    setDialog(null);
  };

  const handleCancel = () => {
    dialog?.resolve(false);
    setDialog(null);
  };

  // Provider value 稳定化，避免每次渲染派发新对象
  const contextValue = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {dialog && (
        <ConfirmDialog dialog={dialog} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </ConfirmContext.Provider>
  );
};
