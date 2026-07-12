import { db } from './DexieDatabase';
import type {
  IUnitOfWorkPort,
  TransactionRepositories,
  TransactionRepository,
  TransactionWhereClause,
} from '../../../domain/ports/TransactionPorts';
import type {
  Story, StorySegment, Character, Background, VideoTask, StorySpace,
  FinalCut, PipelineTask, SavedImage, SavedVoice, SavedPrompt, SavedVideo,
  GeneratedFile,
} from '../../../domain/entities/models';
import type { SpaceSnapshot, Timeline } from '../../../domain/ports/PersistencePorts';

interface DexieTableLike<T> {
  delete(id: string): Promise<void>;
  where(key: string): DexieWhereClauseLike<T>;
}

interface DexieWhereClauseLike<T> {
  equals(value: unknown): DexieWhereClauseLike<T>;
  in(values: unknown[]): DexieWhereClauseLike<T>;
  toArray(): Promise<T[]>;
  delete(): Promise<void>;
}

class DexieTransactionRepository<T> implements TransactionRepository<T> {
  constructor(_table: DexieTableLike<T>) {
    this._table = _table;
  }

  private _table: DexieTableLike<T>;

  where(key: string): TransactionWhereClause<T> {
    return new DexieWhereClause(this._table.where(key));
  }

  delete(id: string): Promise<void> {
    return this._table.delete(id);
  }
}

class DexieWhereClause<T> implements TransactionWhereClause<T> {
  constructor(_clause: DexieWhereClauseLike<T>) {
    this._clause = _clause;
  }

  private _clause: DexieWhereClauseLike<T>;

  equals(value: unknown): TransactionWhereClause<T> {
    this._clause = this._clause.equals(value);
    return this;
  }

  in(values: unknown[]): TransactionWhereClause<T> {
    this._clause = this._clause.in(values);
    return this;
  }

  toArray(): Promise<T[]> {
    return this._clause.toArray();
  }

  delete(): Promise<void> {
    return this._clause.delete();
  }
}

export class DexieUnitOfWorkAdapter implements IUnitOfWorkPort {
  async transaction<T>(
    tableNames: string[],
    callback: (repos: TransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return db.transaction('rw', tableNames, async () => {
      const repos: TransactionRepositories = {
        storySpaces: new DexieTransactionRepository<StorySpace>(db.storySpaces as unknown as DexieTableLike<StorySpace>),
        characters: new DexieTransactionRepository<Character>(db.characters as unknown as DexieTableLike<Character>),
        backgrounds: new DexieTransactionRepository<Background>(db.backgrounds as unknown as DexieTableLike<Background>),
        stories: new DexieTransactionRepository<Story>(db.stories as unknown as DexieTableLike<Story>),
        segments: new DexieTransactionRepository<StorySegment>(db.segments as unknown as DexieTableLike<StorySegment>),
        videoTasks: new DexieTransactionRepository<VideoTask>(db.videoTasks as unknown as DexieTableLike<VideoTask>),
        finalCuts: new DexieTransactionRepository<FinalCut>(db.finalCuts as unknown as DexieTableLike<FinalCut>),
        pipelineTasks: new DexieTransactionRepository<PipelineTask>(db.pipelineTasks as unknown as DexieTableLike<PipelineTask>),
        timelines: new DexieTransactionRepository<Timeline>(db.timelines as unknown as DexieTableLike<Timeline>),
        savedImages: new DexieTransactionRepository<SavedImage>(db.savedImages as unknown as DexieTableLike<SavedImage>),
        savedVoices: new DexieTransactionRepository<SavedVoice>(db.savedVoices as unknown as DexieTableLike<SavedVoice>),
        savedPrompts: new DexieTransactionRepository<SavedPrompt>(db.savedPrompts as unknown as DexieTableLike<SavedPrompt>),
        savedVideos: new DexieTransactionRepository<SavedVideo>(db.savedVideos as unknown as DexieTableLike<SavedVideo>),
        generatedFiles: new DexieTransactionRepository<GeneratedFile>(db.generatedFiles as unknown as DexieTableLike<GeneratedFile>),
        snapshots: new DexieTransactionRepository<SpaceSnapshot>(db.snapshots as unknown as DexieTableLike<SpaceSnapshot>),
      };
      return callback(repos);
    });
  }
}
