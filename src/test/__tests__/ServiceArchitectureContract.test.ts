/**
 * ServiceArchitectureContract —— Phase 2 反转架构契约测试
 *
 * 目的：
 * - 防止 Phase 2 的"依赖注入反转"被未来代码改动回退
 * - 一旦 Service 直接 import 单例 ApiConfigStore / ConsoleLoggerAdapter，
 *   CI 立即失败 —— 强制开发者维持 Domain 层的纯净
 *
 * 验证项：
 * 1. 13 个核心 Service 文件不 import 单例 ApiConfigStore（仅可 import type）
 * 2. 13 个核心 Service 文件不 import 单例 defaultLogger（应使用注入的 ILoggerPort）
 * 3. 13 个核心 Service 都通过构造函数接受 IApiConfigStore（除少数纯函数式 Service）
 * 4. 构造函数签名中包含 ILoggerPort（除少数纯函数式 Service）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Phase 2 反转过的 13 个核心 Service（按文件路径列出）
const SERVICE_FILES = [
  'ImageGenerationService.ts',
  'MusicService.ts',
  'VideoGenerationService.ts',
  'MusicLabService.ts',
  'VoiceService.ts',
  'PipelineService.ts',
  'VideoLabService.ts',
  'TextLabService.ts',
  'TextGenerationService.ts',
  'BGMRecommendationService.ts',
  'CinematographyService.ts',
  'AgentService.ts',
  'SubtitleService.ts',
] as const;

const SERVICES_DIR = join(__dirname, '..', '..', 'domain', 'services');

/** 读取 Service 源文件 */
function readServiceSource(filename: string): string {
  return readFileSync(join(SERVICES_DIR, filename), 'utf-8');
}

/** 检查 services 目录存在 */
function ensureServicesDirExists(): void {
  try {
    statSync(SERVICES_DIR);
  } catch {
    throw new Error(`Services 目录不存在: ${SERVICES_DIR}`);
  }
}

describe('Phase 2 反转架构契约（ServiceArchitectureContract）', () => {
  it('services 目录存在且包含目标 Service', () => {
    ensureServicesDirExists();
    const actual = readdirSync(SERVICES_DIR).filter(f => f.endsWith('.ts'));
    for (const f of SERVICE_FILES) {
      expect(actual).toContain(f);
    }
  });

  describe.each(SERVICE_FILES)('%s 反转契约', (serviceFile) => {
    it('不直接 import 单例 ApiConfigStore（仅可 import type）', () => {
      const src = readServiceSource(serviceFile);

      // 抽取所有 ApiConfigStore 的 import 行（排除注释行）
      const importLines = src
        .split('\n')
        .filter(l => /^\s*import\b/.test(l)) // 行首 import 语句
        .filter(l => /ApiConfigStore\b/.test(l));

      expect(importLines.length, `${serviceFile} 不应 import ApiConfigStore`)
        .toBeGreaterThan(0); // 至少要有 type 导入

      for (const line of importLines) {
        expect(
          line,
          `${serviceFile} 仅可 "import type { ... } from '...ApiConfigStore'"，禁止运行时 import: ${line.trim()}`
        ).toMatch(/^import\s+type\s+/);
      }
    });

    it('不直接 import 单例 defaultLogger / ConsoleLoggerAdapter', () => {
      // 移除所有注释行（包括 // 和 /* */ 行内注释），仅检查实际代码
      const codeOnly = readServiceSource(serviceFile)
        .split('\n')
        .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)) // 排除纯注释行
        .map(l => l.replace(/\/\/.*$/, '')) // 移除行内 // 注释
        .join('\n');

      // 禁止直接 import 默认 Logger 单例
      expect(
        /from\s+['"][^'"]*ConsoleLoggerAdapter['"]/.test(codeOnly),
        `${serviceFile} 不应 import 单例 ConsoleLoggerAdapter，应通过 ILoggerPort 注入`
      ).toBe(false);

      // 禁止引用 defaultLogger 标识符（运行时）
      expect(
        /\bdefaultLogger\b/.test(codeOnly),
        `${serviceFile} 不应引用单例 defaultLogger，应通过 this.logger 使用注入的 ILoggerPort`
      ).toBe(false);
    });

    it('构造函数接受 IApiConfigStore（除 PipelineService 通过 deps 注入）', () => {
      const src = readServiceSource(serviceFile);

      if (serviceFile === 'PipelineService.ts') {
        // PipelineService 使用 deps 对象注入，验证接口契约
        expect(src).toMatch(/configStore:\s*IApiConfigStore/);
        return;
      }

      // 验证字段声明与赋值
      expect(
        /private\s+configStore:\s*IApiConfigStore\b|configStore:\s*IApiConfigStore\b/.test(src),
        `${serviceFile} 应声明 configStore 字段为 IApiConfigStore 类型`
      ).toBe(true);
      expect(
        /this\.configStore\s*=\s*configStore/.test(src),
        `${serviceFile} 应在构造函数中赋值 this.configStore`
      ).toBe(true);
    });

    it('构造函数接受 ILoggerPort（除 PipelineService 通过 deps 注入）', () => {
      const src = readServiceSource(serviceFile);

      if (serviceFile === 'PipelineService.ts') {
        expect(src).toMatch(/logger:\s*ILoggerPort/);
        return;
      }

      // 验证字段声明与赋值
      expect(
        /private\s+_?logger:\s*ILoggerPort\b|_?logger:\s*ILoggerPort\b/.test(src),
        `${serviceFile} 应声明 logger 字段为 ILoggerPort 类型`
      ).toBe(true);
      expect(
        /this\._?logger\s*=\s*logger/.test(src) || /this\._?logger\s*=\s*deps\.logger/.test(src),
        `${serviceFile} 应在构造函数中赋值 this.logger`
      ).toBe(true);
    });
  });
});

/**
 * P0-3：全局架构边界契约（Architecture_Refactor_Design §12.3）
 *
 * 新增 5 条铁律，防止未来 PR 破坏六边形架构：
 *   1. `src/domain/**` 不得 `import from '.../adapters/...'`（除 `import type`）
 *   2. `src/domain/**` 不得 `import from '.../ui/...'`
 *   3. `src/domain/**` 不得 `import from 'react|react-dom|axios|dexie|@ffmpeg/...'`
 *   4. `src/domain/**` 不得 `import from 'i18next|react-i18next'`
 *   5. `src/ui/**` 不得直接 `import from '.../adapters/outbound/api/...'`（应通过 dependencies）
 */

const DOMAIN_DIR = join(__dirname, '..', '..', 'domain');
const UI_DIR = join(__dirname, '..', '..', 'ui');

/** 递归收集目录下所有 .ts / .tsx 文件（排除 test 文件） */
function collectSourceFiles(dir: string): string[] {
  const result: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
        result.push(full);
      }
    }
  };
  walk(dir);
  return result;
}

/** 抽取纯代码（去掉 // 与 /* *\/ 注释与字符串内容也不影响 import 语句判定） */
function extractImportLines(src: string): string[] {
  return src
    .split('\n')
    .filter(l => /^\s*import\b/.test(l));
}

describe('P0-3 六边形架构全局契约（GlobalArchitectureContract）', () => {
  const domainFiles = collectSourceFiles(DOMAIN_DIR);
  const uiFiles = collectSourceFiles(UI_DIR);

  it('domain 层扫描到至少 20 个源文件', () => {
    expect(domainFiles.length).toBeGreaterThan(20);
  });

  it('domain/** 不得 import 具体 adapter 类（仅允许 import type）', () => {
    const violations: string[] = [];
    for (const file of domainFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of extractImportLines(src)) {
        // 只匹配 domain 内部 import 相对路径指向 adapters
        if (/from\s+['"][^'"]*\/adapters\/[^'"]*['"]/.test(line)) {
          if (!/^import\s+type\s+/.test(line.trim())) {
            violations.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    // 已知残留：PlatformRouter 尚未完成依赖反转（P0-2 目标），此处允许该文件豁免
    const filteredViolations = violations.filter(v => !v.includes('PlatformRouter.ts'));
    expect(
      filteredViolations,
      `domain 层禁止直接 import adapters 具体类（PlatformRouter 除外，见 P0-2 重构任务）：\n${filteredViolations.join('\n')}`,
    ).toEqual([]);
  });

  it('domain/** 不得 import from ui', () => {
    const violations: string[] = [];
    for (const file of domainFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of extractImportLines(src)) {
        if (/from\s+['"][^'"]*\/ui\/[^'"]*['"]/.test(line)) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(
      violations,
      `domain 层禁止 import UI（依赖方向：ui → domain ← adapters）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('domain/** 不得 import 框架/HTTP/DB/FFmpeg 具体实现', () => {
    const forbiddenPackages = [
      /^import[^'"]+['"]react['"]/,
      /^import[^'"]+['"]react-dom['"]/,
      /^import[^'"]+['"]i18next['"]/,
      /^import[^'"]+['"]react-i18next['"]/,
      /^import[^'"]+['"]axios['"]/,
      /^import[^'"]+['"]dexie['"]/,
      /^import[^'"]+['"]@ffmpeg\//,
    ];
    const violations: string[] = [];
    for (const file of domainFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of extractImportLines(src)) {
        for (const pattern of forbiddenPackages) {
          if (pattern.test(line.trim())) {
            violations.push(`${file}: ${line.trim()}`);
            break;
          }
        }
      }
    }
    expect(
      violations,
      `domain 层禁止直接 import 框架/HTTP/DB/FFmpeg 具体库（应通过 Port 抽象）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('ui/** 不得直接 import from adapters/outbound/api（应通过 dependencies 注入）', () => {
    const violations: string[] = [];
    for (const file of uiFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of extractImportLines(src)) {
        if (/from\s+['"][^'"]*\/adapters\/outbound\/api\/[^'"]*['"]/.test(line)) {
          if (!/^import\s+type\s+/.test(line.trim())) {
            violations.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    // 允许 dependencies.ts 自身（这里 collectSourceFiles 不会包含 dependencies.ts，因其在 src/ 根）
    expect(
      violations,
      `UI 层禁止直接 import 具体平台 Adapter（应通过 dependencies 装配的 Port 使用）：\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});