import type { IVideoAddressResolverPort, ResolvedVideoSource } from '../../../../domain/ports/WatermarkRemovalPorts';
import type { ILoggerPort } from '../../../../domain/ports/CrossCuttingPorts';

/**
 * 视频地址解析器 — 纯前端实现（无后端支持）
 *
 * 支持：
 * - 直链视频（.mp4/.webm/.mov 结尾）：直接返回，无需解析
 * - 抖音完整链接（www.douyin.com/video/xxx）：调用抖音公开 API 解析真实视频地址
 *
 * 限制：
 * - 抖音短链接（v.douyin.com/xxx）：纯前端无法解析，需用户提供完整链接
 * - B站/小红书/YouTube：纯前端受 CORS 限制，暂不支持
 *
 * 错误处理：
 * - CORS 错误：提示用户手动下载后上传
 * - API 变更：提示用户链接失效或格式错误
 */
export class DouyinVideoAddressResolver implements IVideoAddressResolverPort {
  private _logger: ILoggerPort;

  constructor(logger: ILoggerPort) {
    this._logger = logger.child({ adapter: 'DouyinVideoAddressResolver' });
  }

  async resolve(shareUrl: string): Promise<ResolvedVideoSource> {
    this._logger.info('resolve 入参', { shareUrl });

    const trimmed = shareUrl.trim();
    if (!trimmed) {
      throw new Error('请输入视频链接');
    }

    // 直链：直接返回
    if (this.isDirectVideoUrl(trimmed)) {
      this._logger.info('resolve 直链识别', { shareUrl: trimmed, type: 'direct' });
      return {
        directUrl: trimmed,
        sourcePlatform: 'direct',
      };
    }

    // 抖音分享链接
    if (this.isDouyinShareUrl(trimmed)) {
      return this.resolveDouyin(trimmed);
    }

    // 暂不支持的平台
    throw new Error('暂不支持该平台，支持：直链 / 抖音视频链接');
  }

  /** 判断是否为直链视频 */
  private isDirectVideoUrl(url: string): boolean {
    return /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url);
  }

  /** 判断是否为抖音分享链接 */
  private isDouyinShareUrl(url: string): boolean {
    return /v\.douyin\.com|www\.douyin\.com\/video\//i.test(url);
  }

  /** 解析抖音分享链接 */
  private async resolveDouyin(shareUrl: string): Promise<ResolvedVideoSource> {
    try {
      // 方式1：直接 fetch，看是否能拿到重定向后的 URL（用于短链接）
      let videoPageUrl = shareUrl;
      try {
        const res = await fetch(shareUrl, {
          mode: 'no-cors',
          redirect: 'follow',
        });
        // no-cors 下无法读取最终 URL，仅拿到 opaque response
        // 用 response.url 取重定向后的地址（如果支持）
        if (res.url && res.url !== shareUrl) {
          videoPageUrl = res.url;
        }
      } catch {
        // fetch 失败不影响继续解析
      }

      // 方式2：尝试调用抖音 web API 获取视频详情
      // 从 URL 中提取视频 ID
      const videoId = this.extractDouyinVideoId(videoPageUrl);
      if (videoId) {
        const detail = await this.fetchDouyinDetail(videoId);
        if (detail) {
          this._logger.info('resolve 抖音解析成功', { shareUrl, videoId, title: detail.title });
          return {
            directUrl: detail.videoUrl,
            title: detail.title,
            thumbnailUrl: detail.thumbnailUrl,
            sourcePlatform: 'douyin',
          };
        }
      }

      throw new Error('无法解析抖音视频地址');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '抖音视频解析失败';
      this._logger.warn('resolve 抖音解析失败', { shareUrl, error: msg });
      throw new Error(msg, { cause: e });
    }
  }

  /** 从 URL 中提取抖音视频 ID */
  private extractDouyinVideoId(url: string): string | null {
    // https://www.douyin.com/video/7237462083878603008
    const fullMatch = url.match(/douyin\.com\/video\/(\d+)/);
    if (fullMatch) return fullMatch[1];

    // https://v.douyin.com/xxx 短链接 —— 需要先解析出真实地址
    // 短链接无法纯前端解析，返回 null
    const shortMatch = url.match(/v\.douyin\.com/);
    if (shortMatch) {
      // 短链接无法解析，抛特定错误让 UI 给用户提示
      throw new Error('抖音短链接解析失败，请使用完整视频链接（www.douyin.com/video/xxx）');
    }

    return null;
  }

  /** 判断是否为 CORS 错误 */
  private isCorsError(e: unknown): boolean {
    return e instanceof Error && e.message.includes('CORS') || 
           e instanceof Error && e.message.includes('cors') ||
           e instanceof Error && e.message.includes('跨域');
  }

  /** 调用抖音 web API 获取视频详情 */
  private async fetchDouyinDetail(videoId: string): Promise<{
    videoUrl: string;
    title?: string;
    thumbnailUrl?: string;
  } | null> {
    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&channel=channel_pc_web`;

    try {
      const response = await fetch(apiUrl, {
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.douyin.com/',
        },
      });

      if (!response.ok) {
        this._logger.warn('fetchDouyinDetail HTTP 失败', { videoId, status: response.status });
        return null;
      }

      const data = await response.json() as Record<string, unknown>;

      const awemeDetail = data['aweme_detail'] as Record<string, unknown> | undefined;
      const awemeDetailList = data['aweme_detail_list'] as Record<string, unknown>[] | undefined;
      const aweme = awemeDetail || awemeDetailList?.[0];
      if (!aweme) {
        this._logger.warn('fetchDouyinDetail 无 aweme_detail', { videoId, dataKeys: Object.keys(data) });
        return null;
      }

      const videoInfo = aweme['video'] as Record<string, unknown> | undefined;
      const awemeVideos = aweme['aweme_videos'] as Record<string, unknown>[] | undefined;
      const resolvedVideoInfo = videoInfo || awemeVideos?.[0];
      if (!resolvedVideoInfo) return null;

      const playAddr = (resolvedVideoInfo['play_addr'] || resolvedVideoInfo['download_addr']) as Record<string, unknown> | undefined;
      const urlList = (playAddr?.['url_list'] || resolvedVideoInfo['url_list']) as string[] | undefined;
      const videoUrl = urlList?.[0];

      if (!videoUrl) return null;

      const cover = (resolvedVideoInfo['cover'] || aweme['video_cover'] || {}) as Record<string, unknown>;
      const thumbnailUrl = (cover['url_list'] as string[] | undefined)?.[0]
        || (aweme['video_thumbnail_urls'] as string[] | undefined)?.[0];

      const title = (aweme['desc'] as string) || (aweme['title'] as string) || '';

      return { videoUrl, title, thumbnailUrl };
    } catch (e) {
      this._logger.warn('fetchDouyinDetail 异常', { videoId, error: e instanceof Error ? e.message : String(e) });
      if (this.isCorsError(e)) {
        throw new Error('抖音接口跨域限制，请先将视频下载到本地后通过本地上传导入', { cause: e });
      }
      return null;
    }
  }
}