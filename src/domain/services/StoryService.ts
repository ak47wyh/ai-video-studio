import { v4 as uuidv4 } from 'uuid';
import type { Story, StorySegment, Character, Background } from '../entities/models';
import type {
  IStoryRepository,
  IStorySegmentRepository,
  ITextSplitterPort,
  ICharacterRepository,
  IVideoTaskRepository,
  IBackgroundRepository,
  IStoryBreakdownPort,
  StoryBreakdownResult,
  CharacterDraft,
  BackgroundDraft,
  BreakdownSegmentDraft
} from '../ports/OutboundPorts';
import type { IUnitOfWorkPort } from '../ports/TransactionPorts';
import type { ILoggerPort, LogContext } from '../ports/CrossCuttingPorts';

/**
 * StoryService —— 故事/分镜编排服务。
 *
 * Phase 7 日志补齐：注入 ILoggerPort，对 Top 10 公共方法记录入参/出参摘要，
 * 满足"所有接口出入参数都通过日志打印出来"的审计要求。
 *
 * 关键设计决策：
 *   - debug 级别记录入参（避免生产噪音）；info 级别记录出参摘要
 *   - 不记录原始文本全文（可能很长），仅记录长度
 *   - 异常路径走 warn/error 级别
 */
export class StoryService {
  private storyRepo: IStoryRepository;
  private segmentRepo: IStorySegmentRepository;
  private characterRepo: ICharacterRepository;
  private backgroundRepo: IBackgroundRepository;
  private textSplitterPort: ITextSplitterPort;
  private storyBreakdownPort: IStoryBreakdownPort;
  private videoTaskRepo: IVideoTaskRepository;
  private unitOfWork: IUnitOfWorkPort | null;
  private logger: ILoggerPort;

  constructor(
    storyRepo: IStoryRepository,
    segmentRepo: IStorySegmentRepository,
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    textSplitterPort: ITextSplitterPort,
    storyBreakdownPort: IStoryBreakdownPort,
    videoTaskRepo: IVideoTaskRepository,
    logger: ILoggerPort,
    unitOfWork: IUnitOfWorkPort | null = null
  ) {
    this.storyRepo = storyRepo;
    this.segmentRepo = segmentRepo;
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.textSplitterPort = textSplitterPort;
    this.storyBreakdownPort = storyBreakdownPort;
    this.videoTaskRepo = videoTaskRepo;
    this.logger = logger;
    this.unitOfWork = unitOfWork;
  }

  /** 统一上下文工厂：附加 service 字段，便于日志聚合过滤 */
  private ctx(extra: LogContext = {}): LogContext {
    return { service: 'StoryService', ...extra };
  }

  async createStory(title: string, originalText: string, spaceId: string): Promise<Story> {
    this.logger.debug('createStory called', this.ctx({ title, originalTextLength: originalText.length, spaceId }));
    const story: Story = {
      id: uuidv4(),
      spaceId,
      title,
      originalText,
      status: 'DRAFT',
      createdAt: Date.now()
    };
    await this.storyRepo.save(story);
    this.logger.info('createStory done', this.ctx({ storyId: story.id, title }));
    return story;
  }

  async updateStory(storyId: string, title: string, originalText: string): Promise<void> {
    this.logger.debug('updateStory called', this.ctx({ storyId, title, originalTextLength: originalText.length }));
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      this.logger.warn('updateStory: story not found', this.ctx({ storyId }));
      throw new Error('Story not found');
    }
    story.title = title;
    story.originalText = originalText;
    // Reset to DRAFT if content changed and story was already split
    if (story.status === 'SPLIT') {
      story.status = 'DRAFT';
    }
    await this.storyRepo.save(story);
    this.logger.info('updateStory done', this.ctx({ storyId, status: story.status }));
  }

  async splitStory(storyId: string): Promise<StorySegment[]> {
    this.logger.debug('splitStory called', this.ctx({ storyId }));
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      this.logger.warn('splitStory: story not found', this.ctx({ storyId }));
      throw new Error('Story not found');
    }

    const characters = await this.characterRepo.findBySpaceId(story.spaceId);
    const characterNames = characters.map(c => c.name);

    const drafts = await this.textSplitterPort.splitStoryToSegments(story.originalText, characterNames);

    const segments: StorySegment[] = drafts.map((draft, index) => {
      const mentionedCharacterIds = draft.mentionedCharacters
        .map(name => characters.find(c => c.name === name)?.id)
        .filter((id): id is string => !!id);

      return {
        id: uuidv4(),
        storyId: story.id,
        sequenceOrder: index,
        content: draft.content,
        mentionedCharacters: mentionedCharacterIds
      };
    });

    const existingSegments = await this.segmentRepo.findByStoryId(story.id);
    if (existingSegments.length > 0) {
      const existingSegmentIds = existingSegments.map(s => s.id);
      await this.videoTaskRepo.deleteBySegmentIds(existingSegmentIds);
      await this.segmentRepo.deleteByStoryId(story.id);
    }

    for (const segment of segments) {
      await this.segmentRepo.save(segment);
    }

    story.status = 'SPLIT';
    await this.storyRepo.save(story);

    this.logger.info('splitStory done', this.ctx({ storyId, segmentCount: segments.length, characterCount: characters.length }));
    return segments;
  }

  /**
   * Preview breakdown: call AI to extract characters/backgrounds/segments
   * but do NOT save anything — return drafts for user to edit.
   */
  async previewBreakdown(storyId: string): Promise<StoryBreakdownResult> {
    this.logger.debug('previewBreakdown called', this.ctx({ storyId }));
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      this.logger.warn('previewBreakdown: story not found', this.ctx({ storyId }));
      throw new Error('Story not found');
    }
    const result = await this.storyBreakdownPort.breakdownStory(story.originalText);
    this.logger.info('previewBreakdown done', this.ctx({
      storyId,
      characterCount: result.characters?.length ?? 0,
      backgroundCount: result.backgrounds?.length ?? 0,
      segmentCount: result.segments?.length ?? 0,
    }));
    return result;
  }

  /**
   * Apply breakdown: save user-edited characters, backgrounds, and segments.
   * - Existing same-name characters/backgrounds are reused (not overwritten).
   * - Previous segments & video tasks for this story are deleted and rebuilt.
   * - P0 修复：当 unitOfWork 注入时，整个「先删后建」流程在单事务内完成，
   *   任一步骤失败自动回滚，避免旧数据已删 / 新数据未建的数据丢失。
   */
  async applyBreakdown(
    storyId: string,
    characters: CharacterDraft[],
    backgrounds: BackgroundDraft[],
    segments: BreakdownSegmentDraft[]
  ): Promise<{ savedCharacterIds: string[]; savedBackgroundIds: string[] }> {
    this.logger.debug('applyBreakdown called', this.ctx({
      storyId,
      characterDrafts: characters.length,
      backgroundDrafts: backgrounds.length,
      segmentDrafts: segments.length,
      useTransaction: !!this.unitOfWork,
    }));
    const story = await this.storyRepo.findById(storyId);
    if (!story) {
      this.logger.warn('applyBreakdown: story not found', this.ctx({ storyId }));
      throw new Error('Story not found');
    }

    // P0 修复：优先使用事务保证「先删后建」的原子性。
    // unitOfWork 未注入时（如单测）回退到原顺序执行逻辑。
    const result = this.unitOfWork
      ? await this.applyBreakdownInTransaction(story, characters, backgrounds, segments)
      : await this.applyBreakdownLegacy(story, characters, backgrounds, segments);

    this.logger.info('applyBreakdown done', this.ctx({
      storyId,
      savedCharacters: result.savedCharacterIds.length,
      savedBackgrounds: result.savedBackgroundIds.length,
    }));
    return result;
  }

  /**
   * P0 修复：事务版 applyBreakdown。
   * 整个「删旧 segments+videoTasks → 建新 characters/backgrounds/segments → 更新 story.status」
   * 在单事务内完成，任一步骤抛错自动回滚。
   */
  private async applyBreakdownInTransaction(
    story: Story,
    characters: CharacterDraft[],
    backgrounds: BackgroundDraft[],
    segments: BreakdownSegmentDraft[]
  ): Promise<{ savedCharacterIds: string[]; savedBackgroundIds: string[] }> {
    return this.unitOfWork!.transaction(
      ['segments', 'videoTasks', 'characters', 'backgrounds', 'stories'],
      async (tx) => {
        // Step 1: 在事务内删除旧 segments & video tasks
        const existingSegments = await tx.segments.where('storyId').equals(story.id).toArray();
        if (existingSegments.length > 0) {
          const existingSegmentIds = existingSegments.map(s => s.id);
          await tx.videoTasks.where('segmentId').in(existingSegmentIds).delete();
          for (const segId of existingSegmentIds) {
            await tx.segments.delete(segId);
          }
        }

        // Step 2: 在事务内查询并保存 characters
        const existingCharacters = await tx.characters.where('spaceId').equals(story.spaceId).toArray();
        const existingCharByName = new Map(existingCharacters.map(c => [c.name, c]));
        const savedCharacterIds: string[] = [];
        const characterNameToId = new Map<string, string>();
        for (const draft of characters) {
          const existing = existingCharByName.get(draft.name);
          if (existing) {
            let needsUpdate = false;
            if (draft.referenceImageUrl && !existing.referenceImageUrl) {
              existing.referenceImageUrl = draft.referenceImageUrl;
              needsUpdate = true;
            }
            if (draft.voiceId && !existing.voiceId) {
              existing.voiceId = draft.voiceId;
              needsUpdate = true;
            }
            if (needsUpdate) {
              await tx.characters.save(existing);
            }
            savedCharacterIds.push(existing.id);
            characterNameToId.set(draft.name, existing.id);
          } else {
            const character: Character = {
              id: uuidv4(),
              spaceId: story.spaceId,
              name: draft.name,
              appearancePrompt: draft.appearancePrompt,
              personalityPrompt: draft.personalityPrompt,
              characterBackground: draft.characterBackground,
              referenceImageUrl: draft.referenceImageUrl,
              voiceId: draft.voiceId,
              createdAt: Date.now()
            };
            await tx.characters.save(character);
            savedCharacterIds.push(character.id);
            characterNameToId.set(draft.name, character.id);
          }
        }

        // Step 3: 在事务内查询并保存 backgrounds
        const existingBackgrounds = await tx.backgrounds.where('spaceId').equals(story.spaceId).toArray();
        const existingBgByName = new Map(existingBackgrounds.map(b => [b.name, b]));
        const savedBackgroundIds: string[] = [];
        const backgroundNameToId = new Map<string, string>();
        for (const draft of backgrounds) {
          const existing = existingBgByName.get(draft.name);
          if (existing) {
            if (draft.referenceImageUrl && !existing.referenceImageUrl) {
              existing.referenceImageUrl = draft.referenceImageUrl;
              await tx.backgrounds.save(existing);
            }
            savedBackgroundIds.push(existing.id);
            backgroundNameToId.set(draft.name, existing.id);
          } else {
            const background: Background = {
              id: uuidv4(),
              spaceId: story.spaceId,
              name: draft.name,
              environmentPrompt: draft.environmentPrompt,
              referenceImageUrl: draft.referenceImageUrl,
              createdAt: Date.now()
            };
            await tx.backgrounds.save(background);
            savedBackgroundIds.push(background.id);
            backgroundNameToId.set(draft.name, background.id);
          }
        }

        // Step 4: 在事务内批量创建新 segments
        const newSegments: StorySegment[] = segments.map((draft, i) => {
          const mentionedCharacterIds = draft.mentionedCharacterNames
            .map(name => characterNameToId.get(name))
            .filter((id): id is string => !!id);
          const selectedBackgroundId = backgroundNameToId.get(draft.suggestedBackgroundName);
          return {
            id: uuidv4(),
            storyId: story.id,
            sequenceOrder: i,
            content: draft.content,
            mentionedCharacters: mentionedCharacterIds,
            selectedBackgroundId
          };
        });
        if (newSegments.length > 0) {
          await tx.segments.bulkAdd(newSegments);
        }

        // Step 5: 在事务内更新 story.status
        story.status = 'SPLIT';
        await tx.stories.save(story);

        return { savedCharacterIds, savedBackgroundIds };
      }
    );
  }

  /**
   * 原顺序执行版 applyBreakdown（unitOfWork 未注入时回退使用，保持向后兼容）。
   */
  private async applyBreakdownLegacy(
    story: Story,
    characters: CharacterDraft[],
    backgrounds: BackgroundDraft[],
    segments: BreakdownSegmentDraft[]
  ): Promise<{ savedCharacterIds: string[]; savedBackgroundIds: string[] }> {
    // Load existing characters/backgrounds in this space for dedup
    const existingCharacters = await this.characterRepo.findBySpaceId(story.spaceId);
    const existingCharByName = new Map(existingCharacters.map(c => [c.name, c]));
    const existingBackgrounds = await this.backgroundRepo.findBySpaceId(story.spaceId);
    const existingBgByName = new Map(existingBackgrounds.map(b => [b.name, b]));

    // Step 1: Delete old segments & video tasks FIRST (before creating new data)
    const existingSegments = await this.segmentRepo.findByStoryId(story.id);
    if (existingSegments.length > 0) {
      const existingSegmentIds = existingSegments.map(s => s.id);
      await this.videoTaskRepo.deleteBySegmentIds(existingSegmentIds);
      await this.segmentRepo.deleteByStoryId(story.id);
    }

    // Step 2: Save characters (reuse existing or create new)
    const savedCharacterIds: string[] = [];
    const characterNameToId = new Map<string, string>();
    for (const draft of characters) {
      const existing = existingCharByName.get(draft.name);
      if (existing) {
        let needsUpdate = false;
        if (draft.referenceImageUrl && !existing.referenceImageUrl) {
          existing.referenceImageUrl = draft.referenceImageUrl;
          needsUpdate = true;
        }
        if (draft.voiceId && !existing.voiceId) {
          existing.voiceId = draft.voiceId;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await this.characterRepo.save(existing);
        }
        savedCharacterIds.push(existing.id);
        characterNameToId.set(draft.name, existing.id);
      } else {
        const character: Character = {
          id: uuidv4(),
          spaceId: story.spaceId,
          name: draft.name,
          appearancePrompt: draft.appearancePrompt,
          personalityPrompt: draft.personalityPrompt,
          characterBackground: draft.characterBackground,
          referenceImageUrl: draft.referenceImageUrl,
          voiceId: draft.voiceId,
          createdAt: Date.now()
        };
        await this.characterRepo.save(character);
        savedCharacterIds.push(character.id);
        characterNameToId.set(draft.name, character.id);
      }
    }

    // Step 3: Save backgrounds (reuse existing or create new)
    const savedBackgroundIds: string[] = [];
    const backgroundNameToId = new Map<string, string>();
    for (const draft of backgrounds) {
      const existing = existingBgByName.get(draft.name);
      if (existing) {
        if (draft.referenceImageUrl && !existing.referenceImageUrl) {
          existing.referenceImageUrl = draft.referenceImageUrl;
          await this.backgroundRepo.save(existing);
        }
        savedBackgroundIds.push(existing.id);
        backgroundNameToId.set(draft.name, existing.id);
      } else {
        const background: Background = {
          id: uuidv4(),
          spaceId: story.spaceId,
          name: draft.name,
          environmentPrompt: draft.environmentPrompt,
          referenceImageUrl: draft.referenceImageUrl,
          createdAt: Date.now()
        };
        await this.backgroundRepo.save(background);
        savedBackgroundIds.push(background.id);
        backgroundNameToId.set(draft.name, background.id);
      }
    }

    // Step 4: Save new segments
    for (let i = 0; i < segments.length; i++) {
      const draft = segments[i];
      const mentionedCharacterIds = draft.mentionedCharacterNames
        .map(name => characterNameToId.get(name))
        .filter((id): id is string => !!id);

      const selectedBackgroundId = backgroundNameToId.get(draft.suggestedBackgroundName);

      const segment: StorySegment = {
        id: uuidv4(),
        storyId: story.id,
        sequenceOrder: i,
        content: draft.content,
        mentionedCharacters: mentionedCharacterIds,
        selectedBackgroundId
      };
      await this.segmentRepo.save(segment);
    }

    // Step 5: Mark story as SPLIT (only after all data is saved)
    story.status = 'SPLIT';
    await this.storyRepo.save(story);

    return { savedCharacterIds, savedBackgroundIds };
  }

  async getSegments(storyId: string): Promise<StorySegment[]> {
    this.logger.debug('getSegments called', this.ctx({ storyId }));
    const segments = await this.segmentRepo.findByStoryId(storyId);
    const sorted = segments.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    this.logger.debug('getSegments done', this.ctx({ storyId, segmentCount: sorted.length }));
    return sorted;
  }

  async updateSegmentBackground(segmentId: string, backgroundId: string): Promise<void> {
    this.logger.debug('updateSegmentBackground called', this.ctx({ segmentId, backgroundId }));
    const segment = await this.segmentRepo.findById(segmentId);
    if (segment) {
      segment.selectedBackgroundId = backgroundId;
      await this.segmentRepo.save(segment);
      this.logger.info('updateSegmentBackground done', this.ctx({ segmentId, backgroundId }));
    } else {
      this.logger.warn('updateSegmentBackground: segment not found', this.ctx({ segmentId }));
    }
  }

  async updateSegment(segmentId: string, updates: Partial<StorySegment>): Promise<void> {
    this.logger.debug('updateSegment called', this.ctx({ segmentId, fields: Object.keys(updates) }));
    const segment = await this.segmentRepo.findById(segmentId);
    if (segment) {
      Object.assign(segment, updates);
      await this.segmentRepo.save(segment);
      this.logger.info('updateSegment done', this.ctx({ segmentId }));
    } else {
      this.logger.warn('updateSegment: segment not found', this.ctx({ segmentId }));
    }
  }

  async removeCharacterFromSegments(characterId: string): Promise<void> {
    this.logger.debug('removeCharacterFromSegments called', this.ctx({ characterId }));
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      this.logger.warn('removeCharacterFromSegments: character not found', this.ctx({ characterId }));
      return;
    }
    // Only scan stories in the same space as the character
    const stories = await this.storyRepo.findBySpaceId(character.spaceId);
    let affectedCount = 0;
    for (const story of stories) {
      const segments = await this.segmentRepo.findByStoryId(story.id);
      for (const seg of segments) {
        if (seg.mentionedCharacters.includes(characterId)) {
          seg.mentionedCharacters = seg.mentionedCharacters.filter(id => id !== characterId);
          await this.segmentRepo.save(seg);
          affectedCount++;
        }
      }
    }
    this.logger.info('removeCharacterFromSegments done', this.ctx({ characterId, affectedSegments: affectedCount }));
  }

  async removeBackgroundFromSegments(backgroundId: string): Promise<void> {
    this.logger.debug('removeBackgroundFromSegments called', this.ctx({ backgroundId }));
    const background = await this.backgroundRepo.findById(backgroundId);
    if (!background) {
      this.logger.warn('removeBackgroundFromSegments: background not found', this.ctx({ backgroundId }));
      return;
    }
    // Only scan stories in the same space as the background
    const stories = await this.storyRepo.findBySpaceId(background.spaceId);
    let affectedCount = 0;
    for (const story of stories) {
      const segments = await this.segmentRepo.findByStoryId(story.id);
      for (const seg of segments) {
        if (seg.selectedBackgroundId === backgroundId) {
          seg.selectedBackgroundId = undefined;
          await this.segmentRepo.save(seg);
          affectedCount++;
        }
      }
    }
    this.logger.info('removeBackgroundFromSegments done', this.ctx({ backgroundId, affectedSegments: affectedCount }));
  }

  async deleteStory(storyId: string): Promise<void> {
    this.logger.debug('deleteStory called', this.ctx({ storyId }));
    const segments = await this.segmentRepo.findByStoryId(storyId);
    const segmentIds = segments.map(s => s.id);
    await this.videoTaskRepo.deleteBySegmentIds(segmentIds);
    await this.segmentRepo.deleteByStoryId(storyId);
    await this.storyRepo.delete(storyId);
    this.logger.info('deleteStory done', this.ctx({ storyId, deletedSegments: segmentIds.length }));
  }

  async getAllStories(): Promise<Story[]> {
    this.logger.debug('getAllStories called', this.ctx({}));
    const stories = await this.storyRepo.findAll();
    this.logger.debug('getAllStories done', this.ctx({ storyCount: stories.length }));
    return stories;
  }
}
