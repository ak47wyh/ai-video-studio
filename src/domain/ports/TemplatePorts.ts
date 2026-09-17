import type { ContentTemplate, TemplateKind } from '../entities/models';

/** P1-6 创作模板仓库 */
export interface ITemplateRepository {
  save(tpl: ContentTemplate): Promise<void>;
  getById(id: string): Promise<ContentTemplate | undefined>;
  query(params: { kind?: TemplateKind }): Promise<ContentTemplate[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
