/**
 * ShareService —— 发布能力一期：分享链接（E-3）
 *
 * - generateShareLink(cutId, expiresInDays=7)：为成片生成带 token 的分享链接
 * - resolveShareLink(token)：解析链接（过期自动清理并返回 null）
 * - revokeShareLink(token)：撤销链接
 *
 * 一期实现：视频 Blob 存入 Dexie share_links 表（IndexedDB），
 * 链接格式 https://share.aivideostudio.local/c/{token}。
 * 不做 OAuth（二期接入抖音/B站开放平台需单独合规立项）。
 */
import type { IFinalCutRepository } from '../ports/OutboundPorts';
import type { IShareLinkRepository } from '../ports/ShareLinkPorts';
import type { ShareLink } from '../entities/models';

export const SHARE_BASE_URL = 'https://share.aivideostudio.local/c';
/** 一期体积上限：Dexie Blob 直存，超限提示走导出（而非阻塞） */
export const SHARE_MAX_BYTES = 5 * 1024 * 1024;

/** 生成随机会话 token（纯函数，可测） */
export function generateShareToken(length = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * chars.length);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export class ShareService {
  private shareRepo: IShareLinkRepository;
  private finalCutRepo: IFinalCutRepository;

  constructor(shareRepo: IShareLinkRepository, finalCutRepo: IFinalCutRepository) {
    this.shareRepo = shareRepo;
    this.finalCutRepo = finalCutRepo;
  }

  /**
   * 生成分享链接并持久化。
   * 成片超过 SHARE_MAX_BYTES 时抛出明确错误（建议导出后走本地分享）。
   */
  async generateShareLink(cutId: string, expiresInDays = 7): Promise<string> {
    const cut = await this.finalCutRepo.findById(cutId);
    if (!cut) throw new Error('ShareService: final cut not found');
    if (cut.videoBlob.size > SHARE_MAX_BYTES) {
      throw new Error(`ShareService: video exceeds ${SHARE_MAX_BYTES} bytes limit`);
    }
    const now = Date.now();
    const token = generateShareToken();
    await this.shareRepo.save({
      token,
      cutId,
      videoBlob: cut.videoBlob,
      storyTitle: cut.storyId,
      duration: cut.duration,
      hasSubtitles: cut.hasSubtitles,
      srtContent: cut.srtContent,
      createdAt: now,
      expiresAt: now + expiresInDays * 24 * 60 * 60 * 1000,
    });
    return `${SHARE_BASE_URL}/${token}`;
  }

  /** 解析分享链接；过期链接自动删除并返回 null（诚实口径：过期即失效） */
  async resolveShareLink(token: string): Promise<ShareLink | null> {
    const link = await this.shareRepo.findByToken(token);
    if (!link) return null;
    if (link.expiresAt <= Date.now()) {
      await this.shareRepo.delete(token);
      return null;
    }
    return link;
  }

  async revokeShareLink(token: string): Promise<void> {
    await this.shareRepo.delete(token);
  }
}
