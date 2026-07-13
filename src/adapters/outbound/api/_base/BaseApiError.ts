/**
 * BaseApiError —— 平台 API 错误基类。
 *
 * Phase 4 DRY 抽取：6 个平台 ApiError 类（Volcengine/Hunyuan/Kling/Vidu/Wan/Zhipu）
 * 共享相同的字段结构与 isRetryable 语义。子类只需提供平台名与文案映射，
 * 统一遵守全局重试标准：HTTP 429 + 5xx（500/502/503/504）均可重试。
 *
 * 设计决策：
 *   - 不直接持有 platformName 字段，子类通过 `this.name` 区分（构造时设置）
 *   - isRetryable 默认实现遵循全局标准；Hunyuan 等业务码驱动的平台可覆盖
 *   - 子类应实现静态 `toUserMessage` 或在构造前自行转换文案
 */
export abstract class BaseApiError extends Error {
  public readonly httpStatus: number;
  public readonly errorCode: string;
  public readonly rawMessage: string;

  constructor(
    httpStatus: number,
    errorCode: string,
    rawMessage: string,
    platformName: string,
    userMessage: string,
  ) {
    super(userMessage);
    this.name = `${platformName}ApiError`;
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.rawMessage = rawMessage;
  }

  /**
   * 全局标准：429 限流 + 5xx 服务端/网关错误可重试。
   * 子类如需扩展（如 Hunyuan 的业务码 InternalError），可覆盖此 getter。
   */
  get isRetryable(): boolean {
    return (
      this.httpStatus === 429 ||
      this.httpStatus === 500 ||
      this.httpStatus === 502 ||
      this.httpStatus === 503 ||
      this.httpStatus === 504
    );
  }
}
