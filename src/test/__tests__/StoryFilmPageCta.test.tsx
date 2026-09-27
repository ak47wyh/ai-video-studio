/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 S-2：生成完成显式跳转剪辑工作台
 * - 完成态展示「进入剪辑工作台」与「前往导出中心」CTA
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryFilmPage } from '../../ui/pages/StoryFilmPage';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock('../../dependencies', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }),
  voiceService: {
    getAvailableVoices: vi.fn(async () => ({ systemVoices: [], clonedVoices: [], designedVoices: [] })),
  },
  pipelineService: { getTask: vi.fn(() => undefined) },
}));
vi.mock('../../ui/contexts/SpaceContext', () => ({
  useSpace: () => ({ currentSpaceId: 'space-1' }),
}));
vi.mock('../../ui/hooks/usePlatformCapabilities', () => ({
  usePlatformCapabilities: () => ({
    activePlatform: 'minimax',
    platformMeta: { id: 'minimax', name: 'MiniMax', capabilities: ['video', 'image', 'text', 'audio'] },
    capabilities: ['video', 'image', 'text', 'audio'],
    capabilitySummary: '视频 / 图片 / 文本 / 音频',
    hasCapability: vi.fn(() => true),
    hasCapabilityOn: vi.fn(() => true),
    listPlatformsSupporting: vi.fn(() => []),
    ensureCapability: vi.fn(),
  }),
}));
vi.mock('../../ui/contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));
vi.mock('../../ui/hooks/useStoryFilm', () => ({
  useStoryFilm: () => ({
    step: 'preview',
    progress: null,
    result: { storyId: 'story-1', pipelineTaskId: 'pipe-1' },
    isGeneratingText: false,
    generatedText: '',
    startFilm: vi.fn(),
    generateText: vi.fn(),
    cancelFilm: vi.fn(),
    resetFilm: vi.fn(),
  }),
}));
vi.mock('../../ui/components/AsyncState', () => ({
  AsyncState: () => null,
}));

describe('StoryFilmPage S-2 CTA', () => {
  it('生成完成时显示进入剪辑工作台与前往导出中心按钮', async () => {
    render(<StoryFilmPage />);
    expect(screen.getByText('进入剪辑工作台')).toBeTruthy();
    expect(screen.getByText('前往导出中心')).toBeTruthy();
    expect(screen.getByText('重新生成')).toBeTruthy();
  });
});
