import { db } from './DexieDatabase';
import type { Project } from '../../../domain/entities/models';
import type { IProjectRepository } from '../../../domain/ports/ProjectPorts';

/** P1-5 项目/系列仓库（IndexedDB） */
export class ProjectRepositoryAdapter implements IProjectRepository {
  async save(project: Project): Promise<void> {
    await db.projects.put(project);
  }

  async getById(id: string): Promise<Project | undefined> {
    return db.projects.get(id);
  }

  async query(params: { spaceId?: string }): Promise<Project[]> {
    let col = db.projects.toCollection();
    if (params.spaceId) col = db.projects.where('spaceId').equals(params.spaceId);
    const results = await col.toArray();
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(id: string): Promise<void> {
    await db.projects.delete(id);
  }

  async count(): Promise<number> {
    return db.projects.count();
  }
}
