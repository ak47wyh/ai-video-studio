import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { IFFmpegPort, MergeContext, VideoClip, SubtitleStyle, BgmMixConfig, TransitionType, OutputFormat, CropOptions } from '../../../domain/ports/PostProcessPorts';

const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

/**
 * FFmpeg WASM 适配器
 *
 * Phase 4 性能优化：
 * - FFmpeg 模块改为 dynamic import，第一次真正调用 load() 时才下载
 *   `@ffmpeg/ffmpeg` 的 JS 体积（约 30KB），避免初始 bundle 体积过大
 * - FFmpeg 核心（WASM）本身从 unpkg CDN 懒加载，保持原有行为
 *
 * 收益：
 * - 用户不进入"后期合成"流程时，不下载 FFmpeg JS
 * - 首屏 vendor-ffmpeg chunk 从 ~4.5KB 维持现状（FFmpegAdapter 占大头在依赖图）
 *   但实际生效依赖被压到 postProcessService 调用方，按需触发
 */
export class FFmpegAdapter implements IFFmpegPort {
  private ffmpeg: FFmpeg | null = null;
  private loadPromise: Promise<void> | null = null;
  private fetchFileFn: typeof import('@ffmpeg/util').fetchFile | null = null;

  // V2 P0-4.2.1：空闲超时释放。WASM 实例 ~100MB，长时间不用应主动释放。
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

  isLoaded(): boolean {
    return this.ffmpeg !== null && this.ffmpeg.loaded;
  }

  async load(): Promise<void> {
    if (this.isLoaded()) {
      this.touch();
      return;
    }
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    try {
      await this.loadPromise;
      this.touch();
    } catch (e) {
      // load 失败时清空 loadPromise，允许重试
      this.loadPromise = null;
      throw e;
    }
  }

  private async doLoad(): Promise<void> {
    // 关键：动态 import 让 Vite/Rollup 把 @ffmpeg/ffmpeg 拆成独立 chunk
    // 第一次调用前不会下载该模块的 JS 代码
    const [{ FFmpeg: FFmpegCtor }, util] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    this.fetchFileFn = util.fetchFile;

    const ffmpeg = new FFmpegCtor();
    await ffmpeg.load({
      coreURL: await util.toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await util.toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    this.ffmpeg = ffmpeg;
  }

  /**
   * V2 P0-4.2.1：显式卸载 FFmpeg WASM 实例，释放 ~100MB 内存。
   *
   * 触发场景：
   *   - 空闲超过 IDLE_TIMEOUT_MS 后自动触发
   *   - dependencies.ts 暴露 unloadFfmpeg() 供路由切换手动触发
   *   - 应用 beforeunload 时兜底调用
   *
   * 幂等：未加载时直接返回。dispose 别名保持一致的 IDisposable 语义。
   */
  async unload(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.ffmpeg) {
      try {
        this.ffmpeg.terminate();
      } catch {
        // terminate 失败也要清空引用，让 GC 可以回收
      }
      this.ffmpeg = null;
    }
    this.loadPromise = null;
    this.fetchFileFn = null;
  }

  /** IDisposable 兼容别名 */
  async dispose(): Promise<void> {
    return this.unload();
  }

  /**
   * 记录一次使用，重置空闲计时器。所有对外方法（merge/encodeFromFrames/...）
   * 会在 load() 后调用 touch()，保证 5 分钟内被访问就不会被空闲释放。
   */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.unload();
    }, FFmpegAdapter.IDLE_TIMEOUT_MS);
  }

  private ensureLoaded(): FFmpeg {
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded. Call load() first.');
    return this.ffmpeg;
  }

  private async writeFile(name: string, data: Blob | string): Promise<void> {
    const ffmpeg = this.ensureLoaded();
    const buffer = await this.fetchFileFn!(data);
    await ffmpeg.writeFile(name, buffer);
  }

  private async readFile(name: string): Promise<Blob> {
    const ffmpeg = this.ensureLoaded();
    const data = await ffmpeg.readFile(name);
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  }

  private async safeDelete(name: string): Promise<void> {
    try {
      await this.ensureLoaded().deleteFile(name);
    } catch {
      // ignore
    }
  }

  async merge(ctx: MergeContext): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const videoName = 'in.mp4';
    const audioName = 'in.mp3';
    const outName = 'out.mp4';
    try {
      await this.writeFile(videoName, ctx.video);
      await this.writeFile(audioName, ctx.audio);
      const args = [
        '-i', videoName,
        '-i', audioName,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
      ];
      if (ctx.audioOffset && ctx.audioOffset > 0) {
        args.push('-itsoffset', String(ctx.audioOffset / 1000));
      }
      args.push(outName);
      await ffmpeg.exec(args);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(videoName);
      await this.safeDelete(audioName);
      await this.safeDelete(outName);
    }
  }

  async concat(clips: VideoClip[]): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputNames: string[] = [];
    try {
      for (let i = 0; i < clips.length; i++) {
        const name = `clip${i}.mp4`;
        await this.writeFile(name, clips[i].blob);
        inputNames.push(name);
      }
      const listContent = inputNames.map(n => `file '${n}'`).join('\n');
      await this.writeFile('list.txt', new Blob([listContent], { type: 'text/plain' }));
      const outName = 'out.mp4';
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'list.txt',
        '-c', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      for (const n of inputNames) await this.safeDelete(n);
      await this.safeDelete('list.txt');
      await this.safeDelete('out.mp4');
    }
  }

  async burnSubtitles(video: Blob, srt: string, style?: SubtitleStyle): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const videoName = 'in.mp4';
    const srtName = 'subs.srt';
    const outName = 'out.mp4';
    try {
      await this.writeFile(videoName, video);
      await this.writeFile(srtName, new Blob([srt], { type: 'text/plain' }));

      const fontName = style?.fontName ?? 'PingFang SC';
      const fontSize = style?.fontSize ?? 24;
      const primaryColor = style?.primaryColor ?? '&HFFFFFF';
      const outlineColor = style?.outlineColor ?? '&H000000';
      const outlineWidth = style?.outlineWidth ?? 2;
      const position = style?.position ?? 'bottom';
      const alignment = position === 'top' ? 6 : position === 'middle' ? 10 : 2;

      const forceStyle = `FontName=${fontName},FontSize=${fontSize},PrimaryColour=${primaryColor},OutlineColour=${outlineColor},Outline=${outlineWidth},Alignment=${alignment}`;

      await ffmpeg.exec([
        '-i', videoName,
        '-vf', `subtitles=${srtName}:force_style='${forceStyle}'`,
        '-c:a', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(videoName);
      await this.safeDelete(srtName);
      await this.safeDelete(outName);
    }
  }

  async mixAudio(voice: Blob, bgm: Blob, config: BgmMixConfig): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const voiceName = 'voice.mp3';
    const bgmName = 'bgm.mp3';
    const outName = 'out.mp3';
    try {
      await this.writeFile(voiceName, voice);
      await this.writeFile(bgmName, bgm);
      const filter = `[0:a]volume=${config.voiceVolume}[v];[1:a]volume=${config.bgmVolume}[b];[v][b]amix=inputs=2:duration=first:dropout_transition=2[m]`;
      await ffmpeg.exec([
        '-i', voiceName,
        '-i', bgmName,
        '-filter_complex', filter,
        '-map', '[m]',
        '-ac', '2',
        '-ar', '44100',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(voiceName);
      await this.safeDelete(bgmName);
      await this.safeDelete(outName);
    }
  }

  async applyTransition(clip1: Blob, clip2: Blob, transition: TransitionType, duration: number, offsetSec?: number): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const clip1Name = 'c1.mp4';
    const clip2Name = 'c2.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(clip1Name, clip1);
      await this.writeFile(clip2Name, clip2);
      // 转场起始 offset：调用方按 clip1 实际时长计算后传入，
      // 未传时回退到 3 秒（保留旧行为兼容，但推荐显式传入 offsetSec = clip1Duration - duration）
      const offset = offsetSec ?? 3;
      await ffmpeg.exec([
        '-i', clip1Name,
        '-i', clip2Name,
        '-filter_complex', `[0][1]xfade=transition=${transition}:duration=${duration}:offset=${offset}`,
        '-c:v', 'libx264',
        '-crf', '23',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(clip1Name);
      await this.safeDelete(clip2Name);
      await this.safeDelete(outName);
    }
  }

  async compress(video: Blob, crf = 23): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const videoName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(videoName, video);
      await ffmpeg.exec([
        '-i', videoName,
        '-c:v', 'libx264',
        '-crf', String(crf),
        '-preset', 'fast',
        '-c:a', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(videoName);
      await this.safeDelete(outName);
    }
  }

  async convertFormat(input: Blob, format: OutputFormat): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = `out.${format}`;
    try {
      await this.writeFile(inputName, input);
      const codecMap: Record<OutputFormat, string> = { mp4: 'libx264', webm: 'libvpx', mov: 'libx264' };
      await ffmpeg.exec([
        '-i', inputName,
        '-c:v', codecMap[format],
        '-c:a', 'aac',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async changeSpeed(video: Blob, speed: number): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      const atempoFilter = this.buildAtempoFilter(speed);
      await ffmpeg.exec([
        '-i', inputName,
        '-filter:a', atempoFilter,
        '-filter:v', `setpts=${(1 / speed).toFixed(4)}*PTS`,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async trim(video: Blob, startSec: number, endSec: number): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      const duration = endSec - startSec;
      await ffmpeg.exec([
        '-i', inputName,
        '-ss', String(startSec),
        '-t', String(duration),
        '-c', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async crop(video: Blob, opts: CropOptions): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `crop=${opts.width}:${opts.height}:${opts.x}:${opts.y}`,
        '-c:a', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async resize(video: Blob, width: number, height: number): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `scale=${width}:${height}`,
        '-c:a', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async extractFrame(video: Blob, atSec: number, format: 'png' | 'jpg' = 'jpg'): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = `frame.${format}`;
    try {
      await this.writeFile(inputName, video);
      await ffmpeg.exec([
        '-i', inputName,
        '-ss', String(atSec),
        '-vframes', '1',
        '-q:v', '2',
        outName
      ]);
      const data = await ffmpeg.readFile(outName);
      return new Blob([new Uint8Array(data as Uint8Array)], { type: `image/${format}` });
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async reverse(video: Blob): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', 'reverse',
        '-af', 'areverse',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async fadeInOut(video: Blob, fadeInSec: number, fadeOutSec: number): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `fade=t=in:st=0:d=${fadeInSec},fade=t=out:st=0:d=${fadeOutSec}`,
        '-c:a', 'copy',
        outName
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async applyDelogo(video: Blob, regions: { x: number; y: number; width: number; height: number }[]): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const inputName = 'in.mp4';
    const outName = 'out.mp4';
    try {
      await this.writeFile(inputName, video);
      // 多个 delogo 滤镜用逗号串联
      const filter = regions
        .map(r => `delogo=x=${Math.floor(r.x)}:y=${Math.floor(r.y)}:w=${Math.floor(r.width)}:h=${Math.floor(r.height)}:show=0`)
        .join(',');
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', filter,
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'fast',
        '-c:a', 'copy',
        outName,
      ]);
      return await this.readFile(outName);
    } finally {
      await this.safeDelete(inputName);
      await this.safeDelete(outName);
    }
  }

  async encodeFromFrames(frames: Blob[], fps: number, audio?: Blob): Promise<Blob> {
    await this.load();
    const ffmpeg = this.ensureLoaded();
    const frameNames: string[] = [];
    const audioName = 'audio.mp3';
    const outName = 'out.mp4';
    try {
      // 写入帧序列 frame000.png ...
      const padLen = String(frames.length).length;
      for (let i = 0; i < frames.length; i++) {
        const name = `frame${String(i).padStart(padLen, '0')}.png`;
        await this.writeFile(name, frames[i]);
        frameNames.push(name);
      }

      const args: string[] = [
        '-framerate', String(fps),
        '-i', `frame%0${padLen}d.png`,
      ];

      if (audio) {
        await this.writeFile(audioName, audio);
        args.push('-i', audioName);
        args.push(
          '-c:v', 'libx264',
          '-crf', '23',
          '-preset', 'fast',
          '-c:a', 'aac',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
        );
      } else {
        args.push(
          '-c:v', 'libx264',
          '-crf', '23',
          '-preset', 'fast',
        );
      }
      args.push(outName);
      await ffmpeg.exec(args);
      return await this.readFile(outName);
    } finally {
      for (const n of frameNames) await this.safeDelete(n);
      await this.safeDelete(audioName);
      await this.safeDelete(outName);
    }
  }

  private buildAtempoFilter(speed: number): string {
    const filters: string[] = [];
    let remaining = speed;
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining *= 2.0;
    }
    filters.push(`atempo=${remaining.toFixed(4)}`);
    return filters.join(',');
  }
}
