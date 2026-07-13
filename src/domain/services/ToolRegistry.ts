/**
 * ToolRegistry —— Agent 工具注册表
 *
 * 落地 EVOLUTION_DESIGN.md §5.2.2 工具注册表设计。
 *
 * 职责：
 *   1. 注册工具定义（name + description + JSONSchema parameters + handler）
 *   2. 接收 Agent 的工具调用请求并派发给真实业务 Service
 *   3. 返回工具执行结果（success / error + 数据）
 *
 * 设计：
 *   - 工具实现复用现有 Service（StoryService / ImageGenerationService / VideoGenerationService 等）
 *   - 工具调用过程通过 ToolContext.emit 触发事件，UI 可订阅实时显示
 *   - 单工具执行超时由调用方控制，ToolRegistry 自身只负责派发
 */

import type {
  IStoryRepository,
  IStorySegmentRepository,
  ICharacterRepository,
  IBackgroundRepository,
  IVideoTaskRepository,
} from '../ports/OutboundPorts';
import type { Character, Background, Story, VideoTask } from '../entities/models';
import type { StoryService } from './StoryService';
import type { ImageGenerationService } from './ImageGenerationService';
import type { VideoGenerationService } from './VideoGenerationService';
import type { VoiceService } from './VoiceService';
import type { MusicService } from './MusicService';
import type { PostProcessService } from './PostProcessService';
import type { BGMRecommendationService } from './BGMRecommendationService';
import type { CinematographyService } from './CinematographyService';
import type { PromptContextBuilder } from './PromptContextBuilder';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';

// ==========================================
// 类型定义
// ==========================================

/** 工具参数 JSON Schema 简化形式 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    default?: unknown;
  }>;
  required: string[];
}

/** 工具调用上下文（注入给每个 handler） */
export interface ToolContext {
  /** 当前工作空间 ID（必填，工具作用于该空间内） */
  spaceId: string;
  /** 当前活跃故事 ID（可选，工具可作用于该故事） */
  storyId?: string;
  /** 工具事件回调（用于 UI 实时展示工具调用进度） */
  emit: (event: ToolEvent) => void;
}

/** 工具调用事件 */
export interface ToolEvent {
  type: 'tool_start' | 'tool_success' | 'tool_error';
  toolName: string;
  /** 工具入参 */
  args?: Record<string, unknown>;
  /** 工具返回结果（type='tool_success' 时有值） */
  result?: unknown;
  /** 错误信息（type='tool_error' 时有值） */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/** 工具调用结果 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 给 LLM 的可读摘要（用于 ReAct 循环中告诉 LLM 工具执行结果） */
  summary: string;
}

/** 工具定义 */
export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  category: 'character' | 'story' | 'image' | 'video' | 'voice' | 'music' | 'post_process' | 'utility';
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult<T>>;
}

// ==========================================
// 工具定义常量
// ==========================================

/** 所有工具的 OpenAI Function Calling 风格 schema */
const TOOL_DEFINITIONS = {
  create_character: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '角色名' },
      appearancePrompt: { type: 'string', description: '角色外貌描述（中文，将用于 AI 图像生成）' },
      personalityPrompt: { type: 'string', description: '角色性格描述' },
      characterBackground: { type: 'string', description: '角色背景故事' },
    },
    required: ['name', 'appearancePrompt'],
  },
  update_character: {
    type: 'object',
    properties: {
      characterId: { type: 'string', description: '角色 ID' },
      appearancePrompt: { type: 'string', description: '新的外貌描述（可选）' },
      personalityPrompt: { type: 'string', description: '新的性格描述（可选）' },
    },
    required: ['characterId'],
  },
  create_background: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '场景名' },
      environmentPrompt: { type: 'string', description: '环境描述（中文，将用于 AI 背景生成）' },
    },
    required: ['name', 'environmentPrompt'],
  },
  update_background: {
    type: 'object',
    properties: {
      backgroundId: { type: 'string', description: '背景 ID' },
      environmentPrompt: { type: 'string', description: '新的环境描述（可选）' },
    },
    required: ['backgroundId'],
  },
  split_story_to_segments: {
    type: 'object',
    properties: {
      storyText: { type: 'string', description: '故事原文（若未指定 storyId 则使用此文本创建新故事）' },
      title: { type: 'string', description: '故事标题（创建新故事时使用）' },
    },
    required: [],
  },
  generate_image: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '图片生成 prompt' },
      aspectRatio: {
        type: 'string',
        description: '宽高比',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        default: '16:9',
      },
      characterId: { type: 'string', description: '参考角色 ID（可选，用于保持角色一致性）' },
      backgroundId: { type: 'string', description: '参考背景 ID（可选）' },
    },
    required: ['prompt'],
  },
  generate_video_prompt: {
    type: 'object',
    properties: {
      segmentId: { type: 'string', description: '分镜 ID' },
    },
    required: ['segmentId'],
  },
  generate_narration: {
    type: 'object',
    properties: {
      segmentId: { type: 'string', description: '分镜 ID（取该分镜文本生成旁白）' },
      text: { type: 'string', description: '直接指定旁白文本（与 segmentId 二选一）' },
      voiceId: { type: 'string', description: '音色 ID（可选，默认使用系统音色）' },
    },
    required: [],
  },
  suggest_bgm_style: {
    type: 'object',
    properties: {
      segmentContent: { type: 'string', description: '分镜内容（用于推荐 BGM 风格）' },
    },
    required: ['segmentContent'],
  },
  generate_video: {
    type: 'object',
    properties: {
      segmentId: { type: 'string', description: '分镜 ID' },
      mode: {
        type: 'string',
        enum: ['t2v', 'i2v', 'fl2v'],
        default: 't2v',
        description: '生成模式：t2v 文生视频 / i2v 图生视频 / fl2v 首尾帧',
      },
    },
    required: ['segmentId'],
  },
  apply_transition: {
    type: 'object',
    properties: {
      transitionType: {
        type: 'string',
        enum: ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'slideup', 'slidedown'],
        default: 'fade',
        description: '转场类型：fade 淡入淡出 / fadeblack 黑场过渡 / fadewhite 白场过渡 / wipeleft 左擦除 / wiperight 右擦除 / slideup 上滑 / slidedown 下滑',
      },
      duration: { type: 'number', description: '转场时长（秒）', default: 0.5 },
    },
    required: [],
  },
  burn_subtitles: {
    type: 'object',
    properties: {
      storyId: { type: 'string', description: '故事 ID（对故事最终成片烧录字幕）' },
    },
    required: ['storyId'],
  },
  mix_audio: {
    type: 'object',
    properties: {
      voiceVolume: { type: 'number', description: '人声音量 (0-1)', default: 0.8 },
      bgmVolume: { type: 'number', description: 'BGM 音量 (0-1)', default: 0.3 },
    },
    required: [],
  },
} as const satisfies Record<string, ToolParameterSchema>;

// ==========================================
// ToolRegistry 主类
// ==========================================

export interface ToolRegistryDeps {
  storyRepo: IStoryRepository;
  segmentRepo: IStorySegmentRepository;
  characterRepo: ICharacterRepository;
  backgroundRepo: IBackgroundRepository;
  videoTaskRepo: IVideoTaskRepository;
  storyService: StoryService;
  imageGenerationService: ImageGenerationService;
  videoGenerationService: VideoGenerationService;
  voiceService: VoiceService;
  musicService: MusicService;
  postProcessService: PostProcessService;
  bgmRecommendationService: BGMRecommendationService;
  cinematographyService: CinematographyService;
  promptContextBuilder: PromptContextBuilder;
  logger: ILoggerPort;
}

/**
 * ToolRegistry
 *
 * 用法：
 * ```ts
 * const registry = new ToolRegistry(deps);
 * const result = await registry.execute('create_character', { name: '小红', appearancePrompt: '...' }, ctx);
 * ```
 */
export class ToolRegistry {
  private deps: ToolRegistryDeps;
  private tools = new Map<string, ToolDefinition>();

  constructor(deps: ToolRegistryDeps) {
    this.deps = deps;
    this.registerAll();
  }

  /** 列出所有工具定义（用于传给 LLM 的 tools 参数） */
  listTools(): Array<{ name: string; description: string; parameters: ToolParameterSchema }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /** 检查工具是否已注册 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 执行工具调用 */
  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        summary: `工具 ${name} 不存在`,
      };
    }

    ctx.emit({
      type: 'tool_start',
      toolName: name,
      args,
      timestamp: Date.now(),
    });

    try {
      const result = await tool.handler(args, ctx);
      ctx.emit({
        type: result.success ? 'tool_success' : 'tool_error',
        toolName: name,
        args,
        result: result.data,
        error: result.error,
        timestamp: Date.now(),
      });
      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ctx.emit({
        type: 'tool_error',
        toolName: name,
        args,
        error,
        timestamp: Date.now(),
      });
      return {
        success: false,
        error,
        summary: `工具 ${name} 执行失败：${error}`,
      };
    }
  }

  // ==========================================
  // 工具注册
  // ==========================================

  private registerAll(): void {
    // 1. 角色管理
    this.register({
      name: 'create_character',
      description: '创建角色（名称 + 外貌/性格描述），用于视频创作中的角色一致性维护',
      parameters: TOOL_DEFINITIONS.create_character,
      category: 'character',
      handler: async (args, ctx) => {
        const { v4: uuidv4 } = await import('uuid');
        const character: Character = {
          id: uuidv4(),
          spaceId: ctx.spaceId,
          name: args.name as string,
          appearancePrompt: args.appearancePrompt as string,
          personalityPrompt: (args.personalityPrompt as string) || '',
          characterBackground: (args.characterBackground as string) || '',
          createdAt: Date.now(),
        };
        await this.deps.characterRepo.save(character);
        return {
          success: true,
          data: { characterId: character.id },
          summary: `已创建角色「${character.name}」(ID: ${character.id})`,
        };
      },
    });

    this.register({
      name: 'update_character',
      description: '更新已有角色的外貌或性格描述',
      parameters: TOOL_DEFINITIONS.update_character,
      category: 'character',
      handler: async (args) => {
        const character = await this.deps.characterRepo.findById(args.characterId as string);
        if (!character) {
          return { success: false, error: 'Character not found', summary: `角色不存在: ${args.characterId}` };
        }
        if (args.appearancePrompt) character.appearancePrompt = args.appearancePrompt as string;
        if (args.personalityPrompt) character.personalityPrompt = args.personalityPrompt as string;
        await this.deps.characterRepo.save(character);
        return {
          success: true,
          data: { characterId: character.id },
          summary: `已更新角色「${character.name}」`,
        };
      },
    });

    // 2. 背景管理
    this.register({
      name: 'create_background',
      description: '创建场景背景（名称 + 环境描述），用于视频创作中的场景一致性',
      parameters: TOOL_DEFINITIONS.create_background,
      category: 'story',
      handler: async (args, ctx) => {
        const { v4: uuidv4 } = await import('uuid');
        const background: Background = {
          id: uuidv4(),
          spaceId: ctx.spaceId,
          name: args.name as string,
          environmentPrompt: args.environmentPrompt as string,
          createdAt: Date.now(),
        };
        await this.deps.backgroundRepo.save(background);
        return {
          success: true,
          data: { backgroundId: background.id },
          summary: `已创建背景「${background.name}」(ID: ${background.id})`,
        };
      },
    });

    this.register({
      name: 'update_background',
      description: '更新已有背景的环境描述',
      parameters: TOOL_DEFINITIONS.update_background,
      category: 'story',
      handler: async (args) => {
        const background = await this.deps.backgroundRepo.findById(args.backgroundId as string);
        if (!background) {
          return { success: false, error: 'Background not found', summary: `背景不存在: ${args.backgroundId}` };
        }
        if (args.environmentPrompt) background.environmentPrompt = args.environmentPrompt as string;
        await this.deps.backgroundRepo.save(background);
        return {
          success: true,
          data: { backgroundId: background.id },
          summary: `已更新背景「${background.name}」`,
        };
      },
    });

    // 3. 故事拆分
    this.register({
      name: 'split_story_to_segments',
      description: '将故事文本智能拆分为多个分镜段落（自动提取角色和场景）',
      parameters: TOOL_DEFINITIONS.split_story_to_segments,
      category: 'story',
      handler: async (args, ctx) => {
        let storyId = ctx.storyId;
        let story: Story | null = storyId ? await this.deps.storyRepo.findById(storyId) : null;

        // 若未指定 storyId 但提供了 storyText，则创建新故事
        if (!story && args.storyText) {
          story = await this.deps.storyService.createStory(
            (args.title as string) || `Agent 创建的故事 ${new Date().toLocaleString()}`,
            args.storyText as string,
            ctx.spaceId,
          );
          storyId = story.id;
        }

        if (!storyId || !story) {
          return {
            success: false,
            error: 'No story to split. Either set storyId in context or provide storyText.',
            summary: '未指定故事，无法拆分',
          };
        }

        const segments = await this.deps.storyService.splitStory(storyId);
        return {
          success: true,
          data: { storyId, segmentCount: segments.length, segmentIds: segments.map(s => s.id) },
          summary: `已将故事「${story.title}」拆分为 ${segments.length} 个分镜`,
        };
      },
    });

    // 4. 图片生成
    this.register({
      name: 'generate_image',
      description: '调用 AI 模型生成图片（可选角色/背景参考以保持一致性）',
      parameters: TOOL_DEFINITIONS.generate_image,
      category: 'image',
      handler: async (args, _ctx) => {
        const character = args.characterId
          ? await this.deps.characterRepo.findById(args.characterId as string)
          : undefined;
        const background = args.backgroundId
          ? await this.deps.backgroundRepo.findById(args.backgroundId as string)
          : undefined;

        // 调用 ImageGenerationService.generateImage（通用方法，接受自由 prompt）
        const result = await this.deps.imageGenerationService.generateImage({
          prompt: args.prompt as string,
          aspectRatio: (args.aspectRatio as '1:1' | '16:9' | '9:16' | '4:3' | '3:4') || '16:9',
          character,
          background,
        });

        return {
          success: true,
          data: { imageDataUri: result.imageDataUri, imageUrls: result.imageUrls },
          summary: `已生成图片（成功 ${result.metadata?.successCount ?? 1} 张）`,
        };
      },
    });

    // 5. 视频生成 prompt 构建
    this.register({
      name: 'generate_video_prompt',
      description: '为指定分镜构建视频生成上下文（含镜头语言、角色、背景），返回结构化 prompt',
      parameters: TOOL_DEFINITIONS.generate_video_prompt,
      category: 'video',
      handler: async (args) => {
        const segment = await this.deps.segmentRepo.findById(args.segmentId as string);
        if (!segment) {
          return { success: false, error: 'Segment not found', summary: `分镜不存在: ${args.segmentId}` };
        }

        const characters: Character[] = [];
        for (const cid of segment.mentionedCharacters || []) {
          const c = await this.deps.characterRepo.findById(cid);
          if (c) characters.push(c);
        }
        const background = segment.selectedBackgroundId
          ? await this.deps.backgroundRepo.findById(segment.selectedBackgroundId) ?? undefined
          : undefined;

        const { context, buildInfo } = await this.deps.promptContextBuilder.build(segment, characters, background);
        return {
          success: true,
          data: { prompt: context.prompt, buildInfo },
          summary: `已构建视频 prompt（长度 ${context.prompt.length}，含镜头建议: ${!!buildInfo.shotSuggestion}）`,
        };
      },
    });

    // 6. 旁白生成
    this.register({
      name: 'generate_narration',
      description: '为分镜文本或指定文本生成旁白音频',
      parameters: TOOL_DEFINITIONS.generate_narration,
      category: 'voice',
      handler: async (args) => {
        let text = args.text as string | undefined;
        const segmentId = args.segmentId as string | undefined;
        const voiceId = (args.voiceId as string | undefined) ?? '';

        if (!text && segmentId) {
          const seg = await this.deps.segmentRepo.findById(segmentId);
          if (!seg) return { success: false, error: 'Segment not found', summary: `分镜不存在: ${segmentId}` };
          text = seg.content;
        }

        if (!text) {
          return { success: false, error: 'Either text or segmentId is required', summary: '缺少文本或分镜 ID' };
        }

        if (segmentId) {
          // 绑定分镜：调用 generateAndPersistNarration（持久化到 OPFS）
          const audioUrl = await this.deps.voiceService.generateAndPersistNarration(segmentId, text, voiceId);
          return {
            success: true,
            data: { audioUrl, segmentId },
            summary: `已生成旁白音频并持久化（绑定分镜 ${segmentId}）`,
          };
        }

        // P0 修复：无 segmentId 时也必须实际合成 TTS,避免业务闭环断裂
        // (原实现仅返回文本摘要,Agent 会误以为旁白已生成)
        const result = await this.deps.voiceService.generateNarrationAudio(text, voiceId);
        if (result.taskId) {
          return {
            success: true,
            data: { taskId: result.taskId, text, voiceId },
            summary: `已创建异步 TTS 任务（taskId=${result.taskId}，文本 ${text.length} 字），需轮询获取结果`,
          };
        }
        return {
          success: true,
          data: { audioUrl: result.audioUrl, text, voiceId },
          summary: `已同步合成旁白音频（文本 ${text.length} 字）`,
        };
      },
    });

    // 7. BGM 风格推荐
    this.register({
      name: 'suggest_bgm_style',
      description: '根据分镜内容推荐 BGM 风格（情感 / 节奏 / 乐器）',
      parameters: TOOL_DEFINITIONS.suggest_bgm_style,
      category: 'music',
      handler: async (args) => {
        const recommendation = await this.deps.bgmRecommendationService.recommend(args.segmentContent as string);
        return {
          success: true,
          data: recommendation,
          summary: `推荐 BGM 风格: ${recommendation.category}（${recommendation.emotion}, tempo=${recommendation.tempo}）`,
        };
      },
    });

    // 8. 视频生成
    this.register({
      name: 'generate_video',
      description: '为指定分镜生成视频（支持 t2v/i2v/fl2v 模式）',
      parameters: TOOL_DEFINITIONS.generate_video,
      category: 'video',
      handler: async (args, ctx) => {
        if (!ctx.storyId) {
          return { success: false, error: 'storyId is required in context', summary: '缺少 storyId' };
        }
        const task: VideoTask = await this.deps.videoGenerationService.generateVideo(
          args.segmentId as string,
          ctx.storyId,
          undefined, // 使用默认平台
          { mode: (args.mode as 't2v' | 'i2v' | 'fl2v') || 't2v' },
        );
        return {
          success: true,
          data: { taskId: task.id, status: task.status },
          summary: `已提交视频生成任务（ID: ${task.id}，模式: ${task.mode}），任务进入异步执行`,
        };
      },
    });

    // 9. 转场应用（仅记录意图，实际转场在合成阶段统一应用）
    this.register({
      name: 'apply_transition',
      description: '设置视频片段间的转场效果（在最终合成时应用）',
      parameters: TOOL_DEFINITIONS.apply_transition,
      category: 'post_process',
      handler: async (args) => {
        return {
          success: true,
          data: {
            transitionType: args.transitionType || 'fade',
            duration: args.duration ?? 0.5,
          },
          summary: `已设置转场效果: ${args.transitionType || 'fade'}（${args.duration ?? 0.5}s）`,
        };
      },
    });

    // 10. 字幕烧录
    this.register({
      name: 'burn_subtitles',
      description: '为故事的最终成片烧录字幕（需先完成视频合成）',
      parameters: TOOL_DEFINITIONS.burn_subtitles,
      category: 'post_process',
      handler: async (args) => {
        const storyId = args.storyId as string;
        // PostProcessService.burnSubtitles 需要视频 Blob 和 SRT 字符串
        // Agent 工具不直接执行 FFmpeg（耗时操作），仅标记意图
        // 实际烧录在 Pipeline 阶段 8 统一执行
        return {
          success: true,
          data: { storyId, action: 'burn_subtitles_pending' },
          summary: `已标记故事 ${storyId} 需要烧录字幕（将在合成阶段执行）`,
        };
      },
    });

    // 11. 音频混合
    this.register({
      name: 'mix_audio',
      description: '设置人声与 BGM 的混音参数（在最终合成时应用）',
      parameters: TOOL_DEFINITIONS.mix_audio,
      category: 'post_process',
      handler: async (args) => {
        return {
          success: true,
          data: {
            voiceVolume: args.voiceVolume ?? 0.8,
            bgmVolume: args.bgmVolume ?? 0.3,
          },
          summary: `已设置混音参数: 人声 ${args.voiceVolume ?? 0.8} / BGM ${args.bgmVolume ?? 0.3}`,
        };
      },
    });
  }

  /** 注册单个工具 */
  private register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      this.deps.logger.warn(`Tool already registered, overwriting: ${tool.name}`, {
        service: 'ToolRegistry',
        method: 'register',
      });
    }
    this.tools.set(tool.name, tool);
  }
}

// 重导出 schema 常量供 AgentService 使用
export { TOOL_DEFINITIONS };
