import { vi } from 'vitest';
import type {
  IMusicPort, MusicGenerationContext, MusicGenerationResult,
  LyricsGenerationContext, LyricsGenerationResult, CoverPreprocessResult,
} from '../../../domain/ports/OutboundPorts';

/**
 * 创建 Mock 音乐生成适配器（仅供单元测试使用）。
 *
 * 用法：
 * ```ts
 * const mockMusic = createMockMusicAdapter();
 * mockMusic.generateMusic.mockResolvedValue({
 *   audioUrl: 'blob:test-music',
 *   duration: 30000,
 *   sampleRate: 44100,
 *   bitrate: 256000,
 * });
 * ```
 */
export function createMockMusicAdapter(overrides?: Partial<IMusicPort>): IMusicPort {
  return {
    generateMusic: vi.fn<(_context: MusicGenerationContext) => Promise<MusicGenerationResult>>().mockResolvedValue({
      audioUrl: 'blob:http://localhost/test-music',
      duration: 30000,
      sampleRate: 44100,
      bitrate: 256000,
    }),
    generateLyrics: vi.fn<(_context: LyricsGenerationContext) => Promise<LyricsGenerationResult>>().mockResolvedValue({
      lyrics: 'Mock lyrics content',
    }),
    preprocessCover: vi.fn<(_audioUrl: string) => Promise<CoverPreprocessResult>>().mockResolvedValue({
      coverFeatureId: 'mock-cover-feature',
      formattedLyrics: 'Mock formatted lyrics',
      structureResult: 'Mock structure',
      audioDuration: 30000,
    }),
    ...overrides,
  };
}
