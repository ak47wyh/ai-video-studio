import type { Project, ProjectStyleSettings, Story } from '../entities/models';
import type { IProjectRepository } from '../ports/ProjectPorts';
import type { IStoryRepository } from '../ports/OutboundPorts';

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface CreateProjectInput {
  spaceId: string;
  name: string;
  description?: string;
  styleSettings?: ProjectStyleSettings;
}

/**
 * P1-5 项目/系列：Space 之上的系列剧本集。
 * - 系列设置（风格/分辨率/音色/BGM 偏好）由子故事继承；
 * - 故事通过 projectId 关联项目；删除项目时解除关联（不删故事）。
 */
export class ProjectService {
  private readonly repo: IProjectRepository;
  private readonly storyRepo: IStoryRepository;

  constructor(repo: IProjectRepository, storyRepo: IStoryRepository) {
    this.repo = repo;
    this.storyRepo = storyRepo;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: generateId(),
      spaceId: input.spaceId,
      name: input.name,
      description: input.description,
      styleSettings: input.styleSettings,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(project);
    return project;
  }

  async updateProject(id: string, patch: { name?: string; description?: string; styleSettings?: ProjectStyleSettings }): Promise<Project> {
    const project = await this.repo.getById(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    const updated: Project = { ...project, ...patch, updatedAt: Date.now() };
    await this.repo.save(updated);
    return updated;
  }

  /** 删除项目并解除其下故事的 projectId 关联（不删除故事） */
  async deleteProject(id: string): Promise<void> {
    const project = await this.repo.getById(id);
    if (project) {
      const stories = await this.storyRepo.findBySpaceId(project.spaceId);
      for (const s of stories.filter(st => st.projectId === id)) {
        const next: Story = { ...s, projectId: undefined };
        await this.storyRepo.save(next);
      }
    }
    await this.repo.delete(id);
  }

  async listProjects(spaceId?: string): Promise<Project[]> {
    return this.repo.query({ spaceId });
  }

  /** 关联故事到项目 */
  async linkStory(projectId: string, storyId: string): Promise<void> {
    const project = await this.repo.getById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const story = await this.storyRepo.findById(storyId);
    if (!story) throw new Error(`Story not found: ${storyId}`);
    await this.storyRepo.save({ ...story, projectId });
  }

  async unlinkStory(projectId: string, storyId: string): Promise<void> {
    const story = await this.storyRepo.findById(storyId);
    if (!story) return;
    if (story.projectId !== projectId) return;
    await this.storyRepo.save({ ...story, projectId: undefined });
  }

  /** 项目下的故事列表 */
  async listProjectStories(projectId: string): Promise<Story[]> {
    const project = await this.repo.getById(projectId);
    if (!project) return [];
    const stories = await this.storyRepo.findBySpaceId(project.spaceId);
    return stories.filter(s => s.projectId === projectId);
  }

  /** 空间下全部故事（UI 关联选择用） */
  async listStoriesBySpace(spaceId: string): Promise<Story[]> {
    return this.storyRepo.findBySpaceId(spaceId);
  }
}
