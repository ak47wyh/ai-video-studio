import { VolcengineApiError } from './VolcengineErrorUtils';

/**
 * 火山引擎语音技术（声音复刻 + 大模型 TTS）错误归一化。
 *
 * 与方舟 Ark 错误归一化（VolcengineErrorUtils）分离，因为：
 *  - 端点域名不同（openspeech.bytedance.com vs ark.cn-beijing.volces.com）
 *  - 错误码体系不同（声音复刻 1001/1101/1106 等，TTS 3001/3050 等）
 *  - 鉴权方式不同（Bearer;Token vs Bearer Token）
 *
 * 文档参考：
 *  - 声音复刻：https://www.volcengine.com/docs/6561/1305191
 *  - 大模型 TTS：https://www.volcengine.com/docs/6561/1257584
 */

// ===== 声音复刻错误码映射 =====

interface ErrorMapping {
  code: string;
  message: string;
}

/** 声音复刻 upload / status 接口错误码（BaseResp.StatusCode 字段） */
const CLONE_ERROR_MAP: Record<number, ErrorMapping> = {
  1001: { code: 'BAD_REQUEST', message: '请求参数有误，请检查 speaker_id / 音频格式' },
  1101: { code: 'AUDIO_UPLOAD_FAILED', message: '音频上传失败，请检查网络或重试' },
  1102: { code: 'ASR_FAILED', message: '语音识别转写失败，请检查音频质量' },
  1103: { code: 'SID_FAILED', message: '声纹检测失败，请使用更清晰的人声样本' },
  1104: { code: 'SID_CELEBRITY', message: '声纹与名人相似度过高，请使用本人声音' },
  1106: { code: 'SPEAKER_ID_DUPLICATE', message: 'SpeakerID 已存在，请重新生成' },
  1107: { code: 'SPEAKER_ID_NOT_FOUND', message: 'SpeakerID 未找到，请检查 ID 是否正确' },
  1109: { code: 'WER_ERROR', message: '音频与文本字错率过高，请确保音频与试听文本一致' },
  1122: { code: 'NO_HUMAN_VOICE', message: '未检测到人声，请检查音频内容' },
  1123: { code: 'UPLOAD_LIMIT', message: '已达上传次数限制（每音色 10 次），请删除后重新克隆' },
};

// ===== TTS 错误码映射 =====

/** 大模型语音合成 code 字段错误码 */
const TTS_ERROR_MAP: Record<number, ErrorMapping> = {
  3001: { code: 'INVALID_REQUEST', message: 'TTS 请求参数非法，请检查音色 ID / 文本' },
  3003: { code: 'CONCURRENCY_LIMIT', message: '并发数超限，请稍后重试' },
  3005: { code: 'SERVER_BUSY', message: '后端服务繁忙，请稍后重试' },
  3010: { code: 'TEXT_TOO_LONG', message: '文本长度超限，请拆分后重试' },
  3011: { code: 'INVALID_TEXT', message: '文本内容无效（含敏感词或格式错误）' },
  3030: { code: 'TIMEOUT', message: '处理超时，请缩短文本或重试' },
  3050: { code: 'VOICE_NOT_FOUND', message: '音色查询失败，请检查 voice_type 是否正确' },
};

/**
 * 解析声音复刻错误（upload / status 接口）。
 * 火山引擎声音复刻错误以 BaseResp.StatusCode 返回，0 为成功。
 *
 * P0 修复：新增 httpStatus 参数透传给 VolcengineApiError，
 * 使 isRetryable 能正确判断 429/5xx 重试场景。
 * - 业务错误（HTTP 200 但业务码非 0）：传 200 → 不可重试（正确，业务校验失败）
 * - 网络/服务端错误（catch AxiosError）：传 503 → 可重试
 */
export function parseCloneError(statusCode: number, fallbackMessage: string, httpStatus: number = 200): VolcengineApiError {
  const mapped = CLONE_ERROR_MAP[statusCode];
  return new VolcengineApiError(
    httpStatus,
    mapped?.code ?? `CLONE_${statusCode}`,
    mapped?.message ?? fallbackMessage,
  );
}

/**
 * 解析 TTS 错误（/api/v1/tts 接口）。
 * 火山引擎 TTS 以 code 字段返回，3000 为成功。
 *
 * P0 修复：同 parseCloneError，新增 httpStatus 参数。
 */
export function parseTtsError(code: number, fallbackMessage: string, httpStatus: number = 200): VolcengineApiError {
  const mapped = TTS_ERROR_MAP[code];
  return new VolcengineApiError(
    httpStatus,
    mapped?.code ?? `TTS_${code}`,
    mapped?.message ?? fallbackMessage,
  );
}

/** 声音复刻训练状态枚举 */
export type SpeakerStatus = 0 | 1 | 2 | 3 | 4;

/** 解析训练状态为人类可读文案 */
export function describeSpeakerStatus(status: SpeakerStatus): string {
  switch (status) {
    case 0: return '未找到音色';
    case 1: return '训练中';
    case 2: return '训练成功';
    case 3: return '训练失败';
    case 4: return '已激活';
    default: return `未知状态(${status})`;
  }
}

/** 训练状态是否可用于 TTS 合成 */
export function isSpeakerReady(status: SpeakerStatus): boolean {
  return status === 2 || status === 4;
}
