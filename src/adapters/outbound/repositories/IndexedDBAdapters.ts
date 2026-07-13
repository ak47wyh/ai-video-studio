import { db } from './DexieDatabase';
import type { Character, Background, Story, StorySegment, StorySpace, VideoTask, VideoTaskStatus, FinalCut } from '../../../domain/entities/models';
import type {
  ICharacterRepository,
  IBackgroundRepository,
  IStoryRepository,
  IStorySegmentRepository,
  IVideoTaskRepository,
  IStorySpaceRepository,
  IFinalCutRepository
} from '../../../domain/ports/OutboundPorts';

export class StorySpaceRepositoryAdapter implements IStorySpaceRepository {
  async save(space: StorySpace): Promise<void> {
    await db.storySpaces.put(space);
  }
  async findById(id: string): Promise<StorySpace | null> {
    return (await db.storySpaces.get(id)) || null;
  }
  async findAll(): Promise<StorySpace[]> {
    return db.storySpaces.toArray();
  }
  async delete(id: string): Promise<void> {
    await db.storySpaces.delete(id);
  }
}

export class CharacterRepositoryAdapter implements ICharacterRepository {
  async save(character: Character): Promise<void> {
    await db.characters.put(character);
  }
  async findById(id: string): Promise<Character | null> {
    return (await db.characters.get(id)) || null;
  }
  async findAll(): Promise<Character[]> {
    return db.characters.toArray();
  }
  async findBySpaceId(spaceId: string): Promise<Character[]> {
    return db.characters.where('spaceId').equals(spaceId).toArray();
  }
  async delete(id: string): Promise<void> {
    await db.characters.delete(id);
  }
}

export class BackgroundRepositoryAdapter implements IBackgroundRepository {
  async save(background: Background): Promise<void> {
    await db.backgrounds.put(background);
  }
  async findById(id: string): Promise<Background | null> {
    return (await db.backgrounds.get(id)) || null;
  }
  async findAll(): Promise<Background[]> {
    return db.backgrounds.toArray();
  }
  async findBySpaceId(spaceId: string): Promise<Background[]> {
    return db.backgrounds.where('spaceId').equals(spaceId).toArray();
  }
  async delete(id: string): Promise<void> {
    await db.backgrounds.delete(id);
  }
}

export class StoryRepositoryAdapter implements IStoryRepository {
  async save(story: Story): Promise<void> {
    await db.stories.put(story);
  }
  async findById(id: string): Promise<Story | null> {
    return (await db.stories.get(id)) || null;
  }
  async findAll(): Promise<Story[]> {
    return db.stories.toArray();
  }
  async findBySpaceId(spaceId: string): Promise<Story[]> {
    return db.stories.where('spaceId').equals(spaceId).toArray();
  }
  async delete(id: string): Promise<void> {
    await db.stories.delete(id);
  }
}

export class StorySegmentRepositoryAdapter implements IStorySegmentRepository {
  async save(segment: StorySegment): Promise<void> {
    await db.segments.put(segment);
  }
  async findById(id: string): Promise<StorySegment | null> {
    return (await db.segments.get(id)) || null;
  }
  async findByStoryId(storyId: string): Promise<StorySegment[]> {
    return db.segments.where('storyId').equals(storyId).toArray();
  }
  async deleteByStoryId(storyId: string): Promise<void> {
    // V2 P1-3.2.3：直接按 storyId 索引删除，消除 findByStoryId → bulkDelete 之间的 TOCTOU 窗口。
    // 原实现两步之间若有并发写入，可能漏删或误删。
    await db.segments.where('storyId').equals(storyId).delete();
  }
}

export class VideoTaskRepositoryAdapter implements IVideoTaskRepository {
  async save(task: VideoTask): Promise<void> {
    await db.videoTasks.put(task);
  }
  async findById(taskId: string): Promise<VideoTask | null> {
    return (await db.videoTasks.get(taskId)) ?? null;
  }
  async findBySegmentId(segmentId: string): Promise<VideoTask[]> {
    return db.videoTasks.where('segmentId').equals(segmentId).toArray();
  }
  async findLatestBySegmentId(segmentId: string): Promise<VideoTask | null> {
    const tasks = await db.videoTasks
      .where('segmentId').equals(segmentId)
      .reverse().sortBy('createdAt');
    return tasks[0] || null;
  }
  async findByStatuses(statuses: VideoTaskStatus[]): Promise<VideoTask[]> {
    return db.videoTasks.where('status').anyOf(statuses).toArray();
  }
  async deleteBySegmentIds(segmentIds: string[]): Promise<void> {
    if (segmentIds.length === 0) return;
    // V2 P1-3.2.3：同上，直接索引删除避免 TOCTOU
    await db.videoTasks.where('segmentId').anyOf(segmentIds).delete();
  }
  async updateStatus(taskId: string, status: VideoTaskStatus, videoUrl?: string, errorMessage?: string): Promise<void> {
    // P0 修复：原 get → modify → put 非原子，并发场景会丢失字段。
    // 改用 Dexie 原生 update：仅 PATCH 指定字段，避免覆盖并发写入。
    const patch: Partial<VideoTask> = { status };
    if (videoUrl !== undefined) patch.videoUrl = videoUrl;
    if (errorMessage !== undefined) patch.errorMessage = errorMessage;
    const affected = await db.videoTasks.update(taskId, patch);
    if (affected === 0) {
      // 任务不存在时静默（与原行为一致），但记日志便于排查
      // 注意：不可在此抛错，原行为即"task 不存在则 noop"
    }
  }
}

export class FinalCutRepositoryAdapter implements IFinalCutRepository {
  async save(cut: FinalCut): Promise<void> {
    await db.finalCuts.put(cut);
  }
  async findById(id: string): Promise<FinalCut | undefined> {
    return db.finalCuts.get(id);
  }
  async findByStoryIds(storyIds: string[]): Promise<FinalCut[]> {
    if (storyIds.length === 0) return [];
    // V2 P1-3.5.4 优化：改用 storyId 索引 anyOf 查询，避免全表扫描 + 内存过滤
    // finalCuts 表已声明 'id, storyId, pipelineTaskId, createdAt' 索引，之前未利用
    const matched = await db.finalCuts.where('storyId').anyOf(storyIds).toArray();
    return matched.sort((a, b) => b.createdAt - a.createdAt);
  }
  async delete(id: string): Promise<void> {
    await db.finalCuts.delete(id);
  }
}
