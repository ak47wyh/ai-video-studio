import { vi } from 'vitest';
import type {
  IVoicePort, VoiceCapabilities, T2ASyncContext, T2ASyncResult,
  T2AAsyncContext, T2AAsyncResult,
  T2AAsyncStatus, VoiceType, VoiceListResult,
  FileUploadResult,
} from '../../../domain/ports/OutboundPorts';

/**
 * 创建 Mock 语音合成适配器（仅供单元测试使用）。
 *
 * 用法：
 * ```ts
 * const mockVoice = createMockVoiceAdapter();
 * mockVoice.synthesizeSpeechSync.mockResolvedValue({
 *   audioUrl: 'blob:test-audio',
 *   audioLength: 3000,
 *   audioSize: 1024,
 *   usageCharacters: 10,
 * });
 */
export function createMockVoiceAdapter(overrides?: Partial<IVoicePort>): IVoicePort {
  return {
    voiceCapabilities: {
      supportsClone: false,
      supportsDesign: false,
      supportsDelete: false,
      supportsStream: false,
      supportsConversion: false,
    } as VoiceCapabilities,
    synthesizeSpeechSync: vi.fn<(_context: T2ASyncContext) => Promise<T2ASyncResult>>().mockResolvedValue({
      audioUrl: 'blob:http://localhost/test-audio',
      audioLength: 3000,
      audioSize: 1024,
      usageCharacters: 10,
    }),
    uploadFile: vi.fn<(_file: File, _purpose: 'voice_clone' | 'prompt_audio' | 't2a_async_input') => Promise<FileUploadResult>>().mockResolvedValue({
      fileId: 'mock-file-id',
    }),
    createT2ATask: vi.fn<(_context: T2AAsyncContext) => Promise<T2AAsyncResult>>().mockResolvedValue({
      taskId: 'mock-async-task',
    }),
    queryT2ATask: vi.fn<(_taskId: string) => Promise<T2AAsyncStatus>>().mockResolvedValue({
      status: 'success',
      audioUrl: 'blob:http://localhost/test-async-audio',
    }),
    getFileUrl: vi.fn<(_fileId: string) => string>().mockReturnValue('blob:http://localhost/test-file'),
    fetchAudioAsBlobUrl: vi.fn<(_audioUrl: string) => Promise<string>>().mockResolvedValue('blob:http://localhost/test-audio'),
    getAvailableVoices: vi.fn<(_voiceType: VoiceType) => Promise<VoiceListResult>>().mockResolvedValue({
      systemVoices: [],
      clonedVoices: [],
    }),
    ...overrides,
  };
}
