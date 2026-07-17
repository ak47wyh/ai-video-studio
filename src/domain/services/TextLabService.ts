import type {
  ITextGenerationPort,
  TextModel,
  TextGenerationMessage,
  TextStreamCallbacks,
  TextGenerationResult,
} from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry, TextModelCategory } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';

/**
 * 场景润色类型
 */
export type TextRefineScene =
  | 'script'          // 剧本润色
  | 'storyboard'      // 分镜描述
  | 'character'        // 角色刻画
  | 'scene'            // 场景描写
  | 'bgm_style'        // BGM 风格
  | 'prompt_optimize'; // 提示词优化

export type RefineStyle = 'concise' | 'standard' | 'detailed';

/** 场景润色 System Prompt 配置 */
const SCENE_PROMPTS: Record<TextRefineScene, { system: string; modelCategory: TextModelCategory; maxTokens: number; temperature: number }> = {
  script: {
    system: `你是一个专业的视频剧本编剧，擅长将故事文本润色为画面感强的视频剧本。

任务：将以下故事文本润色为更适合视频制作的版本。

要求：
- 增强画面感，让读者能"看到"场景
- 保留原始故事的核心内容和情节
- 适当增加环境描写和人物动作细节
- 语言简洁有力，适合旁白朗读
- 只输出润色后的文本，不要其他内容`,
    modelCategory: 'chat',
    maxTokens: 4096,
    temperature: 0.6,
  },
  storyboard: {
    system: `你是一个专业的视频分镜师，擅长将故事内容转化为精确的镜头描述。

任务：将以下内容转化为视频分镜描述。

要求：
- 使用英文输出
- 每个镜头包含：景别(Close-up/Medium/Wide)、镜头运动(Pan/Tilt/Tracking)、光线氛围、画面内容
- 格式：[Shot N] Type: | Motion: | Lighting: | Description:
- 只输出分镜描述，不要其他内容`,
    modelCategory: 'chat',
    maxTokens: 4096,
    temperature: 0.5,
  },
  character: {
    system: `你是一个专业的角色设计师，擅长将粗略描述细化为立体丰满的角色刻画。

任务：将以下角色描述细化为更专业、更有画面感的角色刻画。

要求：
- 包含：外貌特征、性格特点、行为习惯、语言风格
- 外貌部分使用英文输出（适合 AI 图像生成）
- 性格和行为部分使用中文输出
- 只输出角色刻画，不要其他内容`,
    modelCategory: 'recommendation',
    maxTokens: 2048,
    temperature: 0.7,
  },
  scene: {
    system: `你是一个专业的场景设计师，擅长将粗略场景描述转化为画面感强的环境描写。

任务：将以下场景描述润色为更专业、更有画面感的环境描写。

要求：
- 使用英文输出（AI 生成模型对英文提示词效果更好）
- 描述要具体、有细节
- 包含视觉元素：光线、色彩、构图、氛围
- 长度控制在 50-200 个英文单词
- 只输出润色后的提示词，不要其他内容`,
    modelCategory: 'recommendation',
    maxTokens: 512,
    temperature: 0.7,
  },
  bgm_style: {
    system: `你是一个专业的视频配乐师，擅长根据故事内容推荐合适的背景音乐风格。

任务：根据以下内容，推荐一个合适的背景音乐风格描述。

要求：
- 使用英文输出
- 描述应包含：音乐类型、情绪、节奏、乐器等
- 格式示例："Cinematic, Epic, Orchestral, Dark, Tension, Strings and Brass"
- 长度控制在 10-50 个英文单词
- 只输出风格描述，不要其他内容`,
    modelCategory: 'recommendation',
    maxTokens: 128,
    temperature: 0.8,
  },
  prompt_optimize: {
    system: `你是一个专业的 AI 提示词工程师，擅长将粗略描述润色为高质量的 AI 图像/视频生成提示词。

任务：将以下描述润色为更专业、更有画面感的 AI 生成提示词。

要求：
- 使用英文输出
- 描述要具体、有细节
- 包含视觉元素：光线、色彩、构图、氛围
- 长度控制在 50-200 个英文单词
- 只输出润色后的提示词，不要其他内容`,
    modelCategory: 'recommendation',
    maxTokens: 512,
    temperature: 0.7,
  },
};

/** 风格修饰词 */
const STYLE_MODIFIERS: Record<RefineStyle, string> = {
  concise: '\n\n额外要求：输出要简洁精炼，去除冗余，突出核心。',
  standard: '',
  detailed: '\n\n额外要求：输出要详尽细致，尽可能丰富描述细节和画面感。',
};

/**
 * 独立文本实验室服务，通过 PlatformRouter 动态解析 ITextGenerationPort。
 * 负责场景润色和流式对话。
 */
export class TextLabService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private modelRegistry: IModelRegistry;
  // @ts-expect-error Logger injected for future use
  private _logger: ILoggerPort;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    modelRegistry: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this._logger = logger;
    this.modelRegistry = modelRegistry;
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    const config = this.configStore.load();
    return this.router.resolve('text', config);
  }

  /**
   * 场景润色（非流式）
   */
  async refineByScene(
    scene: TextRefineScene,
    input: string,
    style: RefineStyle = 'standard',
    model?: TextModel,
  ): Promise<TextGenerationResult> {
    const config = SCENE_PROMPTS[scene];
    const systemContent = config.system + STYLE_MODIFIERS[style];
    const textPort = this.getTextPort();
    const resolvedModel = model || this.modelRegistry.resolveTextModel(config.modelCategory);

    return textPort.chatCompletion({
      model: resolvedModel,
      messages: [
        { role: 'system', content: systemContent, cache_control: { type: 'ephemeral' } },
        { role: 'user', content: input },
      ],
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      useAnthropicEndpoint: true,
    });
  }

  /**
   * 场景润色（流式）
   */
  refineBySceneStream(
    scene: TextRefineScene,
    input: string,
    style: RefineStyle,
    callbacks: TextStreamCallbacks,
    model?: TextModel,
  ): AbortController {
    const config = SCENE_PROMPTS[scene];
    const systemContent = config.system + STYLE_MODIFIERS[style];
    const textPort = this.getTextPort();
    const resolvedModel = model || this.modelRegistry.resolveTextModel(config.modelCategory);

    return textPort.chatCompletionStream({
      model: resolvedModel,
      messages: [
        { role: 'system', content: systemContent, cache_control: { type: 'ephemeral' } },
        { role: 'user', content: input },
      ],
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      useAnthropicEndpoint: true,
      thinking: this.supportsThinking(resolvedModel) ? { type: 'adaptive' } : undefined,
    }, callbacks);
  }

  /**
   * 自由对话（流式）
   */
  chatStream(
    messages: TextGenerationMessage[],
    callbacks: TextStreamCallbacks,
    options?: {
      model?: TextModel;
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      thinking?: boolean;
    },
  ): AbortController {
    const model = options?.model || this.modelRegistry.getDefaultTextModel() as TextModel;
    const textPort = this.getTextPort();

    return textPort.chatCompletionStream({
      model,
      messages,
      maxTokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      topP: options?.topP,
      useAnthropicEndpoint: true,
      thinking: options?.thinking && this.supportsThinking(model) ? { type: 'adaptive' } : undefined,
    }, callbacks);
  }

  /**
   * 非流式自由对话（兼容旧调用）
   */
  async chat(
    messages: TextGenerationMessage[],
    options?: {
      model?: TextModel;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<TextGenerationResult> {
    const textPort = this.getTextPort();
    return textPort.chatCompletion({
      model: options?.model || this.modelRegistry.getDefaultTextModel() as TextModel,
      messages,
      maxTokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      useAnthropicEndpoint: true,
    });
  }

  /**
   * 判断模型是否支持 Thinking 能力。
   * 通过 modelRegistry 查询当前平台的模型描述符。
   */
  private supportsThinking(model: TextModel): boolean {
    const models = this.modelRegistry.getPlatformTextModels();
    const descriptor = models.find(m => m.id === model);
    return descriptor?.thinking === 'adaptive';
  }
}