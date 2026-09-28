/**
 * MusicLibraryPage —— 音乐库浏览（M-2 一期：Free Music Archive）
 *
 * 搜索栏 + 流派筛选 + 曲目列表（试听/导入到 BGM 库）。
 * 每首曲目展示 License，UI 显式提示"使用时需保留原作者署名"。
 * FMA 官方 API 已停服时如实显示"服务暂不可用"降级提示。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Music2, Download, Headphones, AlertCircle, Loader2 } from 'lucide-react';
import { musicService } from '../../dependencies';
import { isMusicLibraryUnavailable } from '../../domain/ports/MusicLibraryPorts';
import { useToast } from '../contexts/ToastContext';
import { useSpace } from '../contexts/SpaceContext';
import { getErrorMessage } from '../utils/errorUtils';
import type { MusicTrack } from '../../domain/ports/MusicLibraryPorts';

const GENRES = ['', 'Electronic', 'Rock', 'Jazz', 'Classical', 'Hip-Hop', 'Folk'];

export const MusicLibraryPage: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const spaceId = currentSpaceId ?? '__default__';
  const [keyword, setKeyword] = useState('');
  const [genre, setGenre] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const handleSearch = async () => {
    setSearching(true);
    setUnavailable(false);
    setErrorMsg(null);
    setTracks([]);
    setPreviewUrl(null);
    try {
      const result = await musicService.searchLibrary({ keyword: keyword.trim() || undefined, genre: genre || undefined });
      setTracks(result);
    } catch (e) {
      if (isMusicLibraryUnavailable(e)) {
        setUnavailable(true);
      } else {
        setErrorMsg(getErrorMessage(e, t('musicLibrary.searchFailed', '搜索失败')));
      }
    } finally {
      setSearching(false);
    }
  };

  const handlePreview = async (trackId: string) => {
    setPreviewingId(trackId);
    try {
      const url = await musicService.previewTrack(trackId);
      setPreviewUrl(url);
    } catch (e) {
      showToast('error', isMusicLibraryUnavailable(e) ? t('musicLibrary.previewUnavailable', '试听服务暂不可用') : getErrorMessage(e, t('musicLibrary.previewFailed', '试听失败')));
    } finally {
      setPreviewingId(null);
    }
  };

  const handleImport = async (track: MusicTrack) => {
    setImportingId(track.id);
    try {
      await musicService.importTrack(track, spaceId);
      showToast('success', t('musicLibrary.imported', '已导入到 BGM 库'));
    } catch (e) {
      showToast('error', isMusicLibraryUnavailable(e) ? t('musicLibrary.importUnavailable', '导入服务暂不可用') : getErrorMessage(e, t('musicLibrary.importFailed', '导入失败')));
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('musicLibrary.title', '音乐库')}</h1>
          <p>{t('musicLibrary.subtitle', '浏览外部音乐库并导入 BGM（一期：Free Music Archive）')}</p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '0.75rem', marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder={t('musicLibrary.searchPlaceholder', '搜索曲目 / 艺术家')}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
        />
        <select className="input" value={genre} onChange={e => setGenre(e.target.value)} aria-label={t('musicLibrary.genre', '流派')}>
          <option value="">{t('musicLibrary.allGenres', '全部流派')}</option>
          {GENRES.filter(Boolean).map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
          {searching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
          {t('musicLibrary.search', '搜索')}
        </button>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <AlertCircle size={13} />
        {t('musicLibrary.licenseNotice', '曲目受 CC 许可保护，使用时需保留原作者署名。')}
      </div>

      {unavailable && (
        <div className="glass-panel" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <Headphones size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t('musicLibrary.unavailable', '音乐库服务暂不可用（外部 API 已停服），请稍后再试或使用「音乐生成」创作 BGM。')}
          </p>
        </div>
      )}

      {errorMsg && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', background: 'rgba(234,102,104,0.1)', borderRadius: 8 }}>
          {errorMsg}
        </div>
      )}

      {tracks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {tracks.map(track => (
            <div key={track.id} className="glass-panel" style={{ padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <Music2 size={16} style={{ color: 'var(--text-muted)' }} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{track.title}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {track.artist} · {Math.floor(track.durationSec / 60)}:{String(track.durationSec % 60).padStart(2, '0')} · {track.genre || '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-success)' }}>{track.license}</div>
              </div>
              <button className="btn btn-secondary btn-xs" onClick={() => handlePreview(track.id)} disabled={previewingId === track.id}>
                <Headphones size={13} /> {previewingId === track.id ? t('musicLibrary.loading', '加载中…') : t('musicLibrary.preview', '试听')}
              </button>
              <button className="btn btn-primary btn-xs" onClick={() => handleImport(track)} disabled={importingId === track.id}>
                <Download size={13} /> {importingId === track.id ? t('musicLibrary.importing', '导入中…') : t('musicLibrary.import', '导入到 BGM 库')}
              </button>
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div className="glass-panel" style={{ padding: '0.5rem 0.75rem', marginTop: '0.75rem' }}>
          <audio src={previewUrl} controls style={{ width: '100%' }} />
        </div>
      )}
    </div>
  );
};
