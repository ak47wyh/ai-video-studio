/**
 * ShareLinkPorts —— 分享链接仓储端口（E-3）
 *
 * 一期实现：Dexie IndexedDB（share_links 表）。
 * 后续可替换为服务端托管（需鉴权与合规评估）。
 */
import type { ShareLink } from '../entities/models';

export interface IShareLinkRepository {
  save(link: ShareLink): Promise<void>;
  findByToken(token: string): Promise<ShareLink | undefined>;
  delete(token: string): Promise<void>;
  listAll(): Promise<ShareLink[]>;
}
