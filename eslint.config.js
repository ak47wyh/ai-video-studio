import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * 六边形架构约束（v1.0）
 *
 * 目标：保证 Domain Core 层不依赖任何基础设施或框架，
 *       使业务逻辑可独立测试、可替换外部实现。
 *
 * 强制规则：
 * 1. src/domain/** 不得 import react、react-dom、react-i18next
 * 2. src/domain/** 不得 import localStorage（通过 window.localStorage）
 * 3. src/domain/** 不得 import axios、fetch 等具体 HTTP 客户端
 * 4. src/domain/** 不得 import i18next、react-i18next（应通过 ITranslationPort）
 *
 * 推荐规则（不强制）：
 * 5. src/domain/services/** 优先注入 Port 接口（依赖接口而非具体类）
 */
const DOMAIN_FORBIDDEN_IMPORTS = [
  {
    name: 'react',
    message: 'Domain 层禁止 import react。请通过 Port 抽象依赖副作用。',
  },
  {
    name: 'react-dom',
    message: 'Domain 层禁止 import react-dom。',
  },
  {
    name: 'react-i18next',
    message: 'Domain 层禁止 import react-i18next。请使用 ITranslationPort 替代。',
  },
  {
    name: 'i18next',
    message: 'Domain 层禁止 import i18next。请使用 ITranslationPort 替代。',
  },
  {
    name: 'axios',
    message: 'Domain 层禁止 import axios。HTTP 请求应通过 OutboundPorts 中的 Generator Port。',
  },
  {
    name: '@ffmpeg/ffmpeg',
    message: 'Domain 层禁止 import @ffmpeg/ffmpeg。FFmpeg 能力应通过 IFFmpegPort。',
  },
  {
    name: 'dexie',
    message: 'Domain 层禁止 import dexie。持久化应通过仓储 Port。',
  },
  {
    name: 'dexie-react-hooks',
    message: 'Domain 层禁止 import dexie-react-hooks。',
  },
];

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 允许以下划线开头的参数和变量名（如接口实现的占位参数）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // 架构约束：Domain 层禁止依赖基础设施
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: DOMAIN_FORBIDDEN_IMPORTS,
        patterns: [
          {
            group: ['@ffmpeg/*', 'dexie*'],
            message: 'Domain 层禁止 import 基础设施库。',
          },
        ],
      }],
      // 禁止 Domain 层直接访问 window.localStorage
      'no-restricted-globals': ['error', {
        name: 'localStorage',
        message: 'Domain 层禁止访问 localStorage。请通过 ISnapshotRepository / ITimelineRepository 等 Port。',
      }, {
        name: 'sessionStorage',
        message: 'Domain 层禁止访问 sessionStorage。',
      }],
      // 禁止 Domain 层使用 alert/confirm（弹窗副作用应通过 IConfirmPort / INotificationPort）
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.object.name='window'][callee.property.name='localStorage']",
        message: 'Domain 层禁止访问 window.localStorage。',
      }],
    },
  },
])
