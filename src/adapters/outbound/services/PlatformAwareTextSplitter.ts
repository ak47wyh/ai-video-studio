/**
 * PlatformAwareTextSplitter —— A2 平台路由版故事拆分器
 *
 * 背景：原 smartTextSplitter 硬编码 MiniMax TextAdapter，用户切换平台后
 * 故事拆分仍走 MiniMax，违背"8 平台统一路由"承诺。
 *
 * 本适配器按激活平台实时解析文本生成 Port 与模型 ID
 * （复用 IModelRegistry 的 splitter 分档），使拆分能力随平台切换；
 * 平台不支持 text 能力或调用失败时降级到 Mock 拆分（保持可用性）。
 */
import type { ITextSplitterPort, SegmentDraft } from '../../../domain/ports/OutboundPorts';
import type { PlatformRouter } from '../../../domain/services/PlatformRouter';
import type { IApiConfigStore, IModelRegistry } from '../../../domain/ports/PlatformPorts';
import type { ILoggerPort } from '../../../domain/ports/CrossCuttingPorts';
import { MiniMaxTextSplitterAdapter } from '../api/MiniMaxTextSplitterAdapter';

export class PlatformAwareTextSplitter implements ITextSplitterPort {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private fallback: ITextSplitterPort;
  private modelRegistry?: IModelRegistry;
  private logger?: ILoggerPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    fallback: ITextSplitterPort,
    modelRegistry?: IModelRegistry,
    logger?: ILoggerPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.fallback = fallback;
    this.modelRegistry = modelRegistry;
    this.logger = logger;
  }

  async splitStoryToSegments(text: string, knownCharacterNames: string[]): Promise<SegmentDraft[]> {
    try {
      const config = this.configStore.load();
      const textPort = this.router.resolveText(config);
      const model = this.modelRegistry?.resolveTextModel('splitter') ?? 'MiniMax-M2.5';
      const splitter = new MiniMaxTextSplitterAdapter(textPort, this.fallback, model, this.logger);
      return await splitter.splitStoryToSegments(text, knownCharacterNames);
    } catch (e) {
      this.logger?.warn('PlatformAwareTextSplitter: AI split failed, falling back to mock', {
        service: 'PlatformAwareTextSplitter',
        method: 'splitStoryToSegments',
        error: e instanceof Error ? e.message : String(e),
      });
      return this.fallback.splitStoryToSegments(text, knownCharacterNames);
    }
  }
}
