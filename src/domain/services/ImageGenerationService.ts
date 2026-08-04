import type { IImageGeneratorPort, ImageGenerationContext, ImageAspectRatio } from '../ports/OutboundPorts';
import type { ICharacterRepository, IBackgroundRepository } from '../ports/OutboundPorts';
import type { IFileStoragePort } from '../ports/FileStoragePorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort, LogContext, ICostMeter, IHttpFetchPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import { getDefaultImageModel } from './platformCapabilities';

/**
 * 领域服务：图片生成
 * - 为角色生成形象图：基于 appearancePrompt + personalityPrompt，可选参考图（图生图）
 * - 为背景生成环境图：基于 environmentPrompt
 * - Phase 2-C：生成结果统一存储到 OPFS，避免外部 URL 过期 + data:URI 体积大
 *
 * 依赖注入（Phase 2 反转）：
 * - characterRepo / backgroundRepo：仓储端口
 * - router：PlatformRouter 解析当前激活平台的图片生成适配器
 * - configStore：IApiConfigStore 读取当前配置（替代直接 import ApiConfigStore）
 * - logger：ILoggerPort（替代 static defaultLogger）
 * - fileStorage：IFileStoragePort 或 lazy thunk（保留原 API 兼容性）
 * - costMeter：可选，成本计量（P1-21）
 */
export class ImageGenerationService {
  characterRepo: ICharacterRepository;
  backgroundRepo: IBackgroundRepository;
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  private getFileStorage: () => IFileStoragePort;
  private costMeter?: ICostMeter;
  /** HTTP 抓取 Port */
  private httpFetch: IHttpFetchPort;

  constructor(
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    router: PlatformRouter,
    configStore: IApiConfigStore,
    fileStorage: IFileStoragePort | (() => IFileStoragePort),
    logger: ILoggerPort,
    httpFetch: IHttpFetchPort,
    costMeter?: ICostMeter,
  ) {
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.router = router;
    this.configStore = configStore;
    this.getFileStorage = typeof fileStorage === 'function' ? fileStorage : () => fileStorage;
    this.logger = logger;
    this.costMeter = costMeter;
    this.httpFetch = httpFetch;
  }

  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'ImageGenerationService', ...extra };
  }

  /** 获取当前配置对应的图片生成适配器 */
  private getImagePort(): IImageGeneratorPort {
    const config = this.configStore.load();
    return this.router.resolve('image', config) as IImageGeneratorPort;
  }

  /**
   * 记录一次图片调用到成本计量（P1-21）。
   * 图片调用无 token 概念，仅记录调用次数。
   */
  private recordImageCost(model: string): void {
    if (!this.costMeter) return;
    const config = this.configStore.load();
    this.costMeter.record({
      platform: config.activePlatform,
      model,
      callType: 'image',
    });
  }

  async generateCharacterImage(characterId: string, aspectRatio: string = '1:1'): Promise<string> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) throw new Error('Character not found');

    const parts: string[] = [];
    if (character.appearancePrompt) parts.push(character.appearancePrompt);
    if (character.personalityPrompt) parts.push(character.personalityPrompt);
    if (parts.length === 0) {
      throw new Error('Character has no appearance or personality prompt to generate image from');
    }

    const config = this.configStore.load();
    const context: ImageGenerationContext = {
      prompt: parts.join(', '),
      model: getDefaultImageModel(config.activePlatform),
      aspectRatio: aspectRatio as ImageAspectRatio,
      subjectReferenceUrl: character.referenceImageUrl?.startsWith('http')
        ? character.referenceImageUrl
        : undefined,
    };

    const imagePort = this.getImagePort();
    const result = await imagePort.generateImage(context);
    this.recordImageCost(context.model || 'unknown');

    const reference = await this.persistImage(
      `images/char_${characterId}.png`,
      result.imageDataUri || result.imageUrls?.[0] || '',
    );
    character.referenceImageUrl = reference.url;
    character.referenceImageStoragePath = reference.storagePath;
    await this.characterRepo.save(character);

    return reference.url;
  }

  async generateBackgroundImage(backgroundId: string, aspectRatio: string = '16:9'): Promise<string> {
    const background = await this.backgroundRepo.findById(backgroundId);
    if (!background) throw new Error('Background not found');

    if (!background.environmentPrompt) {
      throw new Error('Background has no environment prompt to generate image from');
    }

    const config = this.configStore.load();
    const context: ImageGenerationContext = {
      prompt: background.environmentPrompt,
      model: getDefaultImageModel(config.activePlatform),
      aspectRatio: aspectRatio as ImageAspectRatio,
    };

    const imagePort = this.getImagePort();
    const result = await imagePort.generateImage(context);
    this.recordImageCost(context.model || 'unknown');

    const reference = await this.persistImage(
      `images/bg_${backgroundId}.png`,
      result.imageDataUri || result.imageUrls?.[0] || '',
    );
    background.referenceImageUrl = reference.url;
    background.referenceImageStoragePath = reference.storagePath;
    await this.backgroundRepo.save(background);

    return reference.url;
  }

  /**
   * 通用图片生成（供 Agent 工具调用）。
   *
   * 与 generateCharacterImage / generateBackgroundImage 的区别：
   * - 不绑定具体实体，接受自由 prompt
   * - 可选传入 Character / Background 作为参考（保持一致性）
   * - 返回结构化结果（含 imageDataUri / imageUrls / metadata）
   *
   * 设计决策：Agent 的 generate_image 工具需要自由 prompt 生成能力，
   * 不能强制要求 characterId/backgroundId，因此补此通用方法。
   */
  async generateImage(context: ImageGenerationContext & {
    character?: { referenceImageUrl?: string } | null;
    background?: { referenceImageUrl?: string } | null;
  }): Promise<{ imageDataUri: string; imageUrls: string[]; metadata?: { successCount?: number; failedCount?: number } }> {
    // 透传 ImageLab 传入的全部字段（model/n/seed/style 等），仅补充 subjectReferenceUrl
    const { character, background, ...rest } = context;
    const ctx: ImageGenerationContext = {
      ...rest,
      aspectRatio: context.aspectRatio ?? '16:9',
      subjectReferenceUrl: character?.referenceImageUrl?.startsWith('http')
        ? character.referenceImageUrl
        : background?.referenceImageUrl?.startsWith('http')
          ? background.referenceImageUrl
          : undefined,
    };

    const imagePort = this.getImagePort();
    const result = await imagePort.generateImage(ctx);
    this.recordImageCost(context.model || 'unknown');

    return {
      imageDataUri: result.imageDataUri ?? '',
      imageUrls: result.imageUrls ?? [],
      metadata: { successCount: result.imageUrls?.length ?? (result.imageDataUri ? 1 : 0), failedCount: result.metadata?.failedCount },
    };
  }

  /**
   * 从已持久化的存储路径恢复参考图 Object URL。
   */
  async getReferenceImageUrl(entity: { referenceImageUrl?: string; referenceImageStoragePath?: string }): Promise<string | null> {
    if (entity.referenceImageStoragePath) {
      const fileStorage = this.getFileStorage();
      const exists = await fileStorage.blobExists(entity.referenceImageStoragePath);
      if (exists) {
        return fileStorage.getObjectUrl(entity.referenceImageStoragePath);
      }
    }
    return entity.referenceImageUrl || null;
  }

  /**
   * 通用图片持久化：dataURI / 外部 URL → Blob → OPFS（Phase 2-C）。
   * 失败时回退到原始 URL/dataURI，不抛出错误以保证 UI 不被中断。
   */
  private async persistImage(storagePath: string, source: string): Promise<{ url: string; storagePath?: string }> {
    if (!source) return { url: '' };

    try {
      const blob = await this.httpFetch.fetchBlob(source);

      if (!blob || blob.size === 0) return { url: source };

      await this.getFileStorage().storeBlob(storagePath, blob);
      const url = await this.getFileStorage().getObjectUrl(storagePath);
      return { url, storagePath };
    } catch (e) {
      this.logger.warn('persistImage failed, falling back to source URL', this.ctx({
        storagePath,
        error: e instanceof Error ? e.message : String(e),
      }));
      return { url: source };
    }
  }
}