import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MainLayout } from './ui/layouts/MainLayout';
import { SpaceProvider } from './ui/contexts/SpaceContext';
import { ToastProvider } from './ui/contexts/ToastContext';
import { ConfirmProvider } from './ui/contexts/ConfirmContext';
import { ThemeProvider } from './ui/contexts/ThemeContext';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { PageSkeleton } from './ui/components/PageSkeleton';
import { LogViewerContainer } from './ui/components/LogViewer/LogViewerContainer';
import { videoGenerationService } from './dependencies';
import { installGlobalErrorCapture } from './adapters/outbound/infrastructure/GlobalErrorCapture';
import { logSink } from './adapters/outbound/infrastructure/RingBufferLogSinkAdapter';

// 路由级代码分割 —— 把每个页面拆成独立的 chunk，首屏只下载当前路由所需的代码
// 配合 Vite 的 manualChunks + dynamic import，初次进入页面时仅加载目标 chunk
const Dashboard = lazy(() => import('./ui/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const CharacterManagement = lazy(() => import('./ui/pages/CharacterManagement').then(m => ({ default: m.CharacterManagement })));
const BackgroundManagement = lazy(() => import('./ui/pages/BackgroundManagement').then(m => ({ default: m.BackgroundManagement })));
const StoryWorkbench = lazy(() => import('./ui/pages/StoryWorkbench').then(m => ({ default: m.StoryWorkbench })));
const StorySpaceManagement = lazy(() => import('./ui/pages/StorySpaceManagement').then(m => ({ default: m.StorySpaceManagement })));
const Settings = lazy(() => import('./ui/pages/Settings').then(m => ({ default: m.Settings })));
const ExportCenter = lazy(() => import('./ui/pages/ExportCenter').then(m => ({ default: m.ExportCenter })));
const ImageLab = lazy(() => import('./ui/pages/ImageLab').then(m => ({ default: m.ImageLab })));
const VoiceLab = lazy(() => import('./ui/pages/VoiceLab').then(m => ({ default: m.VoiceLab })));
const TextLab = lazy(() => import('./ui/pages/TextLab').then(m => ({ default: m.TextLab })));
const VideoLab = lazy(() => import('./ui/pages/VideoLab').then(m => ({ default: m.VideoLab })));
const MusicLab = lazy(() => import('./ui/pages/MusicLab').then(m => ({ default: m.MusicLab })));
const WatermarkLab = lazy(() => import('./ui/pages/WatermarkLab').then(m => ({ default: m.WatermarkLab })));
const EnhanceLab = lazy(() => import('./ui/pages/EnhanceLab').then(m => ({ default: m.EnhanceLab })));
const VideoEditor = lazy(() => import('./ui/pages/VideoEditor').then(m => ({ default: m.VideoEditor })));
const SpaceDetailPage = lazy(() => import('./ui/pages/SpaceDetailPage').then(m => ({ default: m.SpaceDetailPage })));

/**
 * Phase 4 性能优化 —— 首屏空闲时预加载核心页面 chunk
 *
 * 策略：
 * - requestIdleCallback 在浏览器空闲时（首屏渲染完成后）发起
 * - 预加载用户最高频进入的页面（StoryWorkbench / ExportCenter）
 * - 即使预加载失败也不影响正常流程（catch 静默）
 * - 仅触发下载，不触发渲染（不创建 React 组件实例）
 *
 * 收益：
 * - 用户从 Dashboard 跳到 StoryWorkbench 时，chunk 已在浏览器 cache
 * - 感知延迟从 ~150ms（下载 57KB）降到 ~10ms（直接执行）
 */
function preloadCriticalChunks(): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  const schedule = (fn: () => void) => {
    if (typeof ric === 'function') ric(fn, { timeout: 4000 });
    else setTimeout(fn, 1500);
  };

  schedule(() => {
    import('./ui/pages/StoryWorkbench').catch(() => undefined);
    import('./ui/pages/ExportCenter').catch(() => undefined);
    import('./ui/pages/CharacterManagement').catch(() => undefined);
  });
}

function App() {
  // Resume polling for any active video tasks after page reload
  React.useEffect(() => {
    videoGenerationService.resumeActivePolling().catch(console.error);
    return () => videoGenerationService.cancelAllPolling();
  }, []);

  // 安装全局错误捕获（window.onerror / unhandledrejection → logSink）
  React.useEffect(() => {
    return installGlobalErrorCapture(logSink);
  }, []);

  // 首屏空闲时预加载高频页面 chunk
  React.useEffect(() => {
    preloadCriticalChunks();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter basename="/ai-video-studio">
          <SpaceProvider>
            <ToastProvider>
              <ConfirmProvider>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Routes>
                  <Route path="/" element={<MainLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="characters" element={<CharacterManagement />} />
                    <Route path="backgrounds" element={<BackgroundManagement />} />
                    <Route path="workbench" element={<StoryWorkbench />} />
                    <Route path="spaces" element={<StorySpaceManagement />} />
                    <Route path="spaces/:id" element={<SpaceDetailPage />} />
                    <Route path="export" element={<ExportCenter />} />
                    <Route path="labs/image" element={<ImageLab />} />
                    <Route path="labs/voice" element={<VoiceLab />} />
                    <Route path="labs/text" element={<TextLab />} />
                    <Route path="labs/video" element={<VideoLab />} />
                    <Route path="labs/music" element={<MusicLab />} />
                    <Route path="labs/watermark" element={<WatermarkLab />} />
                    <Route path="labs/enhance" element={<EnhanceLab />} />
                    <Route path="editor" element={<VideoEditor />} />
                    <Route path="settings" element={<Settings />} />
                  </Route>
                </Routes>
                </Suspense>
              </ConfirmProvider>
            </ToastProvider>
          </SpaceProvider>
        </BrowserRouter>
      </ThemeProvider>
      <LogViewerContainer />
    </ErrorBoundary>
  );
}

/**
 * 路由 lazy 加载占位 —— 首次进入页面或切换路由时短暂显示的骨架屏。
 * V3 §6.2：用骨架屏替代纯文本"加载中…"，保持视觉连续性。
 */
const RouteLoadingFallback: React.FC = () => <PageSkeleton />;

export default App;
