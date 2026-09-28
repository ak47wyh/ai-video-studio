/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 SU-2：字幕样式编辑器 + 预设
 * - SUBTITLE_PRESETS 三预设字段完整
 * - matchesPreset 判定
 * - SubtitleStyleEditor 渲染预设/控件，交互更新样式
 */
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SUBTITLE_PRESETS, SUBTITLE_PRESET_IDS, matchesPreset } from '../../domain/data/subtitlePresets';
import { SubtitleStyleEditor } from '../../ui/components/SubtitleStyleEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

// jsdom 未实现 canvas getContext：mock 为 null 避免渲染噪音
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);

describe('SU-2 字幕样式预设', () => {
  it('预设库包含 douyin/bilibili/cinematic 且字段完整', () => {
    expect(SUBTITLE_PRESET_IDS.sort()).toEqual(['bilibili', 'cinematic', 'douyin']);
    for (const id of SUBTITLE_PRESET_IDS) {
      const p = SUBTITLE_PRESETS[id];
      expect(p.fontFamily).toBeTruthy();
      expect(p.fontSize).toBeGreaterThan(0);
      expect(p.primaryColor).toMatch(/^#/);
      expect(p.outlineColor).toMatch(/^#/);
      expect(p.outlineWidth).toBeGreaterThanOrEqual(0);
      expect(p.position).toBeDefined();
      expect(p.marginV).toBeGreaterThan(0);
      expect(typeof p.bold).toBe('boolean');
    }
  });

  it('matchesPreset 判定相同/不同样式', () => {
    expect(matchesPreset({ ...SUBTITLE_PRESETS.douyin }, 'douyin')).toBe(true);
    expect(matchesPreset({ ...SUBTITLE_PRESETS.douyin, fontSize: 40 }, 'douyin')).toBe(false);
    expect(matchesPreset({ ...SUBTITLE_PRESETS.cinematic }, 'bilibili')).toBe(false);
  });
});

describe('SU-2 SubtitleStyleEditor', () => {
  it('渲染预设下拉与控件（预设/字体/字号/位置）', () => {
    const { container } = render(<SubtitleStyleEditor value={{ ...SUBTITLE_PRESETS.douyin }} onChange={vi.fn()} />);
    expect(container.querySelector('#subtitle-style-preset')).toBeTruthy();
    expect(container.querySelector('#subtitle-style-font')).toBeTruthy();
    expect(container.querySelector('#subtitle-style-font-size')).toBeTruthy();
    expect(container.querySelector('#subtitle-style-position')).toBeTruthy();
    expect(container.querySelector('#subtitle-style-bold')).toBeTruthy();
  });

  it('选择预设时应用完整预设字段', () => {
    const onChange = vi.fn();
    const { container } = render(<SubtitleStyleEditor value={{ ...SUBTITLE_PRESETS.bilibili }} onChange={onChange} />);
    const preset = container.querySelector('#subtitle-style-preset') as HTMLSelectElement;
    fireEvent.change(preset, { target: { value: 'cinematic' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: 'Georgia', fontSize: 28, bold: false }));
  });

  it('调整字号滑块触发 onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<SubtitleStyleEditor value={{ ...SUBTITLE_PRESETS.douyin }} onChange={onChange} />);
    const size = container.querySelector('#subtitle-style-font-size') as HTMLInputElement;
    fireEvent.change(size, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 20 }));
  });
});
