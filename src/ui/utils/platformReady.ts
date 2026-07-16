import type { ApiConfig, PlatformId } from '../../domain/entities/platform';

/**
 * 检查指定平台的 API Key 是否已配置。
 * 用于 UI 层在用户操作前验证平台可用性。
 */
export function isPlatformReady(config: ApiConfig, platform: PlatformId): boolean {
  switch (platform) {
    case 'minimax':
      return !!config.minimaxApiKey.trim();
    case 'volcengine':
      return !!config.volcArkOpenAiApiKey.trim();
    case 'kling':
      return !!config.klingAccessKey.trim() && !!config.klingSecretKey.trim();
    case 'wan':
      return !!config.wanApiKey.trim();
    case 'hunyuan':
      return !!config.hunyuanSecretId.trim() && !!config.hunyuanSecretKey.trim();
    case 'zhipu':
      return !!config.zhipuApiKey.trim();
    case 'vidu':
      return !!config.viduApiKey.trim();
    default:
      return false;
  }
}

/**
 * 获取平台未配置时的提示信息。
 */
export function getPlatformMissingMessage(platform: PlatformId): string {
  switch (platform) {
    case 'minimax':
      return '请先在设置中配置 MiniMax 的 API Key';
    case 'volcengine':
      return '请先在设置中配置火山引擎的 API Key';
    case 'kling':
      return '请先在设置中配置可灵 Kling 的 AccessKey 和 SecretKey';
    case 'wan':
      return '请先在设置中配置通义万相的 API Key';
    case 'hunyuan':
      return '请先在设置中配置腾讯混元的 SecretId 和 SecretKey';
    case 'zhipu':
      return '请先在设置中配置智谱 AI 的 API Key';
    case 'vidu':
      return '请先在设置中配置 Vidu 生数科技的 API Key';
    default:
      return '请先在设置中配置该平台的 API Key';
  }
}
