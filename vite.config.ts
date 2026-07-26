import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { filesStoragePlugin } from './vite/filesStoragePlugin'

// https://vite.dev/config/
export default defineConfig({
  base: '/ai-video-studio/',
  // dev server 启动后自动打开浏览器到 base 路径
  server: {
    port: 5173,
    // 端口被占用时直接报错退出，不静默切换端口，
    // 避免旧 dev server 进程残留导致新配置不生效的混淆场景。
    strictPort: true,
    open: '/ai-video-studio/',
    // 火山引擎所有接口走 Vite dev server proxy（详见 docs/VolcengineProxyDesign.md）
    // 其他平台保持直连,不在此配置代理
    proxy: {
      // 火山方舟所有接口统一走 /volcengine-ark 代理前缀。
      // 通过请求路径智能 rewrite 分流：
      //   - /images/* /contents/* -> /api/plan/v3（Agent Plan，图片/视频生成）
      //   - 其他路径              -> /api/v3（普通方舟，语音合成/文本对话）
      '/volcengine-ark': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const apiPath = path.replace(/^\/volcengine-ark/, '');
          if (apiPath.startsWith('/images/') || apiPath.startsWith('/contents/')) {
            return '/api/plan/v3' + apiPath;
          }
          return '/api/v3' + apiPath;
        },
      },
      // 语音技术 HTTP 端点（同步 TTS V1/V3、声音克隆）
      '/volcengine-speech': {
        target: 'https://openspeech.bytedance.com',
        changeOrigin: true,
        secure: true,
      },
      // 语音技术 WebSocket 端点（流式 TTS V1/V3、声音转换）—— 需显式 ws: true
      '/volcengine-speech-ws': {
        target: 'wss://openspeech.bytedance.com',
        changeOrigin: true,
        ws: true,
        secure: true,
      },
    },
  },
  plugins: [
    react(),
    // 本地文件存储插件 —— 为前端提供 POST /__files/upload 等路由，
    // 让图片/视频/音频 Blob 可以直接落到磁盘，无需 fetch 外部 URL
    filesStoragePlugin(),
  ],
  build: {
    // Phase 3 性能优化 —— 手动 vendor 拆分，避免单 chunk 过大阻塞首屏
    // 拆分原则：
    //  - react / react-dom 单独 chunk，所有页面共用
    //  - 大型重量级库（dexie、ffmpeg、lucide-react、react-i18next、react-router-dom）独立
    //  - 业务代码保留在动态 import 的 page chunks 内（App.tsx 已用 lazy() 拆分）
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          // vendor-react
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          // vendor-router
          if (id.includes('node_modules/react-router/') || id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/@remix-run/router')) {
            return 'vendor-router';
          }
          // vendor-i18n
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'vendor-i18n';
          }
          // vendor-icons
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          // vendor-db
          if (id.includes('node_modules/dexie') || id.includes('node_modules/dexie-react-hooks')) {
            return 'vendor-db';
          }
          // vendor-http
          if (id.includes('node_modules/axios')) {
            return 'vendor-http';
          }
          // vendor-ffmpeg —— 仅 @ffmpeg/util 静态引用会出现在这里
          // @ffmpeg/ffmpeg 已改为动态 import（首次 load() 时按需加载），
          // Rollup 会自动为它生成独立 chunk 并优先于 manualChunks 命中，
          // 因此此规则只匹配 util，不影响 @ffmpeg/ffmpeg 的按需加载语义
          if (id.includes('node_modules/@ffmpeg/util')) {
            return 'vendor-ffmpeg';
          }
          return undefined;
        },
      },
      // 提升单个 chunk 体积告警阈值，避免误报（FFmpeg + lucide 等大库合并后超 500KB 是预期行为）
      onwarn(warning, defaultHandler) {
        if (warning.code === 'CHUNK_SIZE_WARNING') return;
        defaultHandler(warning);
      },
    },
    // 单 chunk 体积目标：1MB（FFmpeg wasm 占空间但属于一次性加载）
    chunkSizeWarningLimit: 1024,
  },
})