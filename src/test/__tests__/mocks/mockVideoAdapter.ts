import { vi } from 'vitest';
import type { IVideoGeneratorPort, VideoPromptContext, VideoTaskResult, VideoDownloadResult } from '../../../domain/ports/OutboundPorts';

/**
 * 创建 Mock 视频生成适配器（仅供单元测试使用）。
 *
 * 用法：
 * ```ts
 * const mockVideo = createMockVideoAdapter();
 * mockVideo.submitVideoTask.mockResolvedValue('test-task-123');
 * mockVideo.queryTaskStatus.mockResolvedValue({ status: 'SUCCESS', videoUrl: 'blob:test' });
 * ```
 */
export function createMockVideoAdapter(overrides?: Partial<IVideoGeneratorPort>): IVideoGeneratorPort {
  return {
    submitVideoTask: vi.fn<(_context: VideoPromptContext) => Promise<string>>().mockResolvedValue('mock-task-id'),
    queryTaskStatus: vi.fn<(_externalTaskId: string) => Promise<VideoTaskResult>>().mockResolvedValue({
      status: 'SUCCESS',
      videoUrl: 'blob:http://localhost/test-video',
    }),
    downloadVideo: vi.fn<(_fileId: string) => Promise<VideoDownloadResult>>().mockResolvedValue({
      downloadUrl: 'blob:http://localhost/test-video',
      filename: 'mock-video.mp4',
      bytes: 1024,
      createdAt: Date.now(),
    }),
    ...overrides,
  };
}
