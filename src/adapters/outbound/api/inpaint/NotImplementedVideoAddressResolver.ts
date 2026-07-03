import type {
  IVideoAddressResolverPort,
  ResolvedVideoSource,
} from '../../../../domain/ports/WatermarkRemovalPorts';
import type { ILoggerPort } from '../../../../domain/ports/CrossCuttingPorts';

/**
 * 视频地址解析 - 占位实现
 *
 * 平台分享链接（抖音 / B站等）解析需要后端服务支持（涉及跨域请求与服务端解析）。
 * 当前 ai-video-studio 为纯前端项目，此实现直接抛错。
 *
 * 未来接入后端时，仅需在 dependencies.ts 中替换为真实实现即可。
 */
export class NotImplementedVideoAddressResolver implements IVideoAddressResolverPort {
  private _logger: ILoggerPort;

  constructor(logger: ILoggerPort) {
    this._logger = logger.child({ adapter: 'NotImplementedVideoAddressResolver' });
  }

  async resolve(shareUrl: string): Promise<ResolvedVideoSource> {
    // 入参日志
    this._logger.info('resolve 入参', { shareUrl });

    const error = new Error(
      '平台分享链接解析需后端服务支持，当前未实现。请使用直链地址或上传视频文件。',
    );
    this._logger.warn('resolve 未实现', { shareUrl });
    throw error;
  }
}
