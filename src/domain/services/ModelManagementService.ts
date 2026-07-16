import type { IModelManagementPort, ModelInfo } from '../ports/OutboundPorts';
import type { IModelCachePort, CachedModels } from '../ports/ModelCachePort';
import type { ILoggerPort, LogContext } from '../ports/CrossCuttingPorts';
import { getImageModels } from './platformCapabilities';

export class ModelManagementService {
  private modelPort: IModelManagementPort;
  private cache: IModelCachePort<ModelInfo>;
  private logger: ILoggerPort;

  constructor(modelPort: IModelManagementPort, cache: IModelCachePort<ModelInfo>, logger: ILoggerPort) {
    this.modelPort = modelPort;
    this.cache = cache;
    this.logger = logger;
  }

  /** 统一上下文工厂：附加 service 字段 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'ModelManagementService', ...extra };
  }

  /**
   * Fetch all models from API (handles pagination).
   *
   * P0 修复：增加 MAX_PAGES 兜底,防止恶意/异常 API 持续返回 hasMore=true 时死循环。
   * 单页 100 条 × 50 页 = 5000 条模型已远超实际业务需求。
   */
  async fetchModels(): Promise<ModelInfo[]> {
    const MAX_PAGES = 50;
    const allModels: ModelInfo[] = [];
    let afterId: string | undefined;
    let pageCount = 0;

    do {
      const result = await this.modelPort.listModels(100, afterId);
      this.logger.debug('listModels page fetched', this.ctx({ page: pageCount, pageSize: result.models.length, hasMore: result.hasMore }));
      allModels.push(...result.models);
      afterId = result.hasMore ? result.lastId : undefined;
      pageCount++;
      if (pageCount >= MAX_PAGES && afterId) {
        // 达到兜底阈值仍有更多页,停止分页避免死循环
        this.logger.warn(`fetchModels hit MAX_PAGES=${MAX_PAGES}, stopping pagination`, this.ctx({ collectedModels: allModels.length }));
        afterId = undefined;
      }
    } while (afterId);

    // Cache the result
    const cached: CachedModels<ModelInfo> = { models: allModels, cachedAt: Date.now() };
    await this.cache.write(cached);

    this.logger.info('fetchModels done', this.ctx({ totalModels: allModels.length, pages: pageCount }));
    return allModels;
  }

  /**
   * Get models from cache if valid, otherwise fetch from API.
   */
  async getModels(): Promise<ModelInfo[]> {
    this.logger.debug('getModels called', this.ctx({}));
    const cached = await this.getCachedModelsInternal();
    if (cached) {
      this.logger.debug('getModels cache hit', this.ctx({ modelCount: cached.models.length }));
      return cached.models;
    }
    this.logger.debug('getModels cache miss, fetching', this.ctx({}));
    return this.fetchModels();
  }

  /**
   * Force refresh models from API.
   */
  async refreshModels(): Promise<ModelInfo[]> {
    this.logger.info('refreshModels called', this.ctx({}));
    return this.fetchModels();
  }

  /**
   * Get cached models info (models + cachedAt timestamp).
   */
  async getCachedModels(): Promise<CachedModels<ModelInfo> | null> {
    this.logger.debug('getCachedModels called', this.ctx({}));
    return this.getCachedModelsInternal();
  }

  /**
   * Check if a specific model is available.
   */
  async isModelAvailable(modelId: string): Promise<boolean> {
    this.logger.debug('isModelAvailable called', this.ctx({ modelId }));
    const models = await this.getModels();
    const available = models.some(m => m.id === modelId);
    this.logger.debug('isModelAvailable done', this.ctx({ modelId, available }));
    return available;
  }

  /**
   * Get text generation models (from API).
   */
  async getTextModels(): Promise<ModelInfo[]> {
    this.logger.debug('getTextModels called', this.ctx({}));
    const models = await this.getModels();
    const textModels = models.filter(m => m.type === 'text' || m.id.startsWith('MiniMax-'));
    this.logger.debug('getTextModels done', this.ctx({ textModelCount: textModels.length }));
    return textModels;
  }

  /**
   * Static video models (API does not provide these).
   */
  getStaticVideoModels(): ModelInfo[] {
    return [
      { id: 'MiniMax-Hailuo-2.3', createdAt: '', displayName: 'Hailuo 2.3', type: 'video' },
      { id: 'MiniMax-Hailuo-02', createdAt: '', displayName: 'Hailuo 02', type: 'video' },
      { id: 'T2V-01-Director', createdAt: '', displayName: 'T2V-01 Director', type: 'video' },
      { id: 'T2V-01', createdAt: '', displayName: 'T2V-01', type: 'video' },
      { id: 'S2V-01', createdAt: '', displayName: 'S2V-01', type: 'video' },
    ];
  }

  /**
   * Static image models — 从平台能力注册表读取真实模型 ID。
   * 聚合所有平台的 imageModels,供 UI 层模型管理面板展示。
   */
  getStaticImageModels(): ModelInfo[] {
    return getImageModels('minimax').map(m => ({
      id: m.id,
      createdAt: '',
      displayName: m.label,
      type: 'image' as const,
    }));
  }

  /**
   * Static music models (API does not provide these).
   */
  getStaticMusicModels(): ModelInfo[] {
    return [
      { id: 'music-2.6', createdAt: '', displayName: 'Music 2.6', type: 'music' },
      { id: 'music-2.6-free', createdAt: '', displayName: 'Music 2.6 Free', type: 'music' },
      { id: 'music-cover', createdAt: '', displayName: 'Music Cover', type: 'music' },
      { id: 'music-cover-free', createdAt: '', displayName: 'Music Cover Free', type: 'music' },
    ];
  }

  private async getCachedModelsInternal(): Promise<CachedModels<ModelInfo> | null> {
    return this.cache.read();
  }
}
