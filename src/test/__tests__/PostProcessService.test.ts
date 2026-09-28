/**
 * C1 补充：PostProcessService 后处理编排（A3 成片管线）
 *
 * 覆盖：
 * - ensureLoaded / isLoaded 委托到 ffmpeg + whisper
 * - mergeVideoAudio / burnSubtitles / mixBGM / applyTransition / concatClips / compress / trim 参数透传
 * - 底层抛错向上传播（不静默吞掉）
 */
import { describe, it, expect, vi } from 'vitest';
import { PostProcessService } from '../../domain/services/PostProcessService';
import type { IFFmpegPort, IWhisperPort } from '../../domain/ports/PostProcessPorts';

function makeFFmpeg(): IFFmpegPort {
  return {
    load: vi.fn(async () => { }),
    isLoaded: vi.fn(() => true),
    merge: vi.fn(async () => new Blob(['merged'])),
    burnSubtitles: vi.fn(async () => new Blob(['subbed'])),
    mixAudio: vi.fn(async () => new Blob(['mixed'])),
    applyTransition: vi.fn(async () => new Blob(['transition'])),
    concat: vi.fn(async () => new Blob(['concat'])),
    compress: vi.fn(async () => new Blob(['compressed'])),
    convertFormat: vi.fn(async () => new Blob(['converted'])),
    changeSpeed: vi.fn(async () => new Blob(['sped'])),
    trim: vi.fn(async () => new Blob(['trimmed'])),
    crop: vi.fn(async () => new Blob(['cropped'])),
    extractAudio: vi.fn(async () => new Blob(['audio'])),
    snapshot: vi.fn(async () => new Blob(['snap'])),
  } as unknown as IFFmpegPort;
}

function makeWhisper(): IWhisperPort {
  return {
    load: vi.fn(async () => { }),
    isLoaded: vi.fn(() => true),
    transcribe: vi.fn(async () => []),
  } as unknown as IWhisperPort;
}

describe('PostProcessService — 后处理编排（A3）', () => {
  it('ensureLoaded 依次加载 ffmpeg 与 whisper', async () => {
    const ff = makeFFmpeg();
    const ws = makeWhisper();
    const svc = new PostProcessService(ff, ws);
    await svc.ensureLoaded();
    expect(ff.load).toHaveBeenCalledTimes(1);
    expect(ws.load).toHaveBeenCalledTimes(1);
  });

  it('isFFmpegLoaded / isWhisperLoaded 委托底层状态', () => {
    const ff = makeFFmpeg();
    const ws = makeWhisper();
    const svc = new PostProcessService(ff, ws);
    expect(svc.isFFmpegLoaded()).toBe(true);
    expect(svc.isWhisperLoaded()).toBe(true);
    expect(ff.isLoaded).toHaveBeenCalled();
    expect(ws.isLoaded).toHaveBeenCalled();
  });

  it('mergeVideoAudio 透传 video/audio/offset 给 ffmpeg.merge', async () => {
    const ff = makeFFmpeg();
    const svc = new PostProcessService(ff, makeWhisper());
    const v = new Blob(['v']);
    const a = new Blob(['a']);
    const out = await svc.mergeVideoAudio(v, a, 0.5);
    expect(out).toBeInstanceOf(Blob);
    expect(ff.merge).toHaveBeenCalledWith({ video: v, audio: a, audioOffset: 0.5 });
  });

  it('burnSubtitles 透传 srt 与 style', async () => {
    const ff = makeFFmpeg();
    const svc = new PostProcessService(ff, makeWhisper());
    await svc.burnSubtitles(new Blob(['v']), '1\n00:00:00,000 --> 00:00:01,000\n你好', { fontFamily: 'PingFang' });
    expect(ff.burnSubtitles).toHaveBeenCalledWith(
      expect.any(Blob),
      '1\n00:00:00,000 --> 00:00:01,000\n你好',
      { fontFamily: 'PingFang' },
    );
  });

  it('mixBGM 组装音量配置透传给 mixAudio', async () => {
    const ff = makeFFmpeg();
    const svc = new PostProcessService(ff, makeWhisper());
    await svc.mixBGM(new Blob(['v']), new Blob(['b']), 0.3);
    expect(ff.mixAudio).toHaveBeenCalledWith(expect.any(Blob), expect.any(Blob), { voiceVolume: 1, bgmVolume: 0.3 });
  });

  it('applyTransition / concatClips / compress / trim 均委托 ffmpeg', async () => {
    const ff = makeFFmpeg();
    const svc = new PostProcessService(ff, makeWhisper());
    await svc.applyTransition(new Blob(['a']), new Blob(['b']), { type: 'fade', durationSec: 0.5 });
    expect(ff.applyTransition).toHaveBeenCalledWith(expect.any(Blob), expect.any(Blob), { type: 'fade', durationSec: 0.5 }, undefined);
    await svc.concatClips([new Blob(['a']), new Blob(['b'])]);
    expect(ff.concat).toHaveBeenCalled();
    await svc.compress(new Blob(['v']), 28);
    expect(ff.compress).toHaveBeenCalledWith(expect.any(Blob), 28);
    await svc.trim(new Blob(['v']), 1, 3);
    expect(ff.trim).toHaveBeenCalledWith(expect.any(Blob), 1, 3);
  });

  it('底层抛错向上传播（不吞错）', async () => {
    const ff = makeFFmpeg();
    vi.mocked(ff.merge).mockRejectedValueOnce(new Error('ffmpeg down'));
    const svc = new PostProcessService(ff, makeWhisper());
    await expect(svc.mergeVideoAudio(new Blob(['v']), new Blob(['a']))).rejects.toThrow('ffmpeg down');
  });
});
