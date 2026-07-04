import type {
  IVideoGeneratorPort,
  VideoPromptContext,
  VideoTaskResult,
  VideoDownloadResult,
  VideoAgentContext,
  VideoAgentTaskResult,
} from '../ports/OutboundPorts';
import type { IApiConfigStore } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';

export class VideoLabService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  // @ts-expect-error Logger injected for future use
  private _logger: ILoggerPort;
  private activePollers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
  ) {
    this.router = router;
    this.configStore = configStore;
    this._logger = logger;
  }

  /** 获取当前配置对应的视频生成适配器 */
  private getVideoPort(): IVideoGeneratorPort {
    return this.router.resolveVideo(this.configStore.load());
  }

  async submitTask(context: VideoPromptContext): Promise<string> {
    return this.getVideoPort().submitVideoTask(context);
  }

  async submitAgentTask(context: VideoAgentContext): Promise<string> {
    return this.getVideoPort().createAgentTask(context);
  }

  async queryTask(taskId: string): Promise<VideoTaskResult> {
    return this.getVideoPort().queryTaskStatus(taskId);
  }

  async queryAgentTask(taskId: string): Promise<VideoAgentTaskResult> {
    return this.getVideoPort().queryAgentTask(taskId);
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
            onUpdate({ ...result, status: 'FAILED', errorMessage: `Polling timed out after ${maxRetries} retries` });
            return;
          }
        }
        onUpdate(result);
      } catch {
        clearInterval(interval);
        this.activePollers.delete(taskId);
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
