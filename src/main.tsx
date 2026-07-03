import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { initializeFileStorage } from './dependencies'
import { ApiConfigStore } from './adapters/outbound/config/ApiConfigStore'

/**
 * 应用启动序列：
 * 1. 异步初始化 API 配置（解密 localStorage 密文到内存缓存）+ 文件存储（OPFS 优先，降级 IndexedDB）
 * 2. 渲染 React UI（不阻塞首屏）
 *
 * 初始化失败不会阻塞渲染，但会在用户首次使用依赖 fileStorage 的功能时报错。
 * 同时会把错误写入 logger，可在应用内日志面板（Ctrl+`）查看。
 *
 * 注意：本项目已按设计约束移除 Service Worker（不再注册、不再保留 sw.js）。
 * 老用户浏览器中残留的旧 SW 由 index.html 内联脚本一次性卸载清理。
 * 应用保持纯在线模式，所有资源走浏览器默认 HTTP 缓存。
 */
async function bootstrap(): Promise<void> {
  // ── vConsole：同步读取开关，尽早加载以捕获全部日志 ──
  // 第一层：尝试同步解析明文 JSON（首次保存前或加密不可用时）
  let vconsoleLoaded = false;
  try {
    const raw = localStorage.getItem('ai_video_studio_api_config');
    if (raw) {
      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(raw); } catch { /* 加密密文，等 init 后异步加载 */ }
      if (parsed && parsed.vconsoleEnabled === true) {
        vconsoleLoaded = true;
        import('vconsole').then(({ default: VConsole }) => {
          new VConsole();
          console.log('[vConsole] 已启用（同步）');
        }).catch(err => {
          console.warn('[vConsole] 加载失败:', err);
        });
      }
    }
  } catch { /* 读取失败不影响启动 */ }

  // 并行初始化：解密 API 配置 + 文件存储
  await Promise.all([
    ApiConfigStore.init(),
    initializeFileStorage(),
  ]).catch(err => {
    console.error('[Bootstrap] initialization failed:', err)
  })

  // ── vConsole：异步补充加载（加密存储场景） ──
  // 同步阶段无法解密密文，init 完成后内存缓存已填充，再检查一次
  if (!vconsoleLoaded && ApiConfigStore.load().vconsoleEnabled) {
    import('vconsole').then(({ default: VConsole }) => {
      new VConsole();
      console.log('[vConsole] 已启用（异步）');
    }).catch(err => {
      console.warn('[vConsole] 加载失败:', err);
    });
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
