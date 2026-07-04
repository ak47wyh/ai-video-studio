import React from 'react';
import { AlertCircle, RefreshCw, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 加载子态（V3 §6.2）：骨架屏(首次) / 内联 spinner(刷新) / 进度条(批量) */
export type LoadingVariant = 'spinner' | 'skeleton' | 'progress';

interface AsyncStateProps {
  /** 加载中 */
  loading?: boolean;
  /** 错误信息（Error 对象或字符串） */
  error?: Error | string | null;
  /** 空状态 */
  empty?: boolean;
  /** 空状态文案 */
  emptyText?: string;
  /** 重试回调（错误状态展示重试按钮） */
  onRetry?: () => void;
  /** 子内容（非 loading/error/empty 状态时展示） */
  children?: React.ReactNode;
  /** 自定义加载文案 */
  loadingText?: string;
  /** 最小高度（默认 200px） */
  minHeight?: number;
  /** 加载子态：spinner(默认) / skeleton(首次加载) / progress(批量任务) */
  loadingVariant?: LoadingVariant;
  /** 进度条模式下的当前进度（0-100），仅 loadingVariant='progress' 时生效 */
  progress?: number;
}

/**
 * 统一的异步状态组件。
 *
 * 用于 Lab 页面和列表页面，统一处理 loading / error / empty 三种非正常状态，
 * 避免各页面各自实现导致体验割裂。
 *
 * V3 §6.2：loading 增加 spinner / skeleton / progress 三种子态，
 * 适配首次加载、刷新、批量任务等不同场景。
 *
 * 用法：
 * ```tsx
 * <AsyncState loading={isLoading} error={error} empty={items.length === 0} onRetry={refetch}>
 *   {items.map(...)}
 * </AsyncState>
 * ```
 */
export const AsyncState: React.FC<AsyncStateProps> = ({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
  loadingText,
  minHeight = 200,
  loadingVariant = 'spinner',
  progress,
}) => {
  const { t } = useTranslation();
  const resolvedEmptyText = emptyText ?? t('common.noData');
  const resolvedLoadingText = loadingText ?? t('common.loading');
  // 加载状态
  if (loading) {
    // 骨架子态：用 shimmer 灰块占位，适合首次加载
    if (loadingVariant === 'skeleton') {
      return (
        <div className="glass-panel async-state-skeleton" style={{ minHeight }} role="status" aria-live="polite">
          <span className="skeleton skeleton-text" style={{ width: '40%' }} />
          <span className="skeleton skeleton-text" style={{ width: '85%' }} />
          <span className="skeleton skeleton-block" />
          <span className="skeleton skeleton-text" style={{ width: '70%' }} />
        </div>
      );
    }

    // 进度条子态：适合批量任务
    if (loadingVariant === 'progress') {
      const pct = Math.max(0, Math.min(100, progress ?? 0));
      return (
        <div
          className="glass-panel async-state-progress"
          style={{ minHeight }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="async-state-text">{resolvedLoadingText}</span>
          <div className="async-state-progress-track">
            <div className="async-state-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="async-state-hint">{pct}%</span>
        </div>
      );
    }

    // 默认 spinner 子态：适合刷新
    return (
      <div className="glass-panel async-state-spinner" style={{ minHeight }} role="status" aria-live="polite">
        <RefreshCw size={28} className="spin async-state-icon" />
        <span className="async-state-text">{resolvedLoadingText}</span>
      </div>
    );
  }

  // 错误状态
  if (error) {
    const message = typeof error === 'string' ? error : error.message || t('common.unknownError');
    return (
      <div className="glass-panel async-state-error" style={{ minHeight }}>
        <AlertCircle size={32} className="async-state-error-icon" />
        <div className="async-state-error-body">
          <p className="async-state-error-title">{t('common.operationFailed')}</p>
          <p className="async-state-error-detail">{message}</p>
        </div>
        {onRetry && (
          <button className="btn btn-secondary async-state-retry" onClick={onRetry}>
            <RefreshCw size={14} />
            {t('common.retry')}
          </button>
        )}
      </div>
    );
  }

  // 空状态
  if (empty) {
    return (
      <div className="glass-panel async-state-empty" style={{ minHeight }}>
        <Inbox size={36} className="async-state-empty-icon" />
        <span className="async-state-text">{resolvedEmptyText}</span>
      </div>
    );
  }

  // 正常内容
  return <>{children}</>;
};


interface EmptyStateProps {
  /** 描边图标（lucide-react），默认 Inbox */
  icon?: React.ReactNode;
  /** 标题（默认"暂无数据"） */
  title?: string;
  /** 描述文案 */
  description?: string;
  /** 主 CTA 按钮文案，提供时展示 */
  actionText?: string;
  /** CTA 点击回调 */
  onAction?: () => void;
  /** 最小高度 */
  minHeight?: number;
}

/**
 * 空状态组件（UI 交互优化 §4.3.2）。
 *
 * 统一为「插画图标 + 标题 + 描述 + 主 CTA」四件套，
 * 替代各页面散落的纯文字空态。
 *
 * 用法：
 * ```tsx
 * <EmptyState
 *   icon={<Film size={48} />}
 *   title="暂无视频任务"
 *   description="去工作台生成第一个视频"
 *   actionText="立即生成"
 *   onAction={() => navigate('/workbench')}
 * />
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
  minHeight = 200,
}) => {
  const { t } = useTranslation();
  return (
    <div className="glass-panel empty-state" style={{ minHeight }}>
      {icon ?? <Inbox size={48} />}
      <p className="empty-state-title">{title ?? t('common.noData')}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {actionText && onAction && (
        <button className="btn btn-primary empty-state-action" onClick={onAction}>
          {actionText}
        </button>
      )}
    </div>
  );
};
