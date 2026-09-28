/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 A-2：架构契约测试——无 Mock 泄漏
 *
 * 契约：
 *   1. 所有 Mock 适配器（src/adapters/outbound/api/Mock*.ts）必须带 `_isMock` 标记
 *      （继承 BaseMockAdapter 或显式声明）。
 *   2. 生产装配（dependencies.ts）中 Mock 只能以显式 `mockXxx` 实例存在，
 *      且必须被 PlatformAware* 包装后注入业务服务（不允许业务直接拿到裸 Mock）。
 *   3. 运行时实例断言：实例化 Mock 适配器可识别 `_isMock === true`。
 *
 * 说明：本契约做"源级 + 运行时"双重校验，不导入 dependencies 全量
 * （避免 jsdom 下 IndexedDB 初始化副作用），装配关系以源文件文本断言。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockTextSplitterAdapter } from '../../adapters/outbound/api/MockTextSplitter';
import { MockStoryBreakdownAdapter } from '../../adapters/outbound/api/MockStoryBreakdown';

const MOCK_DIR = join(__dirname, '../../adapters/outbound/api');

function listMockFiles(): string[] {
  return readdirSync(MOCK_DIR).filter(f => /^Mock.*\.ts$/.test(f));
}

function read(path: string): string {
  return readFileSync(join(MOCK_DIR, path), 'utf8');
}

describe('A-2 Mock 适配器隔离契约', () => {
  it('目录中每个 Mock 文件都带 _isMock 标记（继承 BaseMockAdapter 或显式声明）', () => {
    const files = listMockFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = read(f);
      const marked = src.includes('_isMock') || src.includes('BaseMockAdapter');
      expect(marked, `${f} 缺少 _isMock 标记`).toBe(true);
    }
  });

  it('Mock 类运行时实例可识别 _isMock === true', () => {
    const splitter = new MockTextSplitterAdapter();
    const breakdown = new MockStoryBreakdownAdapter();
    expect(splitter._isMock).toBe(true);
    expect(breakdown._isMock).toBe(true);
  });

  it('生产装配中 Mock 只以显式 mockXxx 实例存在并被 PlatformAware 包装', () => {
    const depsSrc = readFileSync(join(__dirname, '../../dependencies.ts'), 'utf8');
    // 显式命名实例
    expect(depsSrc).toContain('export const mockTextSplitter');
    expect(depsSrc).toContain('export const mockStoryBreakdown');
    // 注入路径必须经过 PlatformAware 包装（Mock 作为兜底参数传入）
    expect(depsSrc).toMatch(/PlatformAwareTextSplitter\([^)]*mockTextSplitter/);
    expect(depsSrc).toMatch(/PlatformAwareStoryBreakdown\([^)]*mockStoryBreakdown/);
  });

  it('生产主装配器（smartTextSplitter/smartStoryBreakdown）不应是裸 Mock 类', () => {
    // 静态：主装配器文件（PlatformAware*，位于 outbound/services）自身不带 Mock 标记
    const awareSplitter = readFileSync(join(__dirname, '../../adapters/outbound/services/PlatformAwareTextSplitter.ts'), 'utf8');
    const awareBreakdown = readFileSync(join(__dirname, '../../adapters/outbound/services/PlatformAwareStoryBreakdown.ts'), 'utf8');
    expect(awareSplitter).not.toContain('_isMock = true');
    expect(awareBreakdown).not.toContain('_isMock = true');
    // 运行时：Mock 类实例携带标记（与生产主装配器类型可区分）
    const splitter = new MockTextSplitterAdapter();
    const breakdown = new MockStoryBreakdownAdapter();
    expect((splitter as unknown as { _isMock: boolean })._isMock).toBe(true);
    expect((breakdown as unknown as { _isMock: boolean })._isMock).toBe(true);
  });
});
