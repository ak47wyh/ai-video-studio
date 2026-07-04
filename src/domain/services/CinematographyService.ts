import type { ITextGenerationPort } from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort, ICostMeter } from '../ports/CrossCuttingPorts';
import type { StorySegment } from '../entities/models';
import type { PlatformRouter } from './PlatformRouter';

export type ShotType =
  | 'extreme-wide'    // EWS
  | 'wide'            // WS
  | 'medium-wide'     // MWS
  | 'medium'          // MS
  | 'medium-close'    // MCU
  | 'close-up'        // CU
  | 'extreme-close'   // ECU
  | 'over-shoulder'   // OTS
  | 'point-of-view';  // POV

export type CameraMovement =
  | 'static'          // 固定
  | 'pan'             // 水平摇
  | 'tilt'            // 垂直摇
  | 'zoom-in'         // 推
  | 'zoom-out'        // 拉
  | 'dolly'           // 移动
  | 'tracking'        // 跟拍
  | 'crane'           // 升降
  | 'handheld';       // 手持

export interface ShotSuggestion {
  shotType: ShotType;
  movement: CameraMovement;
  angle: 'low' | 'eye-level' | 'high' | 'overhead';
  durationSec: number;
  description: string;
  promptEnhancement: string;
}

const SHOT_DESCRIPTIONS: Record<ShotType, { cn: string; en: string; typicalDuration: number }> = {
  'extreme-wide': { cn: '极远景', en: 'Extreme wide shot', typicalDuration: 4 },
  'wide': { cn: '远景', en: 'Wide shot', typicalDuration: 4 },
  'medium-wide': { cn: '全景', en: 'Medium-wide shot', typicalDuration: 3 },
  'medium': { cn: '中景', en: 'Medium shot', typicalDuration: 3 },
  'medium-close': { cn: '中近景', en: 'Medium close-up', typicalDuration: 2.5 },
  'close-up': { cn: '近景/特写', en: 'Close-up', typicalDuration: 2 },
  'extreme-close': { cn: '极特写', en: 'Extreme close-up', typicalDuration: 1.5 },
  'over-shoulder': { cn: '过肩镜头', en: 'Over-the-shoulder', typicalDuration: 3 },
  'point-of-view': { cn: '主观视角', en: 'Point-of-view', typicalDuration: 2 },
};

const MOVEMENT_DESCRIPTIONS: Record<CameraMovement, string> = {
  static: '固定机位',
  pan: '水平摇摄',
  tilt: '垂直摇摄',
  'zoom-in': '缓慢推近',
  'zoom-out': '缓慢拉远',
  dolly: '平滑移动',
  tracking: '跟拍移动',
  crane: '升降拍摄',
  handheld: '手持晃动',
};

export class CinematographyService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private costMeter?: ICostMeter;
  private modelRegistry?: IModelRegistry;
  // @ts-expect-error Logger injected for future use
  private _logger: ILoggerPort;
  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    costMeter?: ICostMeter,
    modelRegistry?: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this._logger = logger;
    this.costMeter = costMeter;
    this.modelRegistry = modelRegistry;
  }

  /** 解析当前镜头建议任务应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveShotModel(): string {
    return this.modelRegistry?.resolveTextModel('recommendation') ?? 'MiniMax-M2.5';
  }

  /** 解析当前镜头翻译任务应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveTranslateModel(): string {
    return this.modelRegistry?.resolveTextModel('translation') ?? 'MiniMax-M2.5-highspeed';
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    return this.router.resolveText(this.configStore.load());
  }

  /**
   * Analyze a story segment and suggest the optimal camera shots.
   * Returns 2-3 shot suggestions to create a more dynamic video.
   */
  async suggestShots(segment: StorySegment, characterNames: string[]): Promise<ShotSuggestion[]> {
    const result = await this.getTextPort().chatCompletion({
      model: this.resolveShotModel(),
      messages: [
        {
          role: 'system',
          content: `你是专业摄影师。根据故事分镜内容，分析应该使用的镜头语言，输出 JSON 数组，每个镜头包含：
- shotType: extreme-wide/wide/medium-wide/medium/medium-close/close-up/extreme-close/over-shoulder/point-of-view
- movement: static/pan/tilt/zoom-in/zoom-out/dolly/tracking/crane/handheld
- angle: low/eye-level/high/overhead
- durationSec: 镜头时长(1-6)
- description: 镜头描述(20-40字)
- promptEnhancement: 给视频生成模型的提示词增强(20-50字英文)

返回 2-3 个分镜，建议避免连续使用相同镜头类型。考虑：
- 开场/场景转换用 wide/medium-wide
- 对话/情绪用 close-up/medium-close
- 动作场面用 tracking/dolly
- 心理描写用 extreme-close/POV

只输出 JSON 数组。`,
          cache_control: { type: 'ephemeral' }
        },
        {
          role: 'user',
          content: `分镜内容：${segment.content}\n涉及角色：${characterNames.join(', ')}`
        }
      ],
      temperature: 0.7,
      maxTokens: 1024,
      useAnthropicEndpoint: true,
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: this.resolveShotModel(),
      callType: 'cinematography',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    return this.parseShotSuggestions(result.content);
  }

  /**
   * Plan a complete storyboard with varied camera angles.
   * Returns an array of shot suggestions, one per segment.
   */
  async planStoryboard(segments: StorySegment[], characterNames: string[]): Promise<ShotSuggestion[][]> {
    const promises = segments.map(seg => this.suggestShots(seg, characterNames));
    return Promise.all(promises);
  }

  /**
   * Enhance a basic video prompt with cinematography details.
   */
  async enhancePromptWithShot(basePrompt: string, shot: ShotSuggestion): Promise<string> {
    const result = await this.getTextPort().chatCompletion({
      model: this.resolveTranslateModel(),
      messages: [
        {
          role: 'system',
          content: '你是专业视频提示词工程师。给定基础场景和镜头参数，生成增强的英文视频生成提示词。提示词应自然融入镜头语言，长度 30-80 词。'
        },
        {
          role: 'user',
          content: `基础场景：${basePrompt}\n镜头类型：${SHOT_DESCRIPTIONS[shot.shotType].en}\n运镜：${MOVEMENT_DESCRIPTIONS[shot.movement]}\n角度：${shot.angle}\n时长：${shot.durationSec}s`
        }
      ],
      temperature: 0.6,
      maxTokens: 256,
      useAnthropicEndpoint: true,
    });

    this.costMeter?.record({
      platform: this.configStore.load().activePlatform,
      model: this.resolveTranslateModel(),
      callType: 'cinematography',
      usage: result.usage
        ? {
            inputTokens: result.usage.promptTokens ?? 0,
            outputTokens: result.usage.completionTokens ?? 0,
            totalTokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
          }
        : undefined,
    });

    return result.content.trim();
  }

  /**
   * Get standard shot type description.
   */
  getShotDescription(shot: ShotType, language: 'cn' | 'en' = 'cn'): string {
    return SHOT_DESCRIPTIONS[shot][language];
  }

  /**
   * Get standard movement description.
   */
  getMovementDescription(movement: CameraMovement): string {
    return MOVEMENT_DESCRIPTIONS[movement];
  }

  /**
   * Get all shot type options.
   */
  getAllShotTypes(): ShotType[] {
    return Object.keys(SHOT_DESCRIPTIONS) as ShotType[];
  }

  /**
   * Get all movement options.
   */
  getAllMovements(): CameraMovement[] {
    return Object.keys(MOVEMENT_DESCRIPTIONS) as CameraMovement[];
  }

  private parseShotSuggestions(result: string): ShotSuggestion[] {
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return this.fallbackShots();
      const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
      return parsed.map(s => ({
        shotType: this.parseShotType(String(s.shotType)),
        movement: this.parseMovement(String(s.movement)),
        angle: this.parseAngle(String(s.angle)),
        durationSec: Number(s.durationSec) || 3,
        description: String(s.description || ''),
        promptEnhancement: String(s.promptEnhancement || ''),
      }));
    } catch {
      return this.fallbackShots();
    }
  }

  private parseShotType(s: string): ShotType {
    const valid: ShotType[] = ['extreme-wide', 'wide', 'medium-wide', 'medium', 'medium-close', 'close-up', 'extreme-close', 'over-shoulder', 'point-of-view'];
    return valid.includes(s as ShotType) ? s as ShotType : 'medium';
  }

  private parseMovement(s: string): CameraMovement {
    const valid: CameraMovement[] = ['static', 'pan', 'tilt', 'zoom-in', 'zoom-out', 'dolly', 'tracking', 'crane', 'handheld'];
    return valid.includes(s as CameraMovement) ? s as CameraMovement : 'static';
  }

  private parseAngle(s: string): 'low' | 'eye-level' | 'high' | 'overhead' {
    const valid: Array<'low' | 'eye-level' | 'high' | 'overhead'> = ['low', 'eye-level', 'high', 'overhead'];
    return valid.includes(s as 'low' | 'eye-level' | 'high' | 'overhead') ? s as 'low' | 'eye-level' | 'high' | 'overhead' : 'eye-level';
  }

  private fallbackShots(): ShotSuggestion[] {
    return [{
      shotType: 'medium',
      movement: 'static',
      angle: 'eye-level',
      durationSec: 3,
      description: '标准中景镜头',
      promptEnhancement: 'Medium shot, eye-level angle, static camera, natural lighting, cinematic composition',
    }];
  }
}
