/**
 * AgentService —— AI 创作代理（ReAct 工具循环）
 *
 * v2.0 重构（EVOLUTION_DESIGN.md §5.2）：
 *   - 从"单次文本对话"升级为"ReAct 工具循环"
 *   - 集成 ToolRegistry，可真实调用 13 个工具
 *   - 通过事件回调实时通知 UI 工具调用进度
 *   - 防死循环：最大循环次数 10
 *
 * ReAct 流程：
 *   user msg → LLM(thinking) → tool_calls → execute tools → append results → LLM → ...
 *   直到 LLM 不再返回 tool_calls 或达到最大循环次数
 */

import type { ITextGenerationPort, TextGenerationMessage, TextGenerationContext } from '../ports/OutboundPorts';
import type { IApiConfigStore, IModelRegistry } from '../ports/PlatformPorts';
import type { ILoggerPort } from '../ports/CrossCuttingPorts';
import type { PlatformRouter } from './PlatformRouter';
import { ToolRegistry, type ToolContext, type ToolEvent, type ToolResult } from './ToolRegistry';

// ==========================================
// 类型定义
// ==========================================

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** role='tool' 时的工具调用 ID */
  toolCallId?: string;
  /** role='tool' 时的工具名 */
  toolName?: string;
}

/** ReAct 循环事件回调 */
export interface ReActEventCallback {
  (event: ReActEvent): void;
}

export type ReActEvent =
  | { type: 'thinking'; content: string; iteration: number; timestamp: number }
  | { type: 'tool_calls'; toolCalls: Array<{ id: string; name: string; arguments: string }>; iteration: number; timestamp: number }
  | ToolEvent & { iteration: number }
  | { type: 'final_answer'; content: string; iteration: number; timestamp: number }
  | { type: 'max_iterations_reached'; iteration: number; timestamp: number }
  | { type: 'error'; error: string; iteration: number; timestamp: number };

export interface AgentChatOptions {
  /** 历史消息（不含 system） */
  messages: AgentMessage[];
  /** 当前工作空间 ID */
  spaceId: string;
  /** 当前故事 ID（可选，工具可作用于该故事） */
  storyId?: string;
  /** ReAct 事件回调（用于 UI 实时展示） */
  onEvent?: ReActEventCallback;
  /** 最大循环次数（默认 10） */
  maxIterations?: number;
  /** 单工具超时 ms（默认 60000） */
  toolTimeoutMs?: number;
}

export interface AgentChatResult {
  /** 最终回复内容 */
  content: string;
  /** 完整对话历史（含工具调用结果，可用于下一轮对话上下文） */
  fullMessages: AgentMessage[];
  /** 工具调用次数 */
  toolCallCount: number;
  /** 是否因达到最大循环次数而停止 */
  maxIterationsReached: boolean;
}

// ==========================================
// System Prompt
// ==========================================

const SYSTEM_PROMPT = `你是一个专业的 AI 视频创作助手，能够根据用户的自然语言指令，调用工具完成端到端视频创作任务。

可用工具清单（共 13 个）：
1. create_character - 创建角色（名称 + 外貌/性格描述）
2. update_character - 更新已有角色
3. create_background - 创建场景背景
4. update_background - 更新已有背景
5. split_story_to_segments - 将故事文本智能拆分为分镜（自动提取角色和场景）
6. generate_image - 生成图片
7. generate_video_prompt - 为分镜构建视频生成 prompt（含镜头语言）
8. generate_narration - 生成旁白音频
9. suggest_bgm_style - 推荐 BGM 风格
10. generate_video - 为分镜生成视频
11. apply_transition - 设置片段间转场效果
12. burn_subtitles - 标记需烧录字幕
13. mix_audio - 设置混音参数

工作原则：
- 收到用户指令后，分析需要执行的工具序列，分步调用
- 每次只返回必要的工具调用，避免一次调用过多工具
- 工具调用后，根据返回结果决定下一步动作
- 工具失败时，尝试其他方式或告知用户
- 完成所有工具调用后，用中文向用户汇报执行结果
- 如果用户只是闲聊或提问（不需要工具），直接回复

回复格式：
- 需要调用工具时，按工具调用协议返回
- 不需要工具时，直接返回中文文本`;

// ==========================================
// AgentService 主类
// ==========================================

export class AgentService {
  private router: PlatformRouter;
  private configStore: IApiConfigStore;
  private logger: ILoggerPort;
  private modelRegistry?: IModelRegistry;
  private toolRegistry: ToolRegistry | null = null;

  constructor(
    router: PlatformRouter,
    configStore: IApiConfigStore,
    logger: ILoggerPort,
    modelRegistry?: IModelRegistry,
  ) {
    this.router = router;
    this.configStore = configStore;
    this.logger = logger;
    this.modelRegistry = modelRegistry;
  }

  /** 解析当前对话应使用的模型 ID（M3.3：走 PlatformRouter） */
  private resolveChatModel(): string {
    return this.modelRegistry?.resolveTextModel('chat') ?? 'MiniMax-M3';
  }

  /** 注入 ToolRegistry（必须在使用 ReAct 循环前调用） */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    this.logger.info('ToolRegistry injected', {
      service: 'AgentService',
      method: 'setToolRegistry',
      toolCount: registry.listTools().length,
    });
  }

  /** 获取当前配置对应的文本生成适配器 */
  private getTextPort(): ITextGenerationPort {
    return this.router.resolveText(this.configStore.load());
  }

  /**
   * 兼容旧 API 的简单对话（无工具调用）
   * @deprecated 推荐使用 chatWithTools()
   */
  async chat(messages: AgentMessage[]): Promise<string> {
    this.logger.warn('AgentService.chat (legacy, no tools) called - consider chatWithTools()', {
      service: 'AgentService',
      method: 'chat',
    });

    const systemMessages: TextGenerationMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    const conversationMessages: TextGenerationMessage[] = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'user', content: `[tool=${m.toolName}] ${m.content}` };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    this.logger.info('AgentService.chat (legacy)', {
      service: 'AgentService',
      method: 'chat',
      messageCount: messages.length,
      lastUserMessage: messages.filter(m => m.role === 'user').pop()?.content?.slice(0, 100),
    });

    const result = await this.getTextPort().chatCompletion({
      model: this.resolveChatModel(),
      messages: [...systemMessages, ...conversationMessages],
      maxTokens: 4096,
      temperature: 0.7,
    });

    return result.content;
  }

  /**
   * ReAct 工具循环
   *
   * 流程：
   *   1. LLM 思考是否需要调用工具
   *   2. 若返回 tool_calls，依次执行每个工具
   *   3. 将工具结果作为 tool message 加入对话
   *   4. 重复 1-3，直到 LLM 不再返回 tool_calls 或达到 maxIterations
   *
   * @returns 最终回复 + 工具调用统计
   */
  async chatWithTools(options: AgentChatOptions): Promise<AgentChatResult> {
    if (!this.toolRegistry) {
      this.logger.warn('ToolRegistry not injected, fallback to plain chat', {
        service: 'AgentService',
        method: 'chatWithTools',
      });
      const content = await this.chat(options.messages);
      return {
        content,
        fullMessages: options.messages,
        toolCallCount: 0,
        maxIterationsReached: false,
      };
    }

    const maxIterations = options.maxIterations ?? 10;
    const toolTimeoutMs = options.toolTimeoutMs ?? 60000;
    const emit = (event: ReActEvent) => options.onEvent?.(event);

    // 构建工具描述传给 LLM
    const toolsForLLM = this.toolRegistry.listTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as Record<string, unknown>,
    }));

    // 构建完整消息列表（含 system）
    const fullMessages: AgentMessage[] = [...options.messages];
    let toolCallCount = 0;

    this.logger.info('chatWithTools start', {
      service: 'AgentService',
      method: 'chatWithTools',
      spaceId: options.spaceId,
      storyId: options.storyId,
      messageCount: options.messages.length,
      maxIterations,
      toolCount: toolsForLLM.length,
      lastUserMessage: options.messages.filter(m => m.role === 'user').pop()?.content?.slice(0, 100),
    });

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // 准备本次迭代的 LLM 输入
      const llmMessages: TextGenerationMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...fullMessages.map(m => {
          if (m.role === 'tool') {
            return { role: 'user', content: `[tool=${m.toolName}] ${m.content}` };
          }
          return { role: m.role as 'user' | 'assistant', content: m.content };
        }),
      ];

      const context: TextGenerationContext = {
        model: this.resolveChatModel(),
        messages: llmMessages,
        maxTokens: 4096,
        temperature: 0.7,
        tools: toolsForLLM,
      };

      // 调用 LLM
      let llmResult;
      try {
        llmResult = await this.getTextPort().chatCompletion(context);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        this.logger.error('LLM chatCompletion failed', e, {
          service: 'AgentService',
          method: 'chatWithTools',
          iteration,
        });
        emit({ type: 'error', error: errorMsg, iteration, timestamp: Date.now() });
        return {
          content: `抱歉，调用 AI 模型时出错：${errorMsg}`,
          fullMessages,
          toolCallCount,
          maxIterationsReached: false,
        };
      }

      // 将 assistant 回复加入历史
      fullMessages.push({ role: 'assistant', content: llmResult.content });

      // 检查是否有工具调用
      const toolCalls = llmResult.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        // 无工具调用，循环结束
        this.logger.info('chatWithTools final answer', {
          service: 'AgentService',
          method: 'chatWithTools',
          iteration,
          toolCallCount,
          contentLength: llmResult.content.length,
        });
        emit({
          type: 'final_answer',
          content: llmResult.content,
          iteration,
          timestamp: Date.now(),
        });
        return {
          content: llmResult.content,
          fullMessages,
          toolCallCount,
          maxIterationsReached: false,
        };
      }

      // 有工具调用，触发事件
      emit({
        type: 'tool_calls',
        toolCalls,
        iteration,
        timestamp: Date.now(),
      });

      this.logger.info('tool_calls received', {
        service: 'AgentService',
        method: 'chatWithTools',
        iteration,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map(t => t.name),
      });

      // 依次执行每个工具调用
      const toolCtx: ToolContext = {
        spaceId: options.spaceId,
        storyId: options.storyId,
        emit: (event) => emit({ ...event, iteration }),
      };

      for (const tc of toolCalls) {
        // 解析参数
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch (e) {
          this.logger.warn('tool args parse failed', {
            service: 'AgentService',
            method: 'chatWithTools',
            toolName: tc.name,
            rawArgs: tc.arguments,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // 执行工具（带超时）
        let result: ToolResult;
        try {
          result = await this.executeWithTimeout(
            () => this.toolRegistry!.execute(tc.name, parsedArgs, toolCtx),
            toolTimeoutMs,
          );
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          result = {
            success: false,
            error: errorMsg,
            summary: `工具执行超时或失败：${errorMsg}`,
          };
        }

        toolCallCount++;

        // 将工具结果加入对话历史
        fullMessages.push({
          role: 'tool',
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.summary,
        });

        this.logger.info('tool executed', {
          service: 'AgentService',
          method: 'chatWithTools',
          iteration,
          toolName: tc.name,
          success: result.success,
          summary: result.summary.slice(0, 200),
        });
      }
      // 继续下一轮迭代，让 LLM 看到工具结果后决定是否继续调用
    }

    // 达到最大循环次数
    this.logger.warn('max iterations reached', {
      service: 'AgentService',
      method: 'chatWithTools',
      maxIterations,
      toolCallCount,
    });
    emit({
      type: 'max_iterations_reached',
      iteration: maxIterations,
      timestamp: Date.now(),
    });

    return {
      content: `已达到最大工具调用循环次数（${maxIterations}），共调用了 ${toolCallCount} 次工具。如需继续，请重新描述需求。`,
      fullMessages,
      toolCallCount,
      maxIterationsReached: true,
    };
  }

  /** 带超时的工具执行 */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    if (timeoutMs <= 0) return fn();
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`tool execution timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  /**
   * 兼容旧 API：建议动作计划
   * @deprecated 推荐使用 chatWithTools()
   */
  async suggestActionPlan(userMessage: string): Promise<string[]> {
    this.logger.warn('suggestActionPlan (legacy) called - consider chatWithTools()', {
      service: 'AgentService',
      method: 'suggestActionPlan',
    });

    const result = await this.getTextPort().chatCompletion({
      model: this.resolveChatModel(),
      messages: [
        {
          role: 'system',
          content: '你是任务规划助手。用户描述创作意图，输出逗号分隔的工具名列表。示例：输入：生成关于森林里小女孩的故事视频 输出：create_character,create_background,split_story_to_segments,suggest_bgm_style,generate_narration,generate_video',
        },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 128,
      temperature: 0.3,
    });

    return result.content.trim().split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
  }
}
