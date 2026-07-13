import type { ApiConfig } from '../../config/ApiConfigStore';
import { BaseHttpClient } from '../_base/BaseHttpClient';
import { parseViduError } from './ViduErrorUtils';

/**
 * Vidu HTTP 客户端。
 *
 * 鉴权：HTTP Header `Authorization: Token <API-Key>`
 * Base URL：https://api.vidu.cn
 *
 * Phase 4 DRY：继承 BaseHttpClient，仅声明鉴权头与错误解析器。
 */
export class ViduHttpClient extends BaseHttpClient {
  constructor(config: ApiConfig) {
    super({
      baseUrl: config.viduBaseUrl,
      headers: { 'Authorization': `Token ${config.viduApiKey}` },
      parseError: parseViduError,
    });
  }
}
