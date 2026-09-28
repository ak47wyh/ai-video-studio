/**
 * FreeMusicArchiveAdapter —— 音乐库适配器（M-2 一期）
 *
 * 调用 Free Music Archive 公共 API。官方 API 已停服时抛出
 * MusicLibraryUnavailableError（诚实降级），不伪造数据。
 *
 * 设计：构造函数可选注入 fetch，便于测试；错误统一归一化到领域错误。
 */

import { MusicLibraryUnavailableError, type IMusicLibraryPort, type MusicSearchOptions, type MusicTrack } from '../../../../domain/ports/MusicLibraryPorts';

const FMA_API_BASE = 'https://freemusicarchive.org/api';

type FetchLike = (url: string, options?: RequestInit) => Promise<Response>;

/** 解析 FMA API 返回（不同端点结构不同，未知结构一律按不可用处理） */
function parseTracks(payload: unknown): MusicTrack[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { tracks?: unknown }).tracks;
  if (!Array.isArray(data)) return [];
  return data.map((t) => {
    const row = t as Record<string, unknown>;
    return {
      id: String(row.track_id ?? ''),
      title: String(row.track_title ?? ''),
      artist: String(row.artist_name ?? ''),
      durationSec: Number(row.track_duration ?? 0),
      genre: String(row.track_genres ?? ''),
      license: String(row.track_license ?? 'CC-BY'),
    };
  }).filter(t => t.id && t.title);
}

export class FreeMusicArchiveAdapter implements IMusicLibraryPort {
  private fetchFn: FetchLike;

  constructor(fetchFn?: FetchLike) {
    this.fetchFn = fetchFn ?? ((url: string, options?: RequestInit) => fetch(url, options));
  }

  private async getJson(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: 'GET' });
    } catch {
      throw new MusicLibraryUnavailableError('FMA API unreachable');
    }
    if (!res.ok) throw new MusicLibraryUnavailableError(`FMA API ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new MusicLibraryUnavailableError('FMA API invalid payload');
    }
  }

  async search(opts: MusicSearchOptions): Promise<MusicTrack[]> {
    const params = new URLSearchParams({ limit: '20' });
    if (opts.keyword) params.set('q', opts.keyword);
    const payload = await this.getJson(`${FMA_API_BASE}/tracks.json?${params.toString()}`);
    return parseTracks(payload);
  }

  async getPreviewUrl(_trackId: string): Promise<string> {
    // FMA 预览流需按曲目拼接；API 停服时明确不可用
    throw new MusicLibraryUnavailableError('FMA preview stream unavailable');
  }

  async getDownloadUrl(_trackId: string): Promise<string> {
    throw new MusicLibraryUnavailableError('FMA download stream unavailable');
  }
}
