import type { PublishTask, PublishPlatform } from '../entities/models';
import type { ApiConfig } from '../entities/platform';
import type { IPublishChannel, PublishChannelContext, PublishChannelResult } from '../ports/PublishChannelPorts';

/**
 * P3-9 发布通道注册表：
 * - generic：本地发布（无需凭据，直接完成"本地发布包"动作）
 * - douyin / bilibili：真实平台通道，需凭据门禁；真实 API 待平台资质与接入
 *   （凭据就绪时返回 needsManual=半自动确认发布，绝不伪造平台成功回执）
 */
export class PublishChannelRegistry {
  private readonly channels = new Map<PublishPlatform, IPublishChannel>();

  constructor() {
    this.register(new GenericChannel());
    this.register(new CredentialGatedChannel('douyin', '抖音', (c) => !!(c.publishDouyinAppKey && c.publishDouyinAppKey.trim()) && !!(c.publishDouyinAccessToken && c.publishDouyinAccessToken.trim())));
    this.register(new CredentialGatedChannel('bilibili', 'B站', (c) => !!(c.publishBilibiliAppKey && c.publishBilibiliAppKey.trim()) && !!(c.publishBilibiliAccessToken && c.publishBilibiliAccessToken.trim())));
  }

  register(channel: IPublishChannel): void {
    this.channels.set(channel.id, channel);
  }

  get(platform: PublishPlatform): IPublishChannel | undefined {
    return this.channels.get(platform);
  }

  list(): IPublishChannel[] {
    return [...this.channels.values()];
  }

  /** 通道就绪状态（凭据是否满足） */
  isReady(platform: PublishPlatform, config: ApiConfig): boolean {
    const ch = this.channels.get(platform);
    return ch ? ch.isConfigured({ config }) : false;
  }
}

class GenericChannel implements IPublishChannel {
  readonly id: PublishPlatform = 'generic';
  readonly label = '本地发布';
  readonly requiresCredentials = false;

  isConfigured(): boolean {
    return true;
  }

  async execute(): Promise<PublishChannelResult> {
    return { ok: true, message: '本地发布包完成（文件 + 发布信息）' };
  }
}

class CredentialGatedChannel implements IPublishChannel {
  readonly requiresCredentials = true;
  readonly id: 'douyin' | 'bilibili';
  readonly label: string;
  private readonly hasCreds: (c: ApiConfig) => boolean;

  constructor(id: 'douyin' | 'bilibili', label: string, hasCreds: (c: ApiConfig) => boolean) {
    this.id = id;
    this.label = label;
    this.hasCreds = hasCreds;
  }

  isConfigured(ctx: PublishChannelContext): boolean {
    return this.hasCreds(ctx.config);
  }

  async execute(_task: PublishTask, ctx: PublishChannelContext): Promise<PublishChannelResult> {
    if (!this.hasCreds(ctx.config)) {
      return { ok: false, needsCredentials: true, message: `${this.label}：请先配置 AppKey / AccessToken` };
    }
    // 凭据就绪但真实 API 未接入（平台资质待确认）——半自动手动确认发布，不伪造平台回执
    return { ok: true, needsManual: true, message: `${this.label}：凭据已就绪，真实平台 API 待接入，本次为本地确认发布` };
  }
}
