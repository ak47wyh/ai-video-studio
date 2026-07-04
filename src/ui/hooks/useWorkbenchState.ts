/**
 * StoryWorkbench 状态管理 — 按领域分桶的 useReducer
 *
 * 将 30+ useState 整合为 3 个领域 reducer：
 * - breakdownReducer: 分镜拆解相关（草稿角色/背景/确认/图片生成）
 * - bgmReducer: BGM 编辑相关（模式/歌词/模型/封面）
 * - workbenchReducer: 工作台全局状态（loading/视频配置/旁白/合成）
 */

import type { CharacterDraft, BackgroundDraft, BreakdownSegmentDraft, VideoGenerationMode, VideoModel, VideoResolution, MusicModel } from '../../domain/ports/OutboundPorts';

// ==================== Breakdown State ====================

export interface BreakdownState {
  draftCharacters: CharacterDraft[];
  draftBackgrounds: BackgroundDraft[];
  draftSegments: BreakdownSegmentDraft[];
  showPreview: boolean;
  isApplying: boolean;
  confirmedCharIndices: Set<number>;
  confirmedBgIndices: Set<number>;
  generatingCharImageIndices: Set<number>;
  generatingBgImageIndices: Set<number>;
  refiningCharField: { index: number; field: string } | null;
  refiningBgField: { index: number; field: string } | null;
}

export const initialBreakdownState: BreakdownState = {
  draftCharacters: [],
  draftBackgrounds: [],
  draftSegments: [],
  showPreview: false,
  isApplying: false,
  confirmedCharIndices: new Set(),
  confirmedBgIndices: new Set(),
  generatingCharImageIndices: new Set(),
  generatingBgImageIndices: new Set(),
  refiningCharField: null,
  refiningBgField: null,
};

type BreakdownAction =
  | { type: 'SET_DRAFTS'; characters: CharacterDraft[]; backgrounds: BackgroundDraft[]; segments: BreakdownSegmentDraft[] }
  | { type: 'SHOW_PREVIEW' }
  | { type: 'HIDE_PREVIEW' }
  | { type: 'SET_APPLYING'; value: boolean }
  | { type: 'UPDATE_CHAR'; index: number; field: keyof CharacterDraft; value: string }
  | { type: 'REMOVE_CHAR'; index: number }
  | { type: 'UPDATE_BG'; index: number; field: keyof BackgroundDraft; value: string }
  | { type: 'REMOVE_BG'; index: number }
  | { type: 'TOGGLE_CONFIRM_CHAR'; index: number }
  | { type: 'TOGGLE_CONFIRM_ALL_CHARS' }
  | { type: 'TOGGLE_CONFIRM_BG'; index: number }
  | { type: 'TOGGLE_CONFIRM_ALL_BGS' }
  | { type: 'SET_GENERATING_CHAR_IMAGE'; index: number; value: boolean }
  | { type: 'SET_GENERATING_BG_IMAGE'; index: number; value: boolean }
  | { type: 'SET_REFINING_CHAR'; field: { index: number; field: string } | null }
  | { type: 'SET_REFINING_BG'; field: { index: number; field: string } | null }
  | { type: 'RESET' };

export function breakdownReducer(state: BreakdownState, action: BreakdownAction): BreakdownState {
  switch (action.type) {
    case 'SET_DRAFTS':
      return { ...state, draftCharacters: action.characters, draftBackgrounds: action.backgrounds, draftSegments: action.segments };
    case 'SHOW_PREVIEW':
      return { ...state, showPreview: true };
    case 'HIDE_PREVIEW':
      return { ...state, showPreview: false };
    case 'SET_APPLYING':
      return { ...state, isApplying: action.value };
    case 'UPDATE_CHAR': {
      const chars = [...state.draftCharacters];
      chars[action.index] = { ...chars[action.index], [action.field]: action.value };
      let segs = state.draftSegments;
      if (action.field === 'name') {
        const oldName = state.draftCharacters[action.index].name;
        segs = segs.map(seg => ({
          ...seg,
          mentionedCharacterNames: seg.mentionedCharacterNames.map(n => n === oldName ? action.value : n)
        }));
      }
      return { ...state, draftCharacters: chars, draftSegments: segs };
    }
    case 'REMOVE_CHAR': {
      const name = state.draftCharacters[action.index].name;
      const chars = state.draftCharacters.filter((_, i) => i !== action.index);
      const confirmed = new Set<number>();
      for (const i of state.confirmedCharIndices) {
        if (i < action.index) confirmed.add(i);
        else if (i > action.index) confirmed.add(i - 1);
      }
      const segs = state.draftSegments.map(seg => ({
        ...seg,
        mentionedCharacterNames: seg.mentionedCharacterNames.filter(n => n !== name)
      }));
      return { ...state, draftCharacters: chars, confirmedCharIndices: confirmed, draftSegments: segs };
    }
    case 'UPDATE_BG': {
      const bgs = [...state.draftBackgrounds];
      bgs[action.index] = { ...bgs[action.index], [action.field]: action.value };
      let segs = state.draftSegments;
      if (action.field === 'name') {
        const oldName = state.draftBackgrounds[action.index].name;
        segs = segs.map(seg => ({
          ...seg,
          suggestedBackgroundName: seg.suggestedBackgroundName === oldName ? action.value : seg.suggestedBackgroundName
        }));
      }
      return { ...state, draftBackgrounds: bgs, draftSegments: segs };
    }
    case 'REMOVE_BG': {
      const name = state.draftBackgrounds[action.index].name;
      const bgs = state.draftBackgrounds.filter((_, i) => i !== action.index);
      const confirmed = new Set<number>();
      for (const i of state.confirmedBgIndices) {
        if (i < action.index) confirmed.add(i);
        else if (i > action.index) confirmed.add(i - 1);
      }
      const segs = state.draftSegments.map(seg => ({
        ...seg,
        suggestedBackgroundName: seg.suggestedBackgroundName === name ? '' : seg.suggestedBackgroundName
      }));
      return { ...state, draftBackgrounds: bgs, confirmedBgIndices: confirmed, draftSegments: segs };
    }
    case 'TOGGLE_CONFIRM_CHAR': {
      const next = new Set(state.confirmedCharIndices);
      if (next.has(action.index)) next.delete(action.index); else next.add(action.index);
      return { ...state, confirmedCharIndices: next };
    }
    case 'TOGGLE_CONFIRM_ALL_CHARS': {
      return {
        ...state,
        confirmedCharIndices: state.confirmedCharIndices.size === state.draftCharacters.length
          ? new Set() : new Set(state.draftCharacters.map((_, i) => i))
      };
    }
    case 'TOGGLE_CONFIRM_BG': {
      const next = new Set(state.confirmedBgIndices);
      if (next.has(action.index)) next.delete(action.index); else next.add(action.index);
      return { ...state, confirmedBgIndices: next };
    }
    case 'TOGGLE_CONFIRM_ALL_BGS': {
      return {
        ...state,
        confirmedBgIndices: state.confirmedBgIndices.size === state.draftBackgrounds.length
          ? new Set() : new Set(state.draftBackgrounds.map((_, i) => i))
      };
    }
    case 'SET_GENERATING_CHAR_IMAGE': {
      const next = new Set(state.generatingCharImageIndices);
      if (action.value) next.add(action.index); else next.delete(action.index);
      return { ...state, generatingCharImageIndices: next };
    }
    case 'SET_GENERATING_BG_IMAGE': {
      const next = new Set(state.generatingBgImageIndices);
      if (action.value) next.add(action.index); else next.delete(action.index);
      return { ...state, generatingBgImageIndices: next };
    }
    case 'SET_REFINING_CHAR':
      return { ...state, refiningCharField: action.field };
    case 'SET_REFINING_BG':
      return { ...state, refiningBgField: action.field };
    case 'RESET':
      return initialBreakdownState;
    default:
      return state;
  }
}

// ==================== BGM State ====================

export interface BGMState {
  segmentId: string | null;
  prompt: string;
  mode: 'instrumental' | 'autoLyrics' | 'customLyrics' | 'cover';
  lyrics: string;
  model: MusicModel;
  coverAudioUrl: string;
  isGenerating: boolean;
  isGeneratingLyrics: boolean;
  isSuggestingStyle: boolean;
}

export const initialBGMState: BGMState = {
  segmentId: null,
  prompt: '',
  mode: 'instrumental',
  lyrics: '',
  model: 'music-2.6',
  coverAudioUrl: '',
  isGenerating: false,
  isGeneratingLyrics: false,
  isSuggestingStyle: false,
};

type BGMAction =
  | { type: 'START_EDIT'; segmentId: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SET_PROMPT'; value: string }
  | { type: 'SET_MODE'; value: BGMState['mode'] }
  | { type: 'SET_MODEL'; value: MusicModel }
  | { type: 'SET_LYRICS'; value: string }
  | { type: 'SET_COVER_URL'; value: string }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'SET_GENERATING_LYRICS'; value: boolean }
  | { type: 'SET_SUGGESTING_STYLE'; value: boolean }
  | { type: 'GENERATED'; prompt?: string; lyrics?: string }
  | { type: 'RESET' };

export function bgmReducer(state: BGMState, action: BGMAction): BGMState {
  switch (action.type) {
    case 'START_EDIT':
      return { ...initialBGMState, segmentId: action.segmentId };
    case 'CANCEL_EDIT':
      return { ...initialBGMState };
    case 'SET_PROMPT':
      return { ...state, prompt: action.value };
    case 'SET_MODE':
      return { ...state, mode: action.value };
    case 'SET_MODEL':
      return { ...state, model: action.value };
    case 'SET_LYRICS':
      return { ...state, lyrics: action.value };
    case 'SET_COVER_URL':
      return { ...state, coverAudioUrl: action.value };
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.value };
    case 'SET_GENERATING_LYRICS':
      return { ...state, isGeneratingLyrics: action.value };
    case 'SET_SUGGESTING_STYLE':
      return { ...state, isSuggestingStyle: action.value };
    case 'GENERATED':
      return { ...state, segmentId: null, prompt: '', lyrics: '', coverAudioUrl: '', isGenerating: false };
    case 'RESET':
      return initialBGMState;
    default:
      return state;
  }
}

// ==================== Workbench State ====================

export interface WorkbenchState {
  selectedStoryId: string | null;
  isSplitting: boolean;
  isBreakingDown: boolean;
  isBatchGenerating: boolean;
  batchBgId: string;
  isRefiningStoryText: boolean;
  /** P0-1：批量旁白生成中 */
  isBatchNarrating: boolean;
  /** P0-1：批量 BGM 生成中 */
  isBatchBgmGenerating: boolean;
  narrationStatuses: Record<string, string>;
  narrationUrls: Record<string, string>;
  isAssembling: boolean;
  assembleProgress: { percent: number; message: string } | null;
  videoMode: VideoGenerationMode;
  videoModel: VideoModel;
  videoResolution: VideoResolution;
  videoDuration: 6 | 10;
  videoPromptOptimizer: boolean;
}

type WorkbenchAction =
  | { type: 'SELECT_STORY'; storyId: string | null }
  | { type: 'SET_SPLITTING'; value: boolean }
  | { type: 'SET_BREAKING_DOWN'; value: boolean }
  | { type: 'SET_BATCH_GENERATING'; value: boolean }
  | { type: 'SET_BATCH_BG_ID'; value: string }
  | { type: 'SET_REFINING_STORY_TEXT'; value: boolean }
  | { type: 'SET_BATCH_NARRATING'; value: boolean }
  | { type: 'SET_BATCH_BGM_GENERATING'; value: boolean }
  | { type: 'SET_NARRATION_STATUS'; segmentId: string; status: string }
  | { type: 'SET_NARRATION_URL'; segmentId: string; url: string }
  | { type: 'CLEAR_NARRATION' }
  | { type: 'SET_ASSEMBLING'; value: boolean; progress?: { percent: number; message: string } | null }
  | { type: 'SET_VIDEO_MODE'; value: VideoGenerationMode }
  | { type: 'SET_VIDEO_MODEL'; value: VideoModel }
  | { type: 'SET_VIDEO_RESOLUTION'; value: VideoResolution }
  | { type: 'SET_VIDEO_DURATION'; value: 6 | 10 }
  | { type: 'SET_VIDEO_PROMPT_OPTIMIZER'; value: boolean };

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'SELECT_STORY':
      return { ...state, selectedStoryId: action.storyId };
    case 'SET_SPLITTING':
      return { ...state, isSplitting: action.value };
    case 'SET_BREAKING_DOWN':
      return { ...state, isBreakingDown: action.value };
    case 'SET_BATCH_GENERATING':
      return { ...state, isBatchGenerating: action.value };
    case 'SET_BATCH_BG_ID':
      return { ...state, batchBgId: action.value };
    case 'SET_BATCH_NARRATING':
      return { ...state, isBatchNarrating: action.value };
    case 'SET_BATCH_BGM_GENERATING':
      return { ...state, isBatchBgmGenerating: action.value };
    case 'SET_REFINING_STORY_TEXT':
      return { ...state, isRefiningStoryText: action.value };
    case 'SET_NARRATION_STATUS':
      return { ...state, narrationStatuses: { ...state.narrationStatuses, [action.segmentId]: action.status } };
    case 'SET_NARRATION_URL':
      return { ...state, narrationUrls: { ...state.narrationUrls, [action.segmentId]: action.url } };
    case 'CLEAR_NARRATION':
      return { ...state, narrationStatuses: {}, narrationUrls: {} };
    case 'SET_ASSEMBLING':
      return { ...state, isAssembling: action.value, assembleProgress: action.progress ?? state.assembleProgress };
    case 'SET_VIDEO_MODE':
      return { ...state, videoMode: action.value };
    case 'SET_VIDEO_MODEL':
      return { ...state, videoModel: action.value };
    case 'SET_VIDEO_RESOLUTION':
      return { ...state, videoResolution: action.value };
    case 'SET_VIDEO_DURATION':
      return { ...state, videoDuration: action.value };
    case 'SET_VIDEO_PROMPT_OPTIMIZER':
      return { ...state, videoPromptOptimizer: action.value };
    default:
      return state;
  }
}

export const initialWorkbenchState: WorkbenchState = {
  selectedStoryId: (() => { try { return new URLSearchParams(window.location.search).get('story'); } catch { return null; } })(),
  isSplitting: false,
  isBreakingDown: false,
  isBatchGenerating: false,
  batchBgId: '',
  isRefiningStoryText: false,
  isBatchNarrating: false,
  isBatchBgmGenerating: false,
  narrationStatuses: {},
  narrationUrls: {},
  isAssembling: false,
  assembleProgress: null,
  videoMode: 't2v',
  videoModel: 'T2V-01-Director',
  videoResolution: '768P',
  videoDuration: 6,
  videoPromptOptimizer: true,
};
