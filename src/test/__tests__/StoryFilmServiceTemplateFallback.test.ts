/**
 * SYSTEM_OPTIMIZATION_PLAN S-1：故事文本生成失败降级到模板
 * - 文本平台临时不可用时，createStoryFilm 捕获异常并使用模板故事继续（不硬阻断主流程）
 * - fallbackToTemplate=false 时保持抛错语义
 */
import { describe, expect, it, vi } from 'vitest';
import { StoryFilmService } from '../../domain/services/StoryFilmService';
import type { ILoggerPort } from '../../domain/ports/CrossCuttingPorts';

function makeLogger(): ILoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => makeLogger()) as unknown as ILoggerPort['child'],
  } as unknown as ILoggerPort;
}

function makeService(textImpl: () => Promise<{ content: string }>) {
  const textGenerationService = {
    refinePrompt: vi.fn(textImpl as never),
  } as never;
  const pipelineService = {
    runFullPipeline: vi.fn(async (storyId: string) => ({ id: 'pipe-1', storyId })),
  } as never;
  const storyService = {
    createStory: vi.fn(async (title: string, originalText: string, spaceId: string) => ({
      id: 'story-1', title, originalText, spaceId,
    })),
  } as never;
  return new StoryFilmService(textGenerationService, pipelineService, storyService, makeLogger());
}

describe('StoryFilmService 模板降级（S-1）', () => {
  it('文本生成失败时使用模板故事并标记 usedTemplate', async () => {
    const svc = makeService(async () => { throw new Error('platform unavailable'); });
    const result = await svc.createStoryFilm({
      theme: '一个关于勇气的冒险故事',
      spaceId: 'sp-1',
      videoStyle: 'cyberpunk' as never,
    });
    expect(result.usedTemplate).toBe(true);
    expect(result.storyId).toBe('story-1');
  });

  it('fallbackToTemplate=false 时保持抛错', async () => {
    const svc = makeService(async () => { throw new Error('platform unavailable'); });
    await expect(svc.createStoryFilm({
      theme: '科幻',
      spaceId: 'sp-1',
      videoStyle: 'cyberpunk' as never,
      fallbackToTemplate: false,
    })).rejects.toThrow('platform unavailable');
  });

  it('文本生成成功时不使用模板', async () => {
    const svc = makeService(async () => ({ content: 'AI 生成的故事正文' }));
    const result = await svc.createStoryFilm({
      theme: '日常',
      spaceId: 'sp-1',
      videoStyle: 'cyberpunk' as never,
    });
    expect(result.usedTemplate).toBeUndefined();
  });

  it('pickTemplateStory 按关键词命中模板，未命中回退通用模板', () => {
    const adventure = StoryFilmService.pickTemplateStory('星际冒险之旅');
    expect(adventure).toContain('林澈');
    const generic = StoryFilmService.pickTemplateStory('任意主题');
    expect(generic).toContain('老周');
  });
});
