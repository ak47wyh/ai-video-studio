import React from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logSinkPort } from '../../dependencies';

interface Props extends WithTranslation {
  children: React.ReactNode;
  /** "root" = 全屏兜底；"route" = 仅占据路由内容区域，保留侧边栏等框架 */
  variant?: 'root' | 'route';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryClass extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 写入 RingBuffer，让应用内日志面板能看到 React 渲染错误
    logSinkPort.write({
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `eb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      level: 'error',
      message: `React ErrorBoundary caught: ${error.message}`,
      context: {
        source: 'ErrorBoundary',
        componentStack: info.componentStack,
      },
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { t } = this.props;
      const isRoute = this.props.variant === 'route';
      const containerStyle: React.CSSProperties = isRoute
        ? {
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: '50vh', padding: '2rem', textAlign: 'center',
            color: 'var(--text-primary, #e5e5e5)',
          }
        : {
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: '100vh', padding: '2rem', textAlign: 'center',
            background: 'var(--bg-base, #0a0a0f)', color: 'var(--text-primary, #e5e5e5)',
          };
      return (
        <div style={containerStyle}>
          <AlertTriangle size={isRoute ? 36 : 48} style={{ color: 'var(--color-danger)', marginBottom: '1.5rem' }} />
          <h2 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>{t('errorBoundary.title')}</h2>
          <p style={{ color: 'var(--text-muted, #9ca3af)', marginBottom: '1.5rem', maxWidth: '480px', lineHeight: 1.6 }}>
            {this.state.error?.message || t('errorBoundary.defaultMessage')}
          </p>
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            onClick={this.handleReload}
          >
            <RefreshCw size={16} /> {t('errorBoundary.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 错误边界组件（V3 §4.4：硬编码英文已国际化为 errorBoundary.* 键）。
 * 通过 withTranslation HOC 注入 t，使其响应语言切换。
 */
export const ErrorBoundary = withTranslation()(ErrorBoundaryClass);
