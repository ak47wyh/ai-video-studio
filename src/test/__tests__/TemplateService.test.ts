/**
 * P1-6 创作模板：TemplateService
 *
 * 覆盖：
 * - ensureBuiltinTemplates 幂等（两次调用不重复创建）
 * - createTemplate / updateTemplate / deleteTemplate（builtin 不可删）
 * - listTemplates 按 kind 过滤
 * - resolve：分镜/提示词/导出按 kind 解析，缺字段抛错
 */
import { describe, it, expect, vi } from 'vitest';
import { TemplateService } from '../../domain/services/TemplateService';
import type { ContentTemplate, TemplateKind } from '../../domain/entities/models';
import type { ITemplateRepository } from '../../domain/ports/TemplatePorts';

function makeRepo() {
  const store = new Map<string, ContentTemplate>();
  const repo: ITemplateRepository = {
    save: vi.fn(async (t: ContentTemplate) => { store.set(t.id, t); }),
    getById: vi.fn(async (id: string) => store.get(id)),
    query: vi.fn(async (params: { kind?: TemplateKind }) => [...store.values()].filter(t => !params.kind || t.kind === params.kind)),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
    count: vi.fn(async () => store.size),
  };
  return { repo, store };
}

describe('TemplateService — 创作模板（P1-6）', () => {
  it('ensureBuiltinTemplates 幂等注入 9 个种子', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    const first = await svc.ensureBuiltinTemplates();
    expect(first).toHaveLength(9);
    const second = await svc.ensureBuiltinTemplates();
    expect(second).toHaveLength(0); // 全部已存在
    expect((await svc.listTemplates())).toHaveLength(9);
  });

  it('createTemplate / listTemplates 按 kind 过滤', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    await svc.createTemplate({ kind: 'prompt', name: '我的模板', content: { template: 'x {v}' } });
    await svc.createTemplate({ kind: 'style', name: '风格A', content: { videoStyle: 'anime' } });
    const prompts = await svc.listTemplates('prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('我的模板');
    const styles = await svc.listTemplates('style');
    expect(styles).toHaveLength(1);
  });

  it('updateTemplate 更新内容与时间戳', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    const t = await svc.createTemplate({ kind: 'prompt', name: 'P', content: { template: 'a' } });
    const updated = await svc.updateTemplate(t.id, { content: { template: 'b' } });
    expect(updated.content.template).toBe('b');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(t.updatedAt);
  });

  it('builtin 模板不可删除，自定义可删', async () => {
    const { repo, store } = makeRepo();
    const svc = new TemplateService(repo);
    const t = await svc.createTemplate({ kind: 'prompt', name: 'P', content: { template: 'a' } });
    await svc.deleteTemplate(t.id);
    expect(store.size).toBe(0);
    await svc.ensureBuiltinTemplates();
    const builtin = (await svc.listTemplates('story_structure'))[0];
    await expect(svc.deleteTemplate(builtin.id)).rejects.toThrow('内置模板不可删除');
  });

  it('resolve 分镜模板解析 beats', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    const t = await svc.createTemplate({
      kind: 'story_structure',
      name: 'S',
      content: { beats: [{ name: '钩子', description: '开场' }] },
    });
    const r = svc.resolve(t);
    expect((r.beats as Array<{ name: string }>)[0].name).toBe('钩子');
  });

  it('resolve 缺字段抛错（beats 空 / presetKey 非法）', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    const badBeats = await svc.createTemplate({ kind: 'story_structure', name: 'X', content: { beats: [] } });
    expect(() => svc.resolve(badBeats)).toThrow('缺少 beats');
    const badExport = await svc.createTemplate({ kind: 'export', name: 'Y', content: { presetKey: 'nope' } });
    expect(() => svc.resolve(badExport)).toThrow('presetKey');
  });

  it('resolve 提示词模板返回 template 与 variables', async () => {
    const { repo } = makeRepo();
    const svc = new TemplateService(repo);
    const t = await svc.createTemplate({ kind: 'prompt', name: 'P', content: { template: '为《{title}》生成标题', variables: ['title'] } });
    const r = svc.resolve(t);
    expect(r.template).toContain('{title}');
    expect(r.variables).toEqual(['title']);
  });
describe('TemplateService 变量与套用（P3-4）', () => {
  it('提取占位符：递归扫描 + 声明合并 + 去重', () => {
    const v = TemplateService.extractVariables({
      template: '为视频 {title} 生成标题，主角 {hero}（主角 {hero}）',
      variables: ['hero', 'extra'],
    });
    expect(v.sort()).toEqual(['extra', 'hero', 'title']);
  });

  it('嵌套结构也能提取（字段在对象层层等内）', () => {
    const v = TemplateService.extractVariables({
      beats: [
        { name: '开端', description: '主角 {name} 出发' },
        { name: '结局', description: '{name} 达成目标 {goal}' },
      ],
    });
    expect(v.sort()).toEqual(['goal', 'name']);
  });

  it('替换变量：提供值生效，未提供替换为空串，不动原对象', () => {
    const src = { template: '《{title}》的主角是 {hero}', meta: { n: 1 } };
    const out = TemplateService.applyContent(src, { title: '风云' });
    expect(out.template).toBe('《风云》的主角是 ');
    expect(out.meta).toEqual({ n: 1 });
    expect(src.template).toBe('《{title}》的主角是 {hero}');
  });

  it('分镜模板生成草稿文本：编号节拍行', () => {
    const tpl = { kind: 'story_structure' } as ContentTemplate;
    const draft = TemplateService.buildStoryDraft(tpl, { beats: [{ name: '开端', description: '建立世界观' }, { name: '结局', description: '目标达成' }] });
    expect(draft).toContain('1. 开端：建立世界观');
    expect(draft).toContain('2. 结局：目标达成');
  });

  it('提示词模板生成草稿：返回 template 文本', () => {
    const tpl = { kind: 'prompt' } as ContentTemplate;
    const draft = TemplateService.buildStoryDraft(tpl, { template: '为视频生成标题' });
    expect(draft).toBe('为视频生成标题');
  });

  it('风格模板生成草稿：键值行；导出模板生成草稿：参数组合', () => {
    const styleDraft = TemplateService.buildStoryDraft({ kind: 'style' } as ContentTemplate, { videoStyle: 'cinematic', bgmPreference: '史诗管弦' });
    expect(styleDraft).toContain('画面风格：cinematic');
    const exportDraft = TemplateService.buildStoryDraft({ kind: 'export' } as ContentTemplate, { presetKey: 'douyin', videoResolution: '1080P', includeSubtitles: true });
    expect(exportDraft).toContain('导出预设：douyin');
    expect(exportDraft).toContain('1080P');
    expect(exportDraft).toContain('含字幕');
  });
});
});
