import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Mic, Music, Film, Trash2, Download } from 'lucide-react';
import { useSpace } from '../contexts/SpaceContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { AsyncState } from '../components/AsyncState';
import { assetLibraryService } from '../../dependencies';
import { useSavedImages, useSavedVoices, useSavedBgms, useSavedVideos } from '../hooks/useSavedAssets';
import type { SavedImage, SavedVideo } from '../../domain/entities/models';

type Tab = 'images' | 'voices' | 'bgms' | 'videos';

/**
 * P0-4 素材库：沉淀生成结果（图片/音色/BGM/视频片段），跨故事复用。
 */
export const AssetLibrary: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('images');

  const imagesQuery = useSavedImages(currentSpaceId || '');
  const voicesQuery = useSavedVoices(currentSpaceId || '');
  const bgmsQuery = useSavedBgms(currentSpaceId || '');
  const videosQuery = useSavedVideos(currentSpaceId || '');

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; count: number }> = [
    { key: 'images', label: t('assetLibrary.tabImages', '图片'), icon: <ImageIcon size={14} />, count: imagesQuery.images.length },
    { key: 'voices', label: t('assetLibrary.tabVoices', '音色'), icon: <Mic size={14} />, count: voicesQuery.voices.length },
    { key: 'bgms', label: t('assetLibrary.tabBgms', 'BGM'), icon: <Music size={14} />, count: bgmsQuery.bgms.length },
    { key: 'videos', label: t('assetLibrary.tabVideos', '视频片段'), icon: <Film size={14} />, count: videosQuery.videos.length },
  ];

  const deleteAsset = async (kind: Tab, id: string) => {
    const ok = await confirm.confirm({
      title: t('assetLibrary.deleteTitle', '删除素材'),
      message: t('assetLibrary.deleteConfirm', '删除后不可恢复，确定删除该素材？'),
      confirmLabel: t('assetLibrary.deleteBtn', '删除'), danger: true,
    });
    if (!ok) return;
    try {
      if (kind === 'images') await assetLibraryService.deleteImage(id);
      else if (kind === 'voices') await assetLibraryService.deleteVoice(id);
      else if (kind === 'bgms') await assetLibraryService.deleteBgm(id);
      else await assetLibraryService.deleteVideo(id);
      toast.showToast('success', t('assetLibrary.deleteSuccess', '素材已删除'));
      imagesQuery.refetch();
      voicesQuery.refetch();
      bgmsQuery.refetch();
      videosQuery.refetch();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.deleteFailed', '删除失败') + (e instanceof Error ? `: ${e.message}` : ''));
    }
  };

  const downloadAsset = async (kind: Tab, id: string, name: string) => {
    try {
      let url: string | null = null;
      if (kind === 'images') {
        const img = imagesQuery.images.find(i => i.id === id);
        if (img) url = await assetLibraryService.getImageBlobUrl(img);
      } else if (kind === 'voices') {
        const v = voicesQuery.voices.find(x => x.id === id);
        if (v) url = await assetLibraryService.getVoiceBlobUrl(v);
      } else if (kind === 'bgms') {
        const b = bgmsQuery.bgms.find(x => x.id === id);
        if (b) url = await assetLibraryService.getBgmBlobUrl(b);
      } else {
        const v = videosQuery.videos.find(x => x.id === id);
        if (v) url = await assetLibraryService.getVideoBlobUrl(v);
      }
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    } catch {
      toast.showToast('error', t('assetLibrary.downloadFailed', '下载失败'));
    }
  };

  const renderEmpty = (loading: boolean, count: number) => {
    if (loading) return <AsyncState loading minHeight={140} />;
    if (count === 0) return <AsyncState empty emptyText={t('assetLibrary.empty', '暂无素材，生成结果可一键存入素材库')} minHeight={140} />;
    return null;
  };

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('assetLibrary.title', '素材库')}</h1>
        <p className="page-subtitle">{t('assetLibrary.subtitle', '沉淀生成结果，跨故事复用')}</p>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(tb => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={tab === tb.key}
            className={`tab${tab === tb.key ? ' tab-active' : ''}`}
            onClick={() => setTab(tb.key)}
          >
            {tb.icon} {tb.label} ({tb.count})
          </button>
        ))}
      </div>

      <div className="asset-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
        {tab === 'images' && (renderEmpty(imagesQuery.loading, imagesQuery.images.length) ?? imagesQuery.images.map(img => (
          <AssetCard
            key={img.id}
            title={img.name}
            subtitle={`${img.model} · ${new Date(img.createdAt).toLocaleDateString()}`}
            preview={<ImagePreview img={img} />}
            onDelete={() => deleteAsset('images', img.id)}
            onDownload={() => downloadAsset('images', img.id, `${img.name || img.id}.png`)}
          />
        )))}

        {tab === 'voices' && (renderEmpty(voicesQuery.loading, voicesQuery.voices.length) ?? voicesQuery.voices.map(v => (
          <AssetCard
            key={v.id}
            title={v.name}
            subtitle={`${v.model} · ${new Date(v.createdAt).toLocaleDateString()}`}
            preview={<AudioPreview getUrl={async () => assetLibraryService.getVoiceBlobUrl(v)} />}
            onDelete={() => deleteAsset('voices', v.id)}
            onDownload={() => downloadAsset('voices', v.id, `${v.name || v.id}.mp3`)}
          />
        )))}

        {tab === 'bgms' && (renderEmpty(bgmsQuery.loading, bgmsQuery.bgms.length) ?? bgmsQuery.bgms.map(b => (
          <AssetCard
            key={b.id}
            title={b.name}
            subtitle={`${b.model} · ${b.durationSec}s · ${new Date(b.createdAt).toLocaleDateString()}`}
            preview={<AudioPreview getUrl={async () => assetLibraryService.getBgmBlobUrl(b)} />}
            onDelete={() => deleteAsset('bgms', b.id)}
            onDownload={() => downloadAsset('bgms', b.id, `${b.name || b.id}.mp3`)}
          />
        )))}

        {tab === 'videos' && (renderEmpty(videosQuery.loading, videosQuery.videos.length) ?? videosQuery.videos.map(v => (
          <AssetCard
            key={v.id}
            title={v.name}
            subtitle={`${v.durationSec}s · ${new Date(v.createdAt).toLocaleDateString()}`}
            preview={<VideoPreview v={v} />}
            onDelete={() => deleteAsset('videos', v.id)}
            onDownload={() => downloadAsset('videos', v.id, `${v.name || v.id}.mp4`)}
          />
        )))}
      </div>
    </div>
  );
};

function AssetCard(props: { title: string; subtitle: string; preview: React.ReactNode; onDelete: () => void; onDownload: () => void }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ height: 110, background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {props.preview}
      </div>
      <div style={{ padding: '0.5rem 0.6rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.title}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{props.subtitle}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="btn btn-ghost" style={{ flex: 1, padding: '0.25rem 0' }} onClick={props.onDownload}><Download size={12} /> 下载</button>
          <button className="btn btn-ghost" style={{ flex: 1, padding: '0.25rem 0', color: 'var(--color-danger)' }} onClick={props.onDelete}><Trash2 size={12} /> 删除</button>
        </div>
      </div>
    </div>
  );
}

/** 异步解析资产 URL 并渲染（fn 需稳定引用，由调用方 useCallback 保证） */
function useAsyncUrl(fn: () => Promise<string>): string | undefined {
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    fn().then(u => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [fn]);
  return url;
}

function ImagePreview(props: { img: SavedImage }) {
  const url = useAsyncUrl(React.useCallback(() => assetLibraryService.getImageBlobUrl(props.img), [props.img]));
  if (!url) return <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Image</div>;
  return <img src={url} alt={props.img.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function VideoPreview(props: { v: SavedVideo }) {
  const url = useAsyncUrl(React.useCallback(() => assetLibraryService.getVideoBlobUrl(props.v), [props.v]));
  if (!url) return <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Video</div>;
  return <video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function AudioPreview(props: { getUrl: () => Promise<string> }) {
  const url = useAsyncUrl(props.getUrl);
  if (!url) return <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Audio</div>;
  return <audio src={url} controls style={{ width: '90%' }} />;
}
