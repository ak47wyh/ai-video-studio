import { v4 as uuidv4 } from 'uuid';
import type { StorySpace, Character, Background } from '../entities/models';
import type { IStorySpaceRepository, ICharacterRepository, IBackgroundRepository, IStoryRepository } from '../ports/OutboundPorts';
import type { IUnitOfWorkPort } from '../ports/TransactionPorts';

export class StorySpaceService {
  private spaceRepo: IStorySpaceRepository;
  private characterRepo: ICharacterRepository;
  private backgroundRepo: IBackgroundRepository;
  private storyRepo: IStoryRepository;
  private unitOfWork: IUnitOfWorkPort;

  constructor(
    spaceRepo: IStorySpaceRepository,
    characterRepo: ICharacterRepository,
    backgroundRepo: IBackgroundRepository,
    storyRepo: IStoryRepository,
    _segmentRepo: unknown,
    _videoTaskRepo: unknown,
    unitOfWork: IUnitOfWorkPort
  ) {
    this.spaceRepo = spaceRepo;
    this.characterRepo = characterRepo;
    this.backgroundRepo = backgroundRepo;
    this.storyRepo = storyRepo;
    this.unitOfWork = unitOfWork;
  }

  async createSpace(name: string, description: string): Promise<StorySpace> {
    const space: StorySpace = {
      id: uuidv4(),
      name,
      description,
      createdAt: Date.now()
    };
    await this.spaceRepo.save(space);
    return space;
  }

  async updateSpace(space: StorySpace): Promise<void> {
    await this.spaceRepo.save(space);
  }

  async deleteSpace(spaceId: string): Promise<void> {
    await this.unitOfWork.transaction(
      ['storySpaces', 'stories', 'segments', 'videoTasks', 'characters', 'backgrounds', 'pipelineTasks', 'finalCuts', 'timelines', 'savedImages', 'savedVoices', 'savedPrompts', 'savedVideos', 'generatedFiles', 'snapshots'],
      async (tx) => {
        const stories = await tx.stories.where('spaceId').equals(spaceId).toArray();
        for (const story of stories) {
          const segments = await tx.segments.where('storyId').equals(story.id).toArray();
          const segmentIds = segments.map(s => s.id);
          if (segmentIds.length > 0) {
            await tx.videoTasks.where('segmentId').in(segmentIds).delete();
          }
          await tx.segments.where('storyId').equals(story.id).delete();
          await tx.finalCuts.where('storyId').equals(story.id).delete();
          await tx.timelines.where('storyId').equals(story.id).delete();
          await tx.pipelineTasks.where('storyId').equals(story.id).delete();
        }

        await tx.characters.where('spaceId').equals(spaceId).delete();
        await tx.backgrounds.where('spaceId').equals(spaceId).delete();
        await tx.savedImages.where('spaceId').equals(spaceId).delete();
        await tx.savedVoices.where('spaceId').equals(spaceId).delete();
        await tx.savedPrompts.where('spaceId').equals(spaceId).delete();
        await tx.savedVideos.where('spaceId').equals(spaceId).delete();
        await tx.generatedFiles.where('spaceId').equals(spaceId).delete();
        await tx.snapshots.where('spaceId').equals(spaceId).delete();

        for (const story of stories) {
          await tx.stories.delete(story.id);
        }

        await tx.storySpaces.delete(spaceId);
      }
    );
  }

  async copyCharacterToSpace(characterId: string, targetSpaceId: string): Promise<Character> {
    const source = await this.characterRepo.findById(characterId);
    if (!source) throw new Error('Character not found');
    const copied: Character = {
      ...source,
      id: uuidv4(),
      spaceId: targetSpaceId,
      createdAt: Date.now()
    };
    await this.characterRepo.save(copied);
    return copied;
  }

  async copyBackgroundToSpace(backgroundId: string, targetSpaceId: string): Promise<Background> {
    const source = await this.backgroundRepo.findById(backgroundId);
    if (!source) throw new Error('Background not found');
    const copied: Background = {
      ...source,
      id: uuidv4(),
      spaceId: targetSpaceId,
      createdAt: Date.now()
    };
    await this.backgroundRepo.save(copied);
    return copied;
  }

  async copyAllToSpace(sourceSpaceId: string, targetSpaceId: string): Promise<{ characters: number; backgrounds: number; stories: number }> {
    const characters = await this.characterRepo.findBySpaceId(sourceSpaceId);
    for (const c of characters) {
      await this.characterRepo.save({ ...c, id: uuidv4(), spaceId: targetSpaceId, createdAt: Date.now() });
    }
    const backgrounds = await this.backgroundRepo.findBySpaceId(sourceSpaceId);
    for (const b of backgrounds) {
      await this.backgroundRepo.save({ ...b, id: uuidv4(), spaceId: targetSpaceId, createdAt: Date.now() });
    }
    // Copy stories (without segments/video tasks — those are story-specific)
    const stories = await this.storyRepo.findBySpaceId(sourceSpaceId);
    for (const s of stories) {
      await this.storyRepo.save({ ...s, id: uuidv4(), spaceId: targetSpaceId, status: 'DRAFT' as const, createdAt: Date.now() });
    }
    return { characters: characters.length, backgrounds: backgrounds.length, stories: stories.length };
  }

  async getAllSpaces(): Promise<StorySpace[]> {
    return this.spaceRepo.findAll();
  }

  async getSpaceById(id: string): Promise<StorySpace | null> {
    return this.spaceRepo.findById(id);
  }

  async getSpaceStats(spaceId: string): Promise<{ characters: number; backgrounds: number; stories: number }> {
    const characters = await this.characterRepo.findBySpaceId(spaceId);
    const backgrounds = await this.backgroundRepo.findBySpaceId(spaceId);
    const stories = await this.storyRepo.findBySpaceId(spaceId);
    return { characters: characters.length, backgrounds: backgrounds.length, stories: stories.length };
  }
}
