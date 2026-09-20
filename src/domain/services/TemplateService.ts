import type { ContentTemplate, TemplateBeat, TemplateKind } from '../entities/models';
import type { ITemplateRepository } from '../ports/TemplatePorts';

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface CreateTemplateInput {
  kind: TemplateKind;
  name: string;
  description?: string;
  content: Record<string, unknown>;
}

/**
 * P1-6 创作模板：分镜结构 / 风格组合 / 提示词 / 导出预设 四类模板库。
 * - ensureBuiltinTemplates：幂等注入内置种子（B2 导出模板定义随种子落地）；
 * - resolve：按 kind 解析为结构化可套用内容（缺字段抛错）。
 */
export class TemplateService {
  private readonly repo: ITemplateRepository;

  constructor(repo: ITemplateRepository) {
    this.repo = repo;
  }

  /** 内置种子定义（幂等） */
  private readonly builtins: Array<{ kind: TemplateKind; name: string; description: string; content: Record<string, unknown> }> = [
    {
      kind: 'story_structure', name: '四幕剧结构', description: '钩子-冲突-高潮-结局，短剧/短视频标准叙事弧',
      content: {
        beats: [
          { name: '钩子', description: '开场 3 秒抛出悬念或冲突，抓住注意力' },
          { name: '冲突', description: '主角遭遇阻碍，目标与阻力对抗升级' },
          { name: '高潮', description: '矛盾顶点，情绪与信息密度峰值' },
          { name: '结局', description: '收束主线，留下记忆点或反转' },
        ] as TemplateBeat[],
      },
    },
    {
      kind: 'story_structure', name: '三幕剧结构', description: '开端-发展-结局，完整短片叙事',
      content: {
        beats: [
          { name: '开端', description: '建立世界观与主角目标' },
          { name: '发展', description: '行动与阻碍交替，逐步推进' },
          { name: '结局', description: '目标达成或主题升华' },
        ] as TemplateBeat[],
      },
    },
    {
      kind: 'style', name: '电影质感', description: 'cinematic 画面 + 史诗管弦 BGM + 慢摇运镜',
      content: {
        videoStyle: 'cinematic',
        bgmPreference: '史诗管弦',
        cameraMotion: '慢摇推进',
      },
    },
    {
      kind: 'style', name: '日系动漫', description: 'anime 画面 + 轻快 BGM',
      content: {
        videoStyle: 'anime',
        bgmPreference: '轻快治愈',
        cameraMotion: '固定镜头',
      },
    },
    {
      kind: 'prompt', name: '爆款标题生成', description: '为成片批量生成吸睛标题',
      content: {
        template: '为视频《{title}》生成 10 个爆款标题，要求包含悬念、数字或情绪词，适配短视频平台。',
        variables: ['title'],
      },
    },
    {
      kind: 'prompt', name: '分镜扩写', description: '故事大纲 → 详细分镜脚本',
      content: {
        template: '将以下故事大纲扩写为详细分镜脚本，包含画面、运镜、台词与时长：\n{outline}',
        variables: ['outline'],
      },
    },
    {
      kind: 'export', name: '抖音竖版', description: 'B2 导出模板：抖音预设 + 1080P + 字幕',
      content: {
        presetKey: 'douyin',
        videoResolution: '1080P',
        includeSubtitles: true,
      },
    },
    {
      kind: 'export', name: 'B站横版', description: 'B2 导出模板：B站预设 + 1080P + 字幕',
      content: {
        presetKey: 'bilibili',
        videoResolution: '1080P',
        includeSubtitles: true,
      },
    },
    {
      kind: 'export', name: '通用横版', description: 'B2 导出模板：通用预设（默认）',
      content: {
        presetKey: 'generic',
      },
    },
  ];

  /** 幂等注入内置种子（缺失才创建，重复调用不重复） */
  async ensureBuiltinTemplates(): Promise<ContentTemplate[]> {
    const existing = await this.repo.query({});
    const have = new Set(existing.map(t => `${t.kind}|${t.name}`));
    const created: ContentTemplate[] = [];
    for (const b of this.builtins) {
      if (have.has(`${b.kind}|${b.name}`)) continue;
      const now = Date.now();
      const tpl: ContentTemplate = {
        id: generateId(),
        kind: b.kind,
        name: b.name,
        description: b.description,
        builtin: true,
        content: b.content,
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.save(tpl);
      created.push(tpl);
    }
    return created;
  }

  async createTemplate(input: CreateTemplateInput): Promise<ContentTemplate> {
    const now = Date.now();
    const tpl: ContentTemplate = {
      id: generateId(),
      kind: input.kind,
      name: input.name,
      description: input.description,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(tpl);
    return tpl;
  }

  async updateTemplate(id: string, patch: { name?: string; description?: string; content?: Record<string, unknown> }): Promise<ContentTemplate> {
    const tpl = await this.repo.getById(id);
    if (!tpl) throw new Error(`Template not found: ${id}`);
    const updated: ContentTemplate = { ...tpl, ...patch, updatedAt: Date.now() };
    await this.repo.save(updated);
    return updated;
  }

  /** 内置模板不可删除 */
  async deleteTemplate(id: string): Promise<void> {
    const tpl = await this.repo.getById(id);
    if (tpl?.builtin) throw new Error("内置模板不可删除");
    await this.repo.delete(id);
  }

  async listTemplates(kind?: TemplateKind): Promise<ContentTemplate[]> {
    return this.repo.query({ kind });
  }

  /** 按 kind 解析为可套用内容（缺字段抛错，避免静默错用） */
  resolve(tpl: ContentTemplate): Record<string, unknown> {
    if (tpl.kind === 'story_structure') {
      const beats = tpl.content.beats;
      if (!Array.isArray(beats) || beats.length === 0) throw new Error('分镜模板缺少 beats');
      return { beats: beats as TemplateBeat[] };
    }
    if (tpl.kind === 'prompt') {
      const template = tpl.content.template;
      if (typeof template !== 'string' || !template.trim()) throw new Error('提示词模板缺少 template');
      return { template, variables: Array.isArray(tpl.content.variables) ? tpl.content.variables as string[] : [] };
    }
    if (tpl.kind === 'style') {
      return {
        videoStyle: tpl.content.videoStyle,
        bgmPreference: tpl.content.bgmPreference,
        cameraMotion: tpl.content.cameraMotion,
      };
    }
    if (tpl.kind === 'export') {
      const presetKey = tpl.content.presetKey;
      if (presetKey !== 'generic' && presetKey !== 'douyin' && presetKey !== 'bilibili') throw new Error('导出模板缺少合法 presetKey');
      return {
        presetKey,
        videoResolution: tpl.content.videoResolution,
        includeSubtitles: tpl.content.includeSubtitles,
      };
    }
    return { ...tpl.content };
  }

  /** P3-4 提取内容中的变量占位符 {var}（递归扫描字符串，去重；与 prompt.variables 声明合并） */
  static extractVariables(content: Record<string, unknown>): string[] {
    const vars = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === "string") {
        const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(node)) !== null) vars.add(m[1]);
      } else if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else if (node && typeof node === "object") {
        for (const v of Object.values(node)) walk(v);
      }
    };
    walk(content);
    const declared = content.variables;
    if (Array.isArray(declared)) {
      for (const v of declared) if (typeof v === "string") vars.add(v);
    }
    return [...vars];
  }

  /** P3-4 替换变量占位符 {var} → 值（未提供的变量替换为空串；递归处理嵌套结构） */
  static applyContent(content: Record<string, unknown>, variables: Record<string, string>): Record<string, unknown> {
    const replace = (node: unknown): unknown => {
      if (typeof node === "string") {
        return node.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m: string, name: string) => variables[name] ?? "");
      }
      if (Array.isArray(node)) return node.map(replace);
      if (node && typeof node === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) out[k] = replace(v);
        return out;
      }
      return node;
    };
    return replace(content) as Record<string, unknown>;
  }

  /** P3-4 生成套用到工作台的创作草稿文本（分镜/提示词/风格/导出四类统一为可编辑文本） */
  static buildStoryDraft(tpl: ContentTemplate, content: Record<string, unknown>): string {
    if (tpl.kind === "story_structure") {
      const beats = content.beats as Array<{ name: string; description: string }>;
      if (!Array.isArray(beats)) return "";
      return beats.map((b, i) => (i + 1) + ". " + b.name + "：" + b.description).join("\n");
    }
    if (tpl.kind === "prompt") {
      return String(content.template ?? "");
    }
    if (tpl.kind === "style") {
      const lines: string[] = [];
      if (content.videoStyle) lines.push("画面风格：" + String(content.videoStyle));
      if (content.bgmPreference) lines.push("BGM 偏好：" + String(content.bgmPreference));
      if (content.cameraMotion) lines.push("运镜方式：" + String(content.cameraMotion));
      return lines.join("\n");
    }
    if (tpl.kind === "export") {
      const parts: string[] = [];
      if (content.presetKey) parts.push("导出预设：" + String(content.presetKey));
      if (content.videoResolution) parts.push(String(content.videoResolution));
      if (content.includeSubtitles === true) parts.push("含字幕");
      return parts.join(" · ");
    }
    return JSON.stringify(content, null, 2);
  }
}
