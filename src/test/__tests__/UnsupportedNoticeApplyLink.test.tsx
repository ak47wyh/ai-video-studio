/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 A-1：不支持能力友好提示
 * - UnsupportedCapabilityNotice 展示当前平台 externalLink 申请入口
 * - 文案键 capability.unsupported / capability.apply
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { UnsupportedCapabilityNotice } from '../../ui/components/UnsupportedCapabilityNotice';

const mocks = vi.hoisted(() => ({
  setActivePlatform: vi.fn(),
  usePlatformCapabilities: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, _opts?: Record<string, unknown>) => fallback ?? key,
  }),
}));

vi.mock('../../dependencies', () => ({
  apiConfigStoreAdapter: { setActivePlatform: (...args: unknown[]) => mocks.setActivePlatform(...args) },
}));

vi.mock('../../ui/hooks/usePlatformCapabilities', () => ({
  usePlatformCapabilities: () => mocks.usePlatformCapabilities(),
}));

describe('A-1 不支持能力友好提示', () => {
  beforeEach(() => {
    mocks.usePlatformCapabilities.mockReturnValue({
      activePlatform: 'kling',
      platformMeta: {
        id: 'kling', name: '可灵', brand: 'Kling', icon: '🎥', accentColor: '#10b981',
        description: '', externalLink: 'https://klingai.kuaishou.com/', docLink: '',
        capabilities: ['video'], videoModels: [], imageModels: [], defaultImageModel: '', textModels: [],
      },
      listPlatformsSupporting: () => [
        { id: 'minimax', name: '海螺', brand: 'MiniMax', icon: '🎬', accentColor: '', description: '', externalLink: '', docLink: '', capabilities: [], videoModels: [], imageModels: [], defaultImageModel: '', textModels: [] },
      ],
    });
  });

  it('渲染申请入口外链（externalLink）', () => {
    const { container } = render(<UnsupportedCapabilityNotice capability="music" />);
    const link = container.querySelector('a[href="https://klingai.kuaishou.com/"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('externalLink 缺失时不渲染申请入口', () => {
    mocks.usePlatformCapabilities.mockReturnValue({
      activePlatform: 'kling',
      platformMeta: {
        id: 'kling', name: '可灵', brand: 'Kling', icon: '🎥', accentColor: '#10b981',
        description: '', externalLink: '', docLink: '', capabilities: ['video'],
        videoModels: [], imageModels: [], defaultImageModel: '', textModels: [],
      },
      listPlatformsSupporting: () => [],
    });
    const { container } = render(<UnsupportedCapabilityNotice capability="music" />);
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
  });

  it('保留一键切换平台 CTA', () => {
    const { container } = render(<UnsupportedCapabilityNotice capability="music" />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.some(b => b.textContent?.includes('海螺'))).toBe(true);
  });
});
