import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { filesStoragePlugin } from './vite/filesStoragePlugin'

// https://vite.dev/config/
export default defineConfig({
  base: '/ai-video-studio/',
  // dev server 启动后自动打开浏览器到 base 路径
  server: {
    open: '/ai-video-studio/',
    // CORS 代理：仅代理不支持浏览器直连的平台。
    // - 火山方舟 (ark.cn-beijing.volces.com)：平台未返回 Access-Control-Allow-Origin，必须走代理
    // - 火山语音技术 (openspeech.bytedance.com)：同上，声音克隆/TTS 域名同样不支持 CORS
    // - MiniMax (api.minimaxi.com) 不配置代理：平台已支持 CORS 直连，避免不必要的转发开销
    proxy: {
      // 火山方舟 API（OpenAI 协议 /api/v3 + Anthropic 协议 /api/plan 共用同一域名）
      // 浏览器请求 /volc-ark/* → Vite dev server 转发到 https://ark.cn-beijing.volces.com/*
      '/volc-ark': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/volc-ark/, ''),
        secure: true,
      },
      // 火山引擎语音技术（声音克隆 / 声音转换 / 大模型 TTS，独立域名）
      // 浏览器请求 /volc-speech/* → Vite dev server 转发到 https://openspeech.bytedance.com/*
      '/volc-speech': {
        target: 'https://openspeech.bytedance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/volc-speech/, ''),
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
  // CORS 策略：MiniMax 直连（平台已支持 CORS），火山引擎走 server.proxy（平台不支持 CORS）。
  // 生产环境需部署 nginx 反代相同路径（/volc-ark/、/volc-speech/），详见部署文档。
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