import type { PublishTask, PublishPlatform } from '../entities/models';
import type { ApiConfig } from '../entities/platform';

/**
 * P3-9 发布通道抽象：
 * 每个目标平台一个通道，负责"发布动作"的门禁与执行。
 *
 * 诚实约束：真实平台 API（抖音开放平台/视频号/B站）需要开发者资质与凭据，
 * 未接入前通道只做门禁（凭据检查）与半自动发布，绝不伪造成功回执。
 */

export interface PublishChannelContext {
  config: ApiConfig;
}

export interface PublishChannelResult {
  ok: boolean;
  /** 需要先配置凭据（UI 引导） */
  needsCredentials?: boolean;
  /** 凭据就绪但真实 API 未接入（半自动手动确认发布） */
  needsManual?: boolean;
  message?: string;
}

export interface IPublishChannel {
  id: PublishPlatform;
  label: string;
  requiresCredentials: boolean;
  isConfigured(ctx: PublishChannelContext): boolean;
  execute(task: PublishTask, ctx: PublishChannelContext): Promise<PublishChannelResult>;
}
