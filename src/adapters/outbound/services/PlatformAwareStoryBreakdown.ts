/**
 * PlatformAwareStoryBreakdown —— A2 平台路由版故事一键分解器
 *
 * 背景：原 smartStoryBreakdown 硬编码 MiniMax TextAdapter，用户切换平台后
 * 故事分解仍走 MiniMax。本适配器按激活平台实时解析文本生成 Port 与模型 ID，
 * 使分解能力随平台切换；平台不支持 text 能力或调用失败时降级到 Mock。
 */
import type { IStoryBreakdownPort, StoryBreakdownResult } from '../../../domain/ports/OutboundPorts';
import type { PlatformRouter } from '../../../domain/services/PlatformRouter';
import type { IApiConfigStore, IModelRegistry } from '../../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { MiniMaxStoryBreakdownAdapter } from '../api/MiniMaxStoryBreakdownAdapter';

export class PlatformAwareStoryBreakdown implements IStoryBreakdownPort {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private fallback: IStoryBreakdownPort;
  private modelRegistry?: IModelRegistry;
  private logger?: ILoggerPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    fallback: IStoryBreakdownPort,
    modelRegistry?: IModelRegistry,
    logger?: ILoggerPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.fallback = fallback;
    this.modelRegistry = modelRegistry;
    this.logger = logger;
  }

  async breakdownStory(text: string): Promise<StoryBreakdownResult> {
    try {
      const config = this.configStore.load();
      const textPort = this.router.resolveText(config);
      const model = this.modelRegistry?.resolveTextModel('splitter') ?? 'MiniMax-M2.5';
      const breakdown = new MiniMaxStoryBreakdownAdapter(textPort, this.fallback, model, this.logger);
      return await breakdown.breakdownStory(text);
    } catch (e) {
      this.logger?.warn('PlatformAwareStoryBreakdown: AI breakdown failed, falling back to mock', {
        service: 'PlatformAwareStoryBreakdown',
        method: 'breakdownStory',
        error: e instanceof Error ? e.message : String(e),
      });
      return this.fallback.breakdownStory(text);
    }
  }
}
