import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type { ApiConfig } from '../../config/ApiConfigStore';
import { parseHunyuanError } from './HunyuanErrorUtils';

/**
 * 腾讯混元 Hunyuan HTTP 客户端。
 *
 * 鉴权：TC3-HMAC-SHA256 签名（腾讯云标准签名算法）
 *   - 基于 SecretId + SecretKey 派生签名密钥
 *   - 签名串含 CanonicalRequest + StringToSign + 派生签名密钥
 *   - HTTP Header: Authorization: TC3-HMAC-SHA256 Credential=..., SignedHeaders=..., Signature=...
 *
 * Base URL: https://hunyuan.tencentcloudapi.com
 * Service:  hunyuan
 * API 通过 POST / 发送，Action / Version 通过 X-TC-Action / X-TC-Version 头指定。
 */
export class HunyuanHttpClient {
  private client: AxiosInstance;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly service = 'hunyuan';
  private readonly apiVersion = '2023-09-01';

  constructor(config: ApiConfig) {
    this.secretId = config.hunyuanSecretId;
    this.secretKey = config.hunyuanSecretKey;
    this.baseUrl = config.hunyuanBaseUrl.replace(/\/+$/, '');

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 120_000,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'hunyuan.tencentcloudapi.com',
      },
    });

    // 响应拦截器：统一错误处理
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(parseHunyuanError(error)),
    );
  }

  /**
   * 发起腾讯云 API 请求。
   *
   * @param action  API Action 名（如 SubmitHunyuanToVideoJob）
   * @param payload 请求体 JSON
   * @param signal  可选 AbortSignal：外部取消（如流式模拟取消）会中断真实 HTTP 请求（P2-8）
   * @returns 响应体中的 Response 对象
   */
  async call<T>(action: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const date = this.utcDate(timestamp);

    // 1. 构造 Authorization 头
    const authorization = await this.buildAuthorization(action, body, timestamp, date);

    // 2. 发送请求
    const response = await this.client.post<T>('/', body, {
      headers: {
        'Authorization': authorization,
        'X-TC-Action': action,
        'X-TC-Version': this.apiVersion,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': 'ap-beijing',
      },
      signal, // P2-8：真实 wire abort，允许上层通过 AbortController 中断请求
    });
    return response.data;
  }

  // ===== TC3-HMAC-SHA256 签名实现 =====

  private async buildAuthorization(
    action: string,
    body: string,
    timestamp: number,
    date: string,
  ): Promise<string> {
    const canonicalRequest = await this.buildCanonicalRequest(action, body);
    const stringToSign = await this.buildStringToSign(timestamp, date, canonicalRequest);
    const signature = await this.computeSignature(stringToSign, date);

    const credentialScope = `${date}/${this.service}/tc3_request`;
    const signedHeaders = 'content-type;host;x-tc-action';
    return `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  /** Step 1: 构造 CanonicalRequest */
  private async buildCanonicalRequest(action: string, body: string): Promise<string> {
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:hunyuan.tencentcloudapi.com\n` +
      `x-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedRequestPayload = await this.sha256Hex(body);

    return [
      httpRequestMethod,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');
  }

  /** Step 2: 构造 StringToSign */
  private async buildStringToSign(
    timestamp: number,
    date: string,
    canonicalRequest: string,
  ): Promise<string> {
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const hashedCanonicalRequest = await this.sha256Hex(canonicalRequest);
    return [algorithm, String(timestamp), credentialScope, hashedCanonicalRequest].join('\n');
  }

  /** Step 3: 派生签名密钥并计算 Signature */
  private async computeSignature(stringToSign: string, date: string): Promise<string> {
    const secretDate = await this.hmacSha256('TC3' + this.secretKey, date);
    const secretService = await this.hmacSha256Bytes(secretDate, this.service);
    const secretSigning = await this.hmacSha256Bytes(secretService, 'tc3_request');
    const signature = await this.hmacSha256Bytes(secretSigning, stringToSign);
    return this.bytesToHex(signature);
  }

  // ===== WebCrypto 辅助方法 =====

  /** SHA-256 → 十六进制字符串 */
  private async sha256Hex(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(message));
    return this.bytesToHex(hashBuffer);
  }

  /** HMAC-SHA256（密钥为字符串，返回 ArrayBuffer） */
  private async hmacSha256(key: string, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  }

  /** HMAC-SHA256（密钥为 ArrayBuffer，用于派生密钥链，返回 ArrayBuffer） */
  private async hmacSha256Bytes(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  }

  /** ArrayBuffer → 十六进制小写字符串 */
  private bytesToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /** Unix 时间戳 → UTC 日期字符串 YYYY-MM-DD */
  private utcDate(timestamp: number): string {
    const d = new Date(timestamp * 1000);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
