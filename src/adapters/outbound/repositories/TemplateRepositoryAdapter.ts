import { db } from './DexieDatabase';
import type { ContentTemplate, TemplateKind } from '../../../domain/entities/models';
import type { ITemplateRepository } from '../../../domain/ports/TemplatePorts';

/** P1-6 创作模板仓库（IndexedDB） */
export class TemplateRepositoryAdapter implements ITemplateRepository {
  async save(tpl: ContentTemplate): Promise<void> {
    await db.templates.put(tpl);
  }

  async getById(id: string): Promise<ContentTemplate | undefined> {
    return db.templates.get(id);
  }

  async query(params: { kind?: TemplateKind }): Promise<ContentTemplate[]> {
    let col = db.templates.toCollection();
    if (params.kind) col = db.templates.where('kind').equals(params.kind);
    const results = await col.toArray();
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async delete(id: string): Promise<void> {
    await db.templates.delete(id);
  }

  async count(): Promise<number> {
    return db.templates.count();
  }
}
