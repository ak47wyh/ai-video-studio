/**
 * P1-5 项目/系列：ProjectService
 *
 * 覆盖：
 * - createProject / updateProject（含系列设置）
 * - linkStory / unlinkStory 写/清 story.projectId
 * - listProjectStories 按 projectId 过滤
 * - deleteProject 解除故事关联但不删故事
 */
import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from '../../domain/services/ProjectService';
import type { Project, Story } from '../../domain/entities/models';
import type { IProjectRepository } from '../../domain/ports/ProjectPorts';
import type { IStoryRepository } from '../../domain/ports/OutboundPorts';

function makeDeps() {
  const projects = new Map<string, Project>();
  const stories = new Map<string, Story>();
  const repo: IProjectRepository = {
    save: vi.fn(async (p: Project) => { projects.set(p.id, p); }),
    getById: vi.fn(async (id: string) => projects.get(id)),
    query: vi.fn(async (params: { spaceId?: string }) => [...projects.values()].filter(p => !params.spaceId || p.spaceId === params.spaceId)),
    delete: vi.fn(async (id: string) => { projects.delete(id); }),
    count: vi.fn(async () => projects.size),
  };
  const storyRepo: IStoryRepository = {
    save: vi.fn(async (s: Story) => { stories.set(s.id, s); }),
    findById: vi.fn(async (id: string) => stories.get(id) ?? null),
    findAll: vi.fn(async () => [...stories.values()]),
    findBySpaceId: vi.fn(async (spaceId: string) => [...stories.values()].filter(s => s.spaceId === spaceId)),
    delete: vi.fn(async (id: string) => { stories.delete(id); }),
  };
  return { svc: new ProjectService(repo, storyRepo), repo, storyRepo, projects, stories };
}

function fakeStory(id: string, spaceId = 'sp-1'): Story {
  return { id, spaceId, title: `故事 ${id}`, originalText: '', status: 'DRAFT', createdAt: 1 };
}

describe('ProjectService — 项目/系列（P1-5）', () => {
  it('createProject 保存系列设置', async () => {
    const { svc } = makeDeps();
    const p = await svc.createProject({
      spaceId: 'sp-1',
      name: '都市异能系列',
      description: '第一季',
      styleSettings: { videoStyle: 'cinematic', videoResolution: '1080P' },
    });
    expect(p.name).toBe('都市异能系列');
    expect(p.styleSettings?.videoStyle).toBe('cinematic');
    expect(p.updatedAt).toBeGreaterThan(0);
  });

  it('updateProject 更新设置与时间戳', async () => {
    const { svc } = makeDeps();
    const p = await svc.createProject({ spaceId: 'sp-1', name: '系列' });
    const updated = await svc.updateProject(p.id, { styleSettings: { bgmPreference: '史诗管弦' } });
    expect(updated.styleSettings?.bgmPreference).toBe('史诗管弦');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it('linkStory / unlinkStory 写清 projectId', async () => {
    const { svc, stories } = makeDeps();
    const p = await svc.createProject({ spaceId: 'sp-1', name: '系列' });
    stories.set('st-1', fakeStory('st-1'));
    await svc.linkStory(p.id, 'st-1');
    expect(stories.get('st-1')?.projectId).toBe(p.id);
    await svc.unlinkStory(p.id, 'st-1');
    expect(stories.get('st-1')?.projectId).toBeUndefined();
  });

  it('listProjectStories 只返回项目内故事', async () => {
    const { svc, stories } = makeDeps();
    const p = await svc.createProject({ spaceId: 'sp-1', name: '系列' });
    stories.set('st-1', { ...fakeStory('st-1'), projectId: p.id });
    stories.set('st-2', fakeStory('st-2'));
    const list = await svc.listProjectStories(p.id);
    expect(list.map(s => s.id)).toEqual(['st-1']);
  });

  it('deleteProject 解除关联但不删故事', async () => {
    const { svc, stories } = makeDeps();
    const p = await svc.createProject({ spaceId: 'sp-1', name: '系列' });
    stories.set('st-1', { ...fakeStory('st-1'), projectId: p.id });
    await svc.deleteProject(p.id);
    expect(stories.get('st-1')).toBeDefined();
    expect(stories.get('st-1')?.projectId).toBeUndefined();
  });

  it('linkStory 项目或故事不存在时抛错', async () => {
    const { svc } = makeDeps();
    await expect(svc.linkStory('nope', 'st-1')).rejects.toThrow('Project not found');
    const p = await svc.createProject({ spaceId: 'sp-1', name: '系列' });
    await expect(svc.linkStory(p.id, 'nope')).rejects.toThrow('Story not found');
  });
});
