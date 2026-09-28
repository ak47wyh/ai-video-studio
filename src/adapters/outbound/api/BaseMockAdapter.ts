/**
 * BaseMockAdapter —— Mock 适配器统一基类（A-2）
 *
 * 所有"模拟外部服务"的适配器必须继承本基类（或声明 `_isMock = true`），
 * 使架构契约测试可以静态/运行时断言"生产环境装配不泄漏裸 Mock"。
 */

export abstract class BaseMockAdapter {
  /** Mock 标记：契约测试与审计依赖此字段识别模拟实现 */
  readonly _isMock = true as const;
}
