import type { Project } from '../entities/models';

/** P1-5 项目/系列仓库 */
export interface IProjectRepository {
  save(project: Project): Promise<void>;
  getById(id: string): Promise<Project | undefined>;
  query(params: { spaceId?: string }): Promise<Project[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
