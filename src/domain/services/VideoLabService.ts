import type {
  IVideoGeneratorPort,
  IVideoAgentCapable,
  VideoPromptContext,
  VideoTaskResult,
  VideoDownloadResult,
  VideoAgentContext,
  VideoAgentTaskResult,
} from '../ports/OutboundPorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import { TimeoutError } from '../errors';

export class VideoLabService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  private activePollers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.logger = logger;
  }

  /** 获取当前配置对应的视频生成适配器 */
  private getVideoPort(): IVideoGeneratorPort {
    return this.router.resolveVideo(this.configStore.load());
  }

  async submitTask(context: VideoPromptContext): Promise<string> {
    this.logger.info('submitTask', { service: 'VideoLabService', method: 'submitTask' });
    return this.getVideoPort().submitVideoTask(context);
  }

  async submitAgentTask(context: VideoAgentContext): Promise<string> {
    this.logger.info('submitAgentTask', { service: 'VideoLabService', method: 'submitAgentTask' });
    const port = this.getVideoPort() as IVideoAgentCapable;
    return port.createAgentTask(context);
  }

  async queryTask(taskId: string): Promise<VideoTaskResult> {
    return this.getVideoPort().queryTaskStatus(taskId);
  }

  async queryAgentTask(taskId: string): Promise<VideoAgentTaskResult> {
    const port = this.getVideoPort() as IVideoAgentCapable;
    return port.queryAgentTask(taskId);
  }

  async downloadVideo(fileId: string): Promise<VideoDownloadResult> {
    return this.getVideoPort().downloadVideo(fileId);
  }

  startPolling(
    taskId: string,
    isAgent: boolean,
    onUpdate: (result: VideoTaskResult | VideoAgentTaskResult) => void,
    maxRetries: number = 60,
  ): () => void {
    let retryCount = 0;
    const interval = setInterval(async () => {
      retryCount++;
      try {
        const result = isAgent
          ? await this.queryAgentTask(taskId)
          : await this.queryTask(taskId);

        const status = result.status.toUpperCase();
        if (status === 'SUCCESS' || status === 'FAIL' || status === 'FAILED' || retryCount >= maxRetries) {
          clearInterval(interval);
          this.activePollers.delete(taskId);
          if (retryCount >= maxRetries && status !== 'SUCCESS') {
            // Phase 5 收敛：用 TimeoutError 承载超时上下文（替代裸字符串）
            const err = new TimeoutError({
              message: `Polling timed out after ${maxRetries} retries`,
              context: { taskId, retries: retryCount, maxRetries, isAgent },
            });
            this.logger.warn('polling timeout', {
              service: 'VideoLabService', method: 'startPolling', taskId, retries: retryCount,
            });
            onUpdate({ ...result, status: 'FAILED', errorMessage: err.message });
            return;
          }
        }
        onUpdate(result);
      } catch (e) {
        clearInterval(interval);
        this.activePollers.delete(taskId);
        this.logger.warn('polling error', {
          service: 'VideoLabService', method: 'startPolling', taskId,
          error: e instanceof Error ? e.message : String(e),
        });
        onUpdate({ status: 'FAILED', errorMessage: 'Polling error' });
      }
    }, 5000);

    this.activePollers.set(taskId, interval);
    return () => {
      clearInterval(interval);
      this.activePollers.delete(taskId);
    };
  }

  cancelAllPolling(): void {
    for (const [, interval] of this.activePollers) clearInterval(interval);
    this.activePollers.clear();
  }
}
