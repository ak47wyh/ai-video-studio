/**
 * C1 补充：ToolRegistry 工具注册表（AI 故事创作 ReAct 工具层）
 *
 * 覆盖：
 * - 构造后内置工具全部注册（listTools / has）
 * - execute 未知工具返回失败结果（不抛）
 * - execute 已知工具：emit tool_start → handler 执行 → emit tool_success
 * - handler 失败时 emit tool_error 并返回失败结果
 */
import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../domain/services/ToolRegistry';

function makeDeps() {
  const characterRepo = { save: vi.fn(async (_c: unknown) => { }), update: vi.fn(async () => { }) };
  const deps = {
    storyRepo: {},
    segmentRepo: {},
    characterRepo,
    backgroundRepo: {},
    videoTaskRepo: {},
    storyService: {},
    imageGenerationService: {},
    videoGenerationService: {},
    voiceService: {},
    musicService: {},
    postProcessService: {},
    bgmRecommendationService: {},
    cinematographyService: {},
    promptContextBuilder: {},
  } as unknown as ConstructorParameters<typeof ToolRegistry>[0];
  return { deps, characterRepo };
}

function makeCtx() {
  return {
    spaceId: 'sp-1',
    storyId: 'st-1',
    emit: vi.fn(),
  };
}

describe('ToolRegistry — 工具注册与执行', () => {
  it('构造后注册全部内置工具', () => {
    const { deps } = makeDeps();
    const registry = new ToolRegistry(deps);
    const tools = registry.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(13);
    const names = tools.map(t => t.name);
    expect(names).toContain('create_character');
    expect(names).toContain('generate_image');
    expect(names).toContain('burn_subtitles');
  });

  it('has 返回工具存在性', () => {
    const { deps } = makeDeps();
    const registry = new ToolRegistry(deps);
    expect(registry.has('create_character')).toBe(true);
    expect(registry.has('no_such_tool')).toBe(false);
  });

  it('execute 未知工具返回失败结果（不抛错）', async () => {
    const { deps } = makeDeps();
    const registry = new ToolRegistry(deps);
    const ctx = makeCtx();
    const result = await registry.execute('no_such_tool', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('execute create_character：保存角色并 emit tool_start/tool_success', async () => {
    const { deps, characterRepo } = makeDeps();
    const registry = new ToolRegistry(deps);
    const ctx = makeCtx();
    const result = await registry.execute('create_character', {
      name: '小红',
      appearancePrompt: '红衣少女',
      personalityPrompt: '温柔',
    }, ctx);
    expect(result.success).toBe(true);
    expect(characterRepo.save).toHaveBeenCalledTimes(1);
    const saved = characterRepo.save.mock.calls[0][0] as { name: string; spaceId: string; appearancePrompt: string };
    expect(saved.name).toBe('小红');
    expect(saved.spaceId).toBe('sp-1');
    expect(saved.appearancePrompt).toBe('红衣少女');
    // 事件流：tool_start → tool_success
    const events = ctx.emit.mock.calls.map(c => c[0].type);
    expect(events).toContain('tool_start');
    expect(events[events.length - 1]).toBe('tool_success');
  });

  it('handler 抛错时返回失败并 emit tool_error', async () => {
    const { deps, characterRepo } = makeDeps();
    characterRepo.save.mockRejectedValueOnce(new Error('db down'));
    const registry = new ToolRegistry(deps);
    const ctx = makeCtx();
    const result = await registry.execute('create_character', { name: '小红', appearancePrompt: 'x' }, ctx);
    expect(result.success).toBe(false);
    expect(ctx.emit.mock.calls.map(c => c[0].type)).toContain('tool_error');
  });
});
