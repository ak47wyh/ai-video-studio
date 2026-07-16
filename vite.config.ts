import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { filesStoragePlugin } from './vite/filesStoragePlugin'

// https://vite.dev/config/
export default defineConfig({
  base: '/ai-video-studio/',
  // dev server 启动后自动打开浏览器到 base 路径
  server: {
    open: '/ai-video-studio/',
    // 火山引擎视频/图片生成代理（CORS 不支持直连）
    proxy: {
      '/volcengine-ark': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/volcengine-ark/, '/api/plan/v3'),
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
  // 所有第三方 API 请求直连完整外部 URL，不再使用 Vite dev server 反向代理。
  // 若某平台不支持 CORS，用户可在应用内配置中心手动填入自建反代地址。
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