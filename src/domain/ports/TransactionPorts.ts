import type { Story, StorySegment, Character, Background, VideoTask, StorySpace, FinalCut, PipelineTask, SavedImage, SavedVoice, SavedPrompt, SavedVideo, GeneratedFile } from '../entities/models';
import type { SpaceSnapshot, Timeline } from './PersistencePorts';

export interface TransactionRepositories {
  storySpaces: TransactionRepository<StorySpace>;
  characters: TransactionRepository<Character>;
  backgrounds: TransactionRepository<Background>;
  stories: TransactionRepository<Story>;
  segments: TransactionRepository<StorySegment>;
  videoTasks: TransactionRepository<VideoTask>;
  pipelineTasks: TransactionRepository<PipelineTask>;
  finalCuts: TransactionRepository<FinalCut>;
  savedImages: TransactionRepository<SavedImage>;
  savedVoices: TransactionRepository<SavedVoice>;
  savedPrompts: TransactionRepository<SavedPrompt>;
  savedVideos: TransactionRepository<SavedVideo>;
  generatedFiles: TransactionRepository<GeneratedFile>;
  snapshots: TransactionRepository<SpaceSnapshot>;
  timelines: TransactionRepository<Timeline>;
}

export interface TransactionRepository<T> {
  delete(id: string): Promise<void>;
  where(index: string): TransactionWhereClause<T>;
}

export interface TransactionWhereClause<T> {
  equals(value: unknown): TransactionWhereClause<T>;
  in(keys: unknown[]): TransactionWhereClause<T>;
  toArray(): Promise<T[]>;
  delete(): Promise<void>;
}

export interface IUnitOfWorkPort {
  transaction<T>(
    tables: string[],
    operation: (tx: TransactionRepositories) => Promise<T>
  ): Promise<T>;
}
