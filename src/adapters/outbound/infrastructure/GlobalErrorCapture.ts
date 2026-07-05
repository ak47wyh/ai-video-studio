/**
 * GlobalErrorCapture —— 浏览器全局错误捕获
 *
 * 用途：把 window.onerror 和 unhandledrejection 写入 ILogSinkPort，
 * 让 React ErrorBoundary 之外的运行时异常也能被 UI 日志面板看到。
 *
 * 约束：
 * - 返回的 dispose 函数应在应用卸载时调用，避免热重载导致监听器堆积
 * - 仅在浏览器环境生效（typeof window !== 'undefined'）
 */

import type { ILogSinkPort } from '../../../domain/ports/LoggingPorts';

const SENSITIVE_KEY_RE = /key|token|secret|password/i;

/** 浏览器原生 fetch 在 CORS 预检失败时抛的经典 TypeError 文案 */
const CORS_ERROR_PATTERNS = /Failed to fetch|NetworkError when attempting to fetch resource/i;

/**
 * 识别错误是否疑似浏览器 CORS 拦截。
 *
 * 适配器层归一化后的 CorsBlockedError 携带 `name === 'CorsBlockedError'` /
 * `errorCode === 'CORS_BLOCKED'`；未经归一化的原生 TypeError 通过文案匹配兜底。
 */
function isCorsErrorLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; errorCode?: string; message?: string };
  if (e.name === 'CorsBlockedError' || e.errorCode === 'CORS_BLOCKED') return true;
  if (e.name === 'TypeError' && typeof e.message === 'string' && CORS_ERROR_PATTERNS.test(e.message)) {
    return true;
  }
  return false;
}

function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function installGlobalErrorCapture(sink: ILogSinkPort): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onError = (event: ErrorEvent) => {
    const corsBlocked = isCorsErrorLike(event.error);
    sink.write({
      id: generateId(),
      timestamp: Date.now(),
      level: 'error',
      message: corsBlocked ? `[CORS] ${event.message || 'Uncaught error'}` : (event.message || 'Uncaught error'),
      context: redactContext({
        source: 'window.onerror',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        corsBlocked,
      }),
      error: event.error instanceof Error
        ? { name: event.error.name, message: event.error.message, stack: event.error.stack }
        : { name: 'ErrorEvent', message: String(event.error) },
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const corsBlocked = isCorsErrorLike(reason);
    sink.write({
      id: generateId(),
      timestamp: Date.now(),
      level: 'error',
      message: corsBlocked ? '[CORS] Unhandled promise rejection' : 'Unhandled promise rejection',
      context: { source: 'unhandledrejection', corsBlocked },
      error: reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack }
        : { name: typeof reason, message: String(reason) },
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}