import type { IFFmpegPort, IWhisperPort, SubtitleStyle, BgmMixConfig, TransitionType, OutputFormat, CropOptions } from '../ports/PostProcessPorts';

export class PostProcessService {
  private ffmpegPort: IFFmpegPort;
  private whisperPort: IWhisperPort;

  constructor(ffmpegPort: IFFmpegPort, whisperPort: IWhisperPort) {
    this.ffmpegPort = ffmpegPort;
    this.whisperPort = whisperPort;
  }

  async ensureLoaded(): Promise<void> {
    await this.ffmpegPort.load();
    await this.whisperPort.load();
  }

  isFFmpegLoaded(): boolean {
    return this.ffmpegPort.isLoaded();
  }

  isWhisperLoaded(): boolean {
    return this.whisperPort.isLoaded();
  }

  async mergeVideoAudio(video: Blob, audio: Blob, audioOffset?: number): Promise<Blob> {
    return this.ffmpegPort.merge({ video, audio, audioOffset });
  }

  async burnSubtitles(video: Blob, srt: string, style?: SubtitleStyle): Promise<Blob> {
    return this.ffmpegPort.burnSubtitles(video, srt, style);
  }

  async mixBGM(voice: Blob, bgm: Blob, bgmVolume = 0.3): Promise<Blob> {
    const config: BgmMixConfig = { voiceVolume: 1, bgmVolume };
    return this.ffmpegPort.mixAudio(voice, bgm, config);
  }

  async applyTransition(clip1: Blob, clip2: Blob, transition: TransitionType, duration = 0.5, offsetSec?: number): Promise<Blob> {
    return this.ffmpegPort.applyTransition(clip1, clip2, transition, duration, offsetSec);
  }

  async concatClips(clips: Blob[]): Promise<Blob> {
    return this.ffmpegPort.concat(clips.map(blob => ({ blob })));
  }

  async compress(video: Blob, crf = 23): Promise<Blob> {
    return this.ffmpegPort.compress(video, crf);
  }

  async convertFormat(video: Blob, format: OutputFormat): Promise<Blob> {
    return this.ffmpegPort.convertFormat(video, format);
  }

  async changeSpeed(video: Blob, speed: number): Promise<Blob> {
    return this.ffmpegPort.changeSpeed(video, speed);
  }

  async trim(video: Blob, startSec: number, endSec: number): Promise<Blob> {
    return this.ffmpegPort.trim(video, startSec, endSec);
  }

  async crop(video: Blob, opts: CropOptions): Promise<Blob> {
    return this.ffmpegPort.crop(video, opts);
  }

  async resize(video: Blob, width: number, height: number): Promise<Blob> {
    return this.ffmpegPort.resize(video, width, height);
  }

  async extractFrame(video: Blob, atSec: number, format: 'png' | 'jpg' = 'jpg'): Promise<Blob> {
    return this.ffmpegPort.extractFrame(video, atSec, format);
  }

  async transcribe(audio: Blob | string, language = 'zh') {
    return this.whisperPort.transcribe(audio, language);
  }
}
