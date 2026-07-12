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

export class StoryService {
  private storyRepo: IStoryRepository;
  private segmentRepo: IStorySegmentRepository;
  private characterRepo: ICharacterRepository;
  private backgroundRepo: IBackgroundRepository;
  private textSplitterPort: ITextSplitterPort;
  private storyBreakdownPort: IStoryBreakdownPort;
  private videoTaskRepo: IVideoTaskRepository;

  constructor(
    storyRepo: IStoryRepository,
    segmentRepo: IStorySegmentRepository,
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    textSplitterPort: ITextSplitterPort,
    storyBreakdownPort: IStoryBreakdownPort,
    videoTaskRepo: IVideoTaskRepository
  ) {
    this.storyRepo = storyRepo;
    this.segmentRepo = segmentRepo;
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.textSplitterPort = textSplitterPort;
    this.storyBreakdownPort = storyBreakdownPort;
    this.videoTaskRepo = videoTaskRepo;
  }

  async createStory(title: string, originalText: string, spaceId: string): Promise<Story> {
    const story: Story = {
      id: uuidv4(),
      spaceId,
      title,
      originalText,
      status: 'DRAFT',
      createdAt: Date.now()
    };
    await this.storyRepo.save(story);
    return story;
  }

  async updateStory(storyId: string, title: string, originalText: string): Promise<void> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) throw new Error('Story not found');
    story.title = title;
    story.originalText = originalText;
    // Reset to DRAFT if content changed and story was already split
    if (story.status === 'SPLIT') {
      story.status = 'DRAFT';
    }
    await this.storyRepo.save(story);
  }

  async splitStory(storyId: string): Promise<StorySegment[]> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) throw new Error('Story not found');

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

    return segments;
  }

  /**
   * Preview breakdown: call AI to extract characters/backgrounds/segments
   * but do NOT save anything — return drafts for user to edit.
   */
  async previewBreakdown(storyId: string): Promise<StoryBreakdownResult> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) throw new Error('Story not found');
    return this.storyBreakdownPort.breakdownStory(story.originalText);
  }

  /**
   * Apply breakdown: save user-edited characters, backgrounds, and segments.
   * - Existing same-name characters/backgrounds are reused (not overwritten).
   * - Previous segments & video tasks for this story are deleted and rebuilt.
   * - Uses a "delete old first, then create new" strategy for better atomicity.
   */
  async applyBreakdown(
    storyId: string,
    characters: CharacterDraft[],
    backgrounds: BackgroundDraft[],
    segments: BreakdownSegmentDraft[]
  ): Promise<{ savedCharacterIds: string[]; savedBackgroundIds: string[] }> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) throw new Error('Story not found');

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
        // Reuse existing — but update image/voice if draft provides new ones
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
        // Reuse existing — but update image if draft provides a new one
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
    const segments = await this.segmentRepo.findByStoryId(storyId);
    return segments.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async updateSegmentBackground(segmentId: string, backgroundId: string): Promise<void> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (segment) {
      segment.selectedBackgroundId = backgroundId;
      await this.segmentRepo.save(segment);
    }
  }

  async updateSegment(segmentId: string, updates: Partial<StorySegment>): Promise<void> {
    const segment = await this.segmentRepo.findById(segmentId);
    if (segment) {
      Object.assign(segment, updates);
      await this.segmentRepo.save(segment);
    }
  }

  async removeCharacterFromSegments(characterId: string): Promise<void> {
    const character = await this.characterRepo.findById(characterId);
    if (!character) return;
    // Only scan stories in the same space as the character
    const stories = await this.storyRepo.findBySpaceId(character.spaceId);
    for (const story of stories) {
      const segments = await this.segmentRepo.findByStoryId(story.id);
      for (const seg of segments) {
        if (seg.mentionedCharacters.includes(characterId)) {
          seg.mentionedCharacters = seg.mentionedCharacters.filter(id => id !== characterId);
          await this.segmentRepo.save(seg);
        }
      }
    }
  }

  async removeBackgroundFromSegments(backgroundId: string): Promise<void> {
    const background = await this.backgroundRepo.findById(backgroundId);
    if (!background) return;
    // Only scan stories in the same space as the background
    const stories = await this.storyRepo.findBySpaceId(background.spaceId);
    for (const story of stories) {
      const segments = await this.segmentRepo.findByStoryId(story.id);
      for (const seg of segments) {
        if (seg.selectedBackgroundId === backgroundId) {
          seg.selectedBackgroundId = undefined;
          await this.segmentRepo.save(seg);
        }
      }
    }
  }

  async deleteStory(storyId: string): Promise<void> {
    const segments = await this.segmentRepo.findByStoryId(storyId);
    const segmentIds = segments.map(s => s.id);
    await this.videoTaskRepo.deleteBySegmentIds(segmentIds);
    await this.segmentRepo.deleteByStoryId(storyId);
    await this.storyRepo.delete(storyId);
  }

  async getAllStories(): Promise<Story[]> {
    return this.storyRepo.findAll();
  }
}
