/**
 * SYSTEM_OPTIMIZATION_PLAN_PHASE2 E-3：发布能力一期 —— 分享链接
 * - generateShareLink：URL 格式 + 7 天 expiresAt + 存储
 * - 超 5MB 限制抛明确错误
 * - resolveShareLink：命中返回 / 过期删除返回 null
 * - revokeShareLink：删除
 * - generateShareToken：长度与字符集
 */
import { describe, expect, it, vi } from 'vitest';
import { ShareService, generateShareToken, SHARE_MAX_BYTES } from '../../domain/services/ShareService';
import type { IShareLinkRepository } from '../../domain/ports/ShareLinkPorts';
import type { FinalCut } from '../../domain/entities/models';

function makeCut(overrides: Partial<FinalCut> = {}): FinalCut {
  return {
    id: 'cut-1',
    storyId: 'story-1',
    videoBlob: new Blob([new Uint8Array(1024)], { type: 'video/mp4' }),
    duration: 120_000,
    size: 1024,
    hasSubtitles: true,
    srtContent: '1\n00:00:01,000 --> 00:00:02,000\nhi',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeRepo() {
  const store = new Map<string, import('../../domain/entities/models').ShareLink>();
  return {
    save: vi.fn(async (link: import('../../domain/entities/models').ShareLink) => { store.set(link.token, link); }),
    findByToken: vi.fn(async (token: string) => store.get(token)),
    delete: vi.fn(async (token: string) => { store.delete(token); }),
    listAll: vi.fn(async () => Array.from(store.values())),
  } as unknown as IShareLinkRepository;
}

describe('E-3 分享链接', () => {
  it('generateShareLink 生成 URL 并持久化（7 天有效期）', async () => {
    const repo = makeRepo();
    const finalCutRepo = { findById: vi.fn(async () => makeCut()) } as never;
    const svc = new ShareService(repo, finalCutRepo);
    const before = Date.now();
    const url = await svc.generateShareLink('cut-1');
    const after = Date.now();
    expect(url).toMatch(/^https:\/\/share\.aivideostudio\.local\/c\/[A-Za-z0-9]{16}$/);
    const saved = Array.from((repo.listAll as ReturnType<typeof vi.fn>).mock?.calls ? await repo.listAll() : []);
    expect(saved).toHaveLength(1);
    expect(saved[0].expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(saved[0].expiresAt).toBeLessThanOrEqual(after + 7 * 24 * 60 * 60 * 1000);
    expect(saved[0].cutId).toBe('cut-1');
  });

  it('超过 5MB 体积上限时抛出明确错误', async () => {
    const repo = makeRepo();
    const finalCutRepo = {
      findById: vi.fn(async () => makeCut({ videoBlob: new Blob([new Uint8Array(SHARE_MAX_BYTES + 1)]) })),
    } as never;
    const svc = new ShareService(repo, finalCutRepo);
    await expect(svc.generateShareLink('cut-1')).rejects.toThrow(/exceeds .* bytes limit/);
  });

  it('resolveShareLink 命中时返回链接内容', async () => {
    const repo = makeRepo();
    const finalCutRepo = { findById: vi.fn(async () => makeCut()) } as never;
    const svc = new ShareService(repo, finalCutRepo);
    const url = await svc.generateShareLink('cut-1');
    const token = url.split('/').pop() as string;
    const resolved = await svc.resolveShareLink(token);
    expect(resolved).not.toBeNull();
    expect(resolved?.storyTitle).toBe('story-1');
    expect(resolved?.duration).toBe(120_000);
  });

  it('resolveShareLink 过期时删除并返回 null', async () => {
    const repo = makeRepo();
    const finalCutRepo = { findById: vi.fn(async () => makeCut()) } as never;
    const svc = new ShareService(repo, finalCutRepo);
    const url = await svc.generateShareLink('cut-1', 0); // 立即过期
    const token = url.split('/').pop() as string;
    const resolved = await svc.resolveShareLink(token);
    expect(resolved).toBeNull();
    expect(repo.findByToken).toHaveBeenCalled();
  });

  it('revokeShareLink 删除记录', async () => {
    const repo = makeRepo();
    const finalCutRepo = { findById: vi.fn(async () => makeCut()) } as never;
    const svc = new ShareService(repo, finalCutRepo);
    const url = await svc.generateShareLink('cut-1');
    const token = url.split('/').pop() as string;
    await svc.revokeShareLink(token);
    expect(repo.delete).toHaveBeenCalledWith(token);
    expect(await svc.resolveShareLink(token)).toBeNull();
  });

  it('generateShareToken 长度正确且仅含安全字符', () => {
    for (let len = 1; len <= 32; len += 1) {
      const tk = generateShareToken(len);
      expect(tk).toHaveLength(len);
      expect(tk).toMatch(/^[A-Za-z0-9]+$/);
    }
  });
});
