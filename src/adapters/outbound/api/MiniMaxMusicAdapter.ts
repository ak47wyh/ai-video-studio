import type {
  IMusicPort,
  MusicGenerationContext,
  MusicGenerationResult,
  LyricsGenerationContext,
  LyricsGenerationResult,
  CoverPreprocessResult
} from '../../../domain/ports/OutboundPorts';
import { ApiConfigStore } from '../config/ApiConfigStore';
import { getMiniMaxErrorMessage } from './MiniMaxErrorUtils';
import axios from 'axios';

/**
 * Adapter for MiniMax Music Generation API.
 *
 * Supports 4 models:
 *   - music-2.6: Text-to-music (recommended)
 *   - music-2.6-free: Free tier text-to-music
 *   - music-cover: Cover song generation (two-step flow)
 *   - music-cover-free: Free tier cover song generation
 *
 * API Endpoints:
 *   - Music generation: POST /v1/music_generation
 *   - Lyrics generation: POST /v1/lyrics_generation
 *   - Cover preprocess:  POST /v1/music_cover_preprocess
 */
export class MiniMaxMusicAdapter implements IMusicPort {

  async generateMusic(context: MusicGenerationContext): Promise<MusicGenerationResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('请先在设置中配置 MiniMax 的 API Key');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');
    const model = context.model || 'music-2.6';

    const prompt = context.prompt;

    const payload: Record<string, unknown> = {
      model,
      prompt,
      output_format: context.outputFormat || 'url',
    };

    if (context.lyrics) {
      payload.lyrics = context.lyrics;
    }

    // Instrumental mode (only for music-2.6 / music-2.6-free)
    if (context.isInstrumental !== undefined && (model === 'music-2.6' || model === 'music-2.6-free')) {
      payload.is_instrumental = context.isInstrumental;
    }

    // Lyrics optimizer (only for music-2.6 / music-2.6-free)
    if (context.lyricsOptimizer !== undefined && (model === 'music-2.6' || model === 'music-2.6-free')) {
      payload.lyrics_optimizer = context.lyricsOptimizer;
    }

    // Stream
    if (context.stream !== undefined) {
      payload.stream = context.stream;
    }

    // Watermark
    if (context.aigcWatermark !== undefined) {
      payload.aigc_watermark = context.aigcWatermark;
    }

    // Audio settings
    if (context.audioSetting) {
      payload.audio_setting = {
        sample_rate: context.audioSetting.sampleRate ?? 44100,
        bitrate: context.audioSetting.bitrate ?? 256000,
        format: context.audioSetting.format ?? 'mp3',
      };
    }

    // Cover mode: reference audio or preprocessed feature
    if (model === 'music-cover' || model === 'music-cover-free') {
      if (context.coverFeatureId) {
        payload.cover_feature_id = context.coverFeatureId;
      } else if (context.audioUrl) {
        payload.audio_url = context.audioUrl;
      } else if (context.audioBase64) {
        payload.audio_base64 = context.audioBase64;
      }
    }

    console.log(`[MiniMaxMusicAdapter] Generating music, model: ${model}, prompt: ${prompt.substring(0, 50)}`);

    const response = await axios.post(`${baseUrl}/music_generation`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
      timeout: 120000,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Music Generation error');
    if (error) throw new Error(error);

    const extraInfo = data?.extra_info || {};
    const audioData = data?.data?.audio;
    let audioUrl: string | undefined;
    let audioHex: string | undefined;

    if (context.outputFormat === 'url') {
      audioUrl = typeof audioData === 'string' ? audioData : undefined;
    } else {
      audioHex = typeof audioData === 'string' ? audioData : undefined;
    }

    return {
      audioUrl,
      audioHex,
      duration: extraInfo.music_duration,
      sampleRate: extraInfo.music_sample_rate,
      bitrate: extraInfo.bitrate,
      channel: extraInfo.music_channel,
      size: extraInfo.music_size,
      status: data?.data?.status,
    };
  }

  async generateLyrics(context: LyricsGenerationContext): Promise<LyricsGenerationResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      console.warn('[MiniMaxMusicAdapter] No API Key configured — returning mock lyrics');
      return {
        songTitle: 'Mock Song',
        styleTags: 'Pop, Upbeat',
        lyrics: '[Verse]\n这是一首示例歌词\n请配置 API Key 以使用歌词生成功能',
      };
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload: Record<string, unknown> = {
      mode: context.mode,
    };

    if (context.prompt) {
      payload.prompt = context.prompt;
    }

    if (context.lyrics) {
      payload.lyrics = context.lyrics;
    }

    if (context.title) {
      payload.title = context.title;
    }

    console.log('[MiniMaxMusicAdapter] Generating lyrics, mode:', context.mode);

    const response = await axios.post(`${baseUrl}/lyrics_generation`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Lyrics Generation error');
    if (error) throw new Error(error);

    return {
      songTitle: data?.song_title || '',
      styleTags: data?.style_tags || '',
      lyrics: data?.lyrics || '',
    };
  }

  async preprocessCover(audioUrl: string): Promise<CoverPreprocessResult> {
    const config = ApiConfigStore.load();
    if (!config.minimaxApiKey) {
      throw new Error('API Key not configured — cannot preprocess cover');
    }

    const baseUrl = config.minimaxBaseUrl.replace(/\/+$/, '');

    const payload = {
      model: 'music-cover',
      audio_url: audioUrl,
    };

    console.log('[MiniMaxMusicAdapter] Preprocessing cover audio');

    const response = await axios.post(`${baseUrl}/music_cover_preprocess`, payload, {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      params: config.minimaxGroupId ? { group_id: config.minimaxGroupId } : undefined,
    });

    const data = response.data;

    const statusCode = data?.base_resp?.status_code;
    const error = getMiniMaxErrorMessage(statusCode, data?.base_resp?.status_msg, 'MiniMax Cover Preprocess error');
    if (error) throw new Error(error);

    return {
      coverFeatureId: data?.cover_feature_id || '',
      formattedLyrics: data?.formatted_lyrics || '',
      structureResult: data?.structure_result || '',
      audioDuration: data?.audio_duration || 0,
    };
  }
}
