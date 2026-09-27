import { describe, it, expect } from 'vitest';
import {
  buildSuggestion,
  shouldAllowRework,
  recordRework,
  REWORK_WINDOW_MS,
  type ReworkRecord,
} from '../../domain/services/QcSuggestionService';

describe('QcSuggestionService.buildSuggestion', () => {
  it('returns null for empty issues', () => {
    expect(buildSuggestion([])).toBeNull();
  });

  it('duration takes priority over silence', () => {
    const s = buildSuggestion([{ check: 'silence' }, { check: 'duration' }], { videoDuration: 10 });
    expect(s?.hintKey).toBe('qc.suggestion.duration');
    expect(s?.action).toBe('rework');
    expect(s?.preset).toEqual({ videoDuration: 6 });
  });

  it('subtitle_sync takes priority over silence', () => {
    const s = buildSuggestion([{ check: 'silence' }, { check: 'subtitle_sync' }], { videoDuration: 10 });
    expect(s?.hintKey).toBe('qc.suggestion.subtitleSync');
    expect(s?.preset).toEqual({ videoDuration: 6 });
  });

  it('silence suggests disabling narration', () => {
    const s = buildSuggestion([{ check: 'silence' }]);
    expect(s?.action).toBe('rework');
    expect(s?.preset).toEqual({ includeNarration: false });
  });

  it('duration at shortest tier falls back to manual review', () => {
    const s = buildSuggestion([{ check: 'duration' }], { videoDuration: 6 });
    expect(s?.action).toBe('manual');
    expect(s?.hintKey).toBe('qc.suggestion.durationManual');
    expect(s?.preset).toEqual({});
  });

  it('duration without explicit tier suggests 6s', () => {
    const s = buildSuggestion([{ check: 'duration' }]);
    expect(s?.preset).toEqual({ videoDuration: 6 });
  });

  it('subtitle_sync at 6s falls back to manual review', () => {
    const s = buildSuggestion([{ check: 'subtitle_sync' }], { videoDuration: 6 });
    expect(s?.action).toBe('manual');
    expect(s?.hintKey).toBe('qc.suggestion.subtitleSyncManual');
  });

  it('resolution echoes expected resolution from pipeline options', () => {
    const s = buildSuggestion([{ check: 'resolution' }], { pipelineOptions: { videoResolution: '1080P' } });
    expect(s?.action).toBe('rework');
    expect(s?.preset).toEqual({ videoResolution: '1080P' });
  });

  it('resolution without pipeline options is manual', () => {
    const s = buildSuggestion([{ check: 'resolution' }]);
    expect(s?.action).toBe('manual');
  });

  it('black_frames and loudness are manual review', () => {
    expect(buildSuggestion([{ check: 'black_frames' }])?.hintKey).toBe('qc.suggestion.blackFrames');
    expect(buildSuggestion([{ check: 'loudness' }])?.hintKey).toBe('qc.suggestion.loudness');
    expect(buildSuggestion([{ check: 'black_frames' }])?.action).toBe('manual');
  });

  it('probe suggests plain rework without preset', () => {
    const s = buildSuggestion([{ check: 'probe' }]);
    expect(s?.action).toBe('rework');
    expect(s?.preset).toEqual({});
    expect(s?.hintKey).toBe('qc.suggestion.probe');
  });

  it('unknown check falls back to manual', () => {
    const s = buildSuggestion([{ check: 'unknown_thing' }]);
    expect(s?.action).toBe('manual');
  });
});

describe('QcSuggestionService.rework throttle', () => {
  const now = 1_000_000;

  it('allows when no records for story', () => {
    expect(shouldAllowRework([], 's1', now)).toBe(true);
  });

  it('blocks within the window', () => {
    const records: ReworkRecord[] = [{ storyId: 's1', at: now - 60_000 }];
    expect(shouldAllowRework(records, 's1', now)).toBe(false);
  });

  it('allows after the window expires', () => {
    const records: ReworkRecord[] = [{ storyId: 's1', at: now - REWORK_WINDOW_MS - 1 }];
    expect(shouldAllowRework(records, 's1', now)).toBe(true);
  });

  it('is story-scoped (other story unaffected)', () => {
    const records: ReworkRecord[] = [{ storyId: 's1', at: now - 10_000 }];
    expect(shouldAllowRework(records, 's2', now)).toBe(true);
  });

  it('recordRework appends and prunes expired entries', () => {
    const records: ReworkRecord[] = [
      { storyId: 'old', at: now - REWORK_WINDOW_MS - 1 },
      { storyId: 's1', at: now - 10_000 },
    ];
    const next = recordRework(records, 's2', now);
    expect(next).toHaveLength(2);
    expect(next.some(r => r.storyId === 'old')).toBe(false);
    expect(next.some(r => r.storyId === 's2' && r.at === now)).toBe(true);
    expect(next.some(r => r.storyId === 's1')).toBe(true);
  });
});
