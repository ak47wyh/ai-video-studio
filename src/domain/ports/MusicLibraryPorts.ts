/**
 * MusicLibraryPorts —— 音乐库浏览端口（M-2 一期）
 *
 * 面向"从外部音乐库搜索/试听/导入 BGM"能力。
 * 一期实现：Free Music Archive 适配器（官方 API 已停服时如实降级提示，
 * 端口可替换为 Jamendo 等可用源）。
 */

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  genre: string;
  /** 版权许可：CC-BY / CC0 等，UI 必须显式展示 */
  license: string;
}

export interface MusicSearchOptions {
  keyword?: string;
  genre?: string;
  durationSec?: number;
}

export interface IMusicLibraryPort {
  search(opts: MusicSearchOptions): Promise<MusicTrack[]>;
  getPreviewUrl(trackId: string): Promise<string>;
  getDownloadUrl(trackId: string): Promise<string>;
}

/** 领域错误：音乐库服务不可用（外部 API 停服/网络失败时统一归一化） */
export class MusicLibraryUnavailableError extends Error {
  constructor(message = 'Music library service unavailable') {
    super(message);
    this.name = 'MusicLibraryUnavailableError';
  }
}

export function isMusicLibraryUnavailable(e: unknown): boolean {
  return e instanceof MusicLibraryUnavailableError;
}
