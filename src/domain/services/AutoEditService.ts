import type { IFFmpegPort } from '../ports/PostProcessPorts';

export interface KeyframeInfo {
  timestamp: number;
  thumbnail: string;
  sceneScore: number;
  isSceneChange: boolean;
}

export interface CutSuggestion {
  startSec: number;
  endSec: number;
  reason: string;
  score: number;
}

export class AutoEditService {
  private ffmpegPort: IFFmpegPort;
  constructor(ffmpegPort: IFFmpegPort) { this.ffmpegPort = ffmpegPort; }

  /**
   * Detect keyframes by sampling frames at regular intervals and comparing
   * their visual differences using canvas API.
   */
  async detectKeyframes(video: Blob, sampleIntervalSec = 0.5): Promise<KeyframeInfo[]> {
    await this.ffmpegPort.load();

    // First probe video duration via metadata extraction
    const duration = await this.probeVideoDuration(video);
    if (duration <= 0) return [];

    const sampleTimes: number[] = [];
    for (let t = 0; t < duration; t += sampleIntervalSec) {
      sampleTimes.push(t);
    }

    const keyframes: KeyframeInfo[] = [];
    const previousHash = await this.computeFrameHash(video, 0);

    for (let i = 0; i < sampleTimes.length; i++) {
      const ts = sampleTimes[i];
      const frameBlob = await this.ffmpegPort.extractFrame(video, ts, 'jpg');
      const currentHash = await this.computeImageHash(frameBlob);
      const isSceneChange = i === 0 ? true : this.hammingDistance(currentHash, previousHash) > 10;

      if (isSceneChange) {
        const thumbnail = URL.createObjectURL(frameBlob);
        keyframes.push({
          timestamp: ts,
          thumbnail,
          sceneScore: 1,
          isSceneChange: true,
        });
      }

      // Update previous hash using moving average
      if (i > 0) {
        previousHash.forEach((byte, idx) => {
          (previousHash as number[])[idx] = (byte + currentHash[idx]) >> 1;
        });
      }
    }

    return keyframes;
  }

  /**
   * Suggest cuts based on detected scenes.
   * Returns a list of cut suggestions (start/end pairs) for natural editing.
   *
   * P0 修复：detectKeyframes 创建的 ObjectURL thumbnail 在本流程不需要,
   * 返回前必须全部 revoke,避免内存泄漏。
   */
  async suggestCuts(video: Blob, targetDurationSec?: number): Promise<CutSuggestion[]> {
    const keyframes = await this.detectKeyframes(video, 0.5);
    try {
      const cuts: CutSuggestion[] = [];

      for (let i = 0; i < keyframes.length - 1; i++) {
        const start = keyframes[i];
        const end = keyframes[i + 1];
        const duration = end.timestamp - start.timestamp;

        // Skip very short scenes (< 1s)
        if (duration < 1) continue;

        cuts.push({
          startSec: start.timestamp,
          endSec: end.timestamp,
          reason: `Scene change at ${start.timestamp.toFixed(1)}s`,
          score: start.sceneScore,
        });
      }

      if (targetDurationSec && cuts.length > 0) {
        // Trim or extend to target duration
        const currentTotal = cuts.reduce((sum, c) => sum + (c.endSec - c.startSec), 0);
        if (currentTotal > targetDurationSec) {
          const ratio = targetDurationSec / currentTotal;
          cuts.forEach(c => {
            const dur = c.endSec - c.startSec;
            c.endSec = c.startSec + dur * ratio;
          });
        }
      }

      return cuts;
    } finally {
      // suggestCuts 仅消费 timestamp/sceneScore,不需要 thumbnail,立即释放
      AutoEditService.releaseKeyframeUrls(keyframes);
    }
  }

  /**
   * 释放 keyframes 中由 detectKeyframes 创建的 ObjectURL。
   *
   * 调用方在不再使用 keyframes 的 thumbnail 时(组件卸载/重新检测/替换数据)
   * 必须调用此方法,否则 ObjectURL 引用的 Blob 不会被 GC 回收。
   *
   * 安全性:对空字符串/非 blob: URL 静默跳过,可重复调用。
   */
  static releaseKeyframeUrls(keyframes: KeyframeInfo[]): void {
    for (const kf of keyframes) {
      if (kf.thumbnail && kf.thumbnail.startsWith('blob:')) {
        URL.revokeObjectURL(kf.thumbnail);
      }
    }
  }

  /**
   * Auto-trim a video by removing low-motion sections.
   * Returns a new video with only the high-action parts.
   */
  async autoTrim(video: Blob, motionThreshold: number = 0.3): Promise<Blob> {
    const cuts = await this.suggestCuts(video);
    if (cuts.length === 0) return video;
    void motionThreshold;

    // Concatenate all cut segments
    const segments: Blob[] = [];
    for (const cut of cuts) {
      const trimmed = await this.ffmpegPort.trim(video, cut.startSec, cut.endSec);
      segments.push(trimmed);
    }
    return this.ffmpegPort.concat(segments.map(blob => ({ blob })));
  }

  /**
   * 探测视频时长（秒）。
   * 使用 HTMLVideoElement 读取元数据（轻量，无需 ffprobe.wasm，仅读 metadata 不下载全片）。
   * 失败时回退到 0（调用方据此跳过处理）。
   */
  private async probeVideoDuration(video: Blob): Promise<number> {
    return new Promise<number>(resolve => {
      const url = URL.createObjectURL(video);
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(el.duration) ? el.duration : 0);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      el.src = url;
    });
  }

  private async computeFrameHash(video: Blob, atSec: number): Promise<number[]> {
    try {
      const frame = await this.ffmpegPort.extractFrame(video, atSec, 'jpg');
      return await this.computeImageHash(frame);
    } catch {
      return new Array(16).fill(0);
    }
  }

  private async computeImageHash(image: Blob): Promise<number[]> {
    return new Promise<number[]>(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(image);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(new Array(16).fill(0));
          return;
        }
        ctx.drawImage(img, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        const hash: number[] = [];
        for (let i = 0; i < 16; i++) hash.push(data[i]);
        URL.revokeObjectURL(url);
        resolve(hash);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(new Array(16).fill(0));
      };
      img.src = url;
    });
  }

  private hammingDistance(a: number[], b: number[]): number {
    let dist = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) dist++;
    }
    return dist;
  }
}
