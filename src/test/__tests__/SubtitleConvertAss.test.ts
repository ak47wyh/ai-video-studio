/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 SU-3：SRT → ASS 转换
 * - SubtitleService.convertSrtToAss 调用 IFFmpegPort.convertSubtitle(srt, 'ass', style)
 * - 未注入 ffmpegPort 时抛明确错误（不静默降级）
 */
import { describe, expect, it, vi } from 'vitest';
import { SubtitleService } from '../../domain/services/SubtitleService';
import type { IFFmpegPort } from '../../domain/ports/PostProcessPorts';

function makeService(ffmpeg?: IFFmpegPort): SubtitleService {
  return new SubtitleService(
    { load: vi.fn(async () => { }), transcribe: vi.fn(async () => []) } as never,
    {} as never,
    { load: vi.fn() } as never,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never,
    undefined,
    undefined,
    ffmpeg,
  );
}

describe('SU-3 SRT → ASS', () => {
  it('注入 ffmpegPort 时调用 convertSubtitle(srt, "ass", style)', async () => {
    const convertSubtitle = vi.fn(async () => '[Script Info]\nTitle: sub\n');
    const ffmpeg = { convertSubtitle } as unknown as IFFmpegPort;
    const svc = makeService(ffmpeg);
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n你好';
    const style = { fontName: 'Arial', fontSize: 24 };
    const out = await svc.convertSrtToAss(srt, style);
    expect(out).toContain('[Script Info]');
    expect(convertSubtitle).toHaveBeenCalledWith(srt, 'ass', style);
  });

  it('未注入 ffmpegPort 时抛出明确错误', async () => {
    const svc = makeService();
    await expect(svc.convertSrtToAss('1\n00:00:01,000 --> 00:00:02,000\nhi')).rejects.toThrow(/ffmpegPort not injected/);
  });
});
