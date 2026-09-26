import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Mic, Music, Film, Clapperboard, Trash2, Download, Archive, ArchiveRestore, Pencil, Check, X, Search, RefreshCw } from 'lucide-react';
import { useSpace } from '../contexts/SpaceContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useToast } from '../contexts/ToastContext';
import { AsyncState } from '../components/AsyncState';
import { assetLibraryService, finalCutRepo, storyRepo, ffmpegAdapter, complianceService, qcService } from '../../dependencies';
import { useSavedImages, useSavedVoices, useSavedBgms, useSavedVideos } from '../hooks/useSavedAssets';
import type { SavedImage, SavedVideo, FinalCut } from '../../domain/entities/models';
import type { QcRecommendation } from '../../domain/ports/QcPorts';

type Tab = 'cuts' | 'images' | 'voices' | 'bgms' | 'videos';
type AssetKind = 'image' | 'voice' | 'bgm' | 'video';
type ArchiveFilter = 'all' | 'active' | 'archived';

/**
 * P0-4 素材库 + P3-5 统一资产中心：
 * 成片/图片/音色/BGM/视频片段统一入库；支持统一检索、重命名、归档、批量删除（含关联提示）。
 */
export const AssetLibrary: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId } = useSpace();
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('cuts');
  const [keyword, setKeyword] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ kind: AssetKind; id: string; name: string } | null>(null);

  const [cuts, setCuts] = useState<FinalCut[]>([]);
  const [cutsLoading, setCutsLoading] = useState(true);
  const [batchBusy, setBatchBusy] = useState<{ kind: 'export' | 'qc'; done: number; total: number } | null>(null);
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});

  const kwParams = keyword.trim() ? { keyword: keyword.trim() } : undefined;
  const imagesQuery = useSavedImages(currentSpaceId || '', kwParams);
  const voicesQuery = useSavedVoices(currentSpaceId || '', kwParams);
  const bgmsQuery = useSavedBgms(currentSpaceId || '', kwParams);
  const videosQuery = useSavedVideos(currentSpaceId || '', kwParams);

  const loadCuts = useCallback(async () => {
    try {
      const [list, stories] = await Promise.all([
        finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
        storyRepo.findAll(),
      ]);
      setCuts(list);
      const m: Record<string, string> = {};
      for (const s of stories) m[s.id] = s.title;
      setStoryTitles(m);
    } catch {
      // 保持空列表
    } finally {
      setCutsLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
      storyRepo.findAll(),
    ]).then(([list, stories]) => {
      if (!alive) return;
      setCuts(list);
      const m: Record<string, string> = {};
      for (const s of stories) m[s.id] = s.title;
      setStoryTitles(m);
    }).catch(() => {}).finally(() => { if (alive) setCutsLoading(false); });
    return () => { alive = false; };
  }, []);

  const refetchAssets = () => {
    imagesQuery.refetch();
    voicesQuery.refetch();
    bgmsQuery.refetch();
    videosQuery.refetch();
  };

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; count: number }> = [
    { key: 'cuts', label: t('assetLibrary.tabCuts', '成片'), icon: <Clapperboard size={14} />, count: cuts.length },
    { key: 'images', label: t('assetLibrary.tabImages', '图片'), icon: <ImageIcon size={14} />, count: imagesQuery.images.length },
    { key: 'voices', label: t('assetLibrary.tabVoices', '音色'), icon: <Mic size={14} />, count: voicesQuery.voices.length },
    { key: 'bgms', label: t('assetLibrary.tabBgms', 'BGM'), icon: <Music size={14} />, count: bgmsQuery.bgms.length },
    { key: 'videos', label: t('assetLibrary.tabVideos', '视频片段'), icon: <Film size={14} />, count: videosQuery.videos.length },
  ];

  const byFilter = <T extends { archived?: boolean }>(items: T[]): T[] => {
    if (archiveFilter === 'active') return items.filter(i => !i.archived);
    if (archiveFilter === 'archived') return items.filter(i => i.archived);
    return items;
  };

  const deleteAsset = async (kind: AssetKind, id: string, name: string) => {
    const ok = await confirm.confirm({
      title: t('assetLibrary.deleteTitle', '删除素材'),
      message: t('assetLibrary.deleteConfirm', '删除后不可恢复，确定删除该素材？') + '\n' + t('assetLibrary.deleteRefHint', '该素材可能被多个故事引用，删除后引用将失效。'),
      confirmLabel: t('assetLibrary.deleteBtn', '删除'), danger: true,
    });
    if (!ok) return;
    try {
      if (kind === 'image') await assetLibraryService.deleteImage(id);
      else if (kind === 'voice') await assetLibraryService.deleteVoice(id);
      else if (kind === 'bgm') await assetLibraryService.deleteBgm(id);
      else await assetLibraryService.deleteVideo(id);
      toast.showToast('success', t('assetLibrary.deleteSuccess', '素材已删除') + '：' + name);
      refetchAssets();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.deleteFailed', '删除失败') + (e instanceof Error ? ': ' + e.message : ''));
    }
  };

  const deleteCut = async (cut: FinalCut) => {
    const ok = await confirm.confirm({
      title: t('assetLibrary.deleteTitle', '删除素材'),
      message: t('assetLibrary.cutDeleteHint', '将删除该成片及其版本链记录，确定删除？'),
      confirmLabel: t('assetLibrary.deleteBtn', '删除'), danger: true,
    });
    if (!ok) return;
    try {
      await finalCutRepo.delete(cut.id);
      toast.showToast('success', t('assetLibrary.deleteSuccess', '素材已删除'));
      await loadCuts();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.deleteFailed', '删除失败') + (e instanceof Error ? ': ' + e.message : ''));
    }
  };

  const renameAsset = async (kind: AssetKind, id: string, name: string) => {
    if (!name.trim()) { toast.showToast('error', t('assetLibrary.renameEmpty', '名称不能为空')); return; }
    try {
      await assetLibraryService.renameAsset(kind, id, name.trim());
      toast.showToast('success', t('assetLibrary.renameSuccess', '已重命名'));
      refetchAssets();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.renameFailed', '重命名失败') + (e instanceof Error ? ': ' + e.message : ''));
    } finally {
      setRenaming(null);
    }
  };

  const toggleArchive = async (kind: AssetKind, id: string, archived: boolean, name: string) => {
    try {
      await assetLibraryService.setAssetArchived(kind, id, archived);
      toast.showToast('success', archived ? t('assetLibrary.archived', '已归档') : t('assetLibrary.unarchived', '已取消归档') + '：' + name);
      refetchAssets();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.archiveFailed', '操作失败') + (e instanceof Error ? ': ' + e.message : ''));
    }
  };

  const toggleCutArchive = async (cut: FinalCut) => {
    try {
      await finalCutRepo.save({ ...cut, archived: !cut.archived });
      toast.showToast('success', cut.archived ? t('assetLibrary.unarchived', '已取消归档') : t('assetLibrary.archived', '已归档'));
      await loadCuts();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.archiveFailed', '操作失败') + (e instanceof Error ? ': ' + e.message : ''));
    }
  };

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const batchDelete = async () => {
    const n = selected.size;
    if (n === 0) return;
    const ok = await confirm.confirm({
      title: t('assetLibrary.batchDeleteTitle', '批量删除'),
      message: t('assetLibrary.batchDeleteConfirm', '将删除选中的 {n} 项资产') + '\n' + t('assetLibrary.deleteRefHint', '该素材可能被多个故事引用，删除后引用将失效。'),
      confirmLabel: t('assetLibrary.deleteBtn', '删除'), danger: true,
    });
    if (!ok) return;
    try {
      for (const key of Array.from(selected)) {
        const [k, id] = key.split('|');
        if (k === 'cut') await finalCutRepo.delete(id);
        else if (k === 'image') await assetLibraryService.deleteImage(id);
        else if (k === 'voice') await assetLibraryService.deleteVoice(id);
        else if (k === 'bgm') await assetLibraryService.deleteBgm(id);
        else if (k === 'video') await assetLibraryService.deleteVideo(id);
      }
      toast.showToast('success', t('assetLibrary.batchDeleteSuccess', '已删除 {n} 项资产').replace('{n}', String(n)));
      setSelected(new Set());
      refetchAssets();
      await loadCuts();
    } catch (e) {
      toast.showToast('error', t('assetLibrary.deleteFailed', '删除失败') + (e instanceof Error ? ': ' + e.message : ''));
    }
  };


  const RES_EXPECT: Record<string, { w: number; h: number }> = {
    '512P': { w: 910, h: 512 },
    '720P': { w: 1280, h: 720 },
    '768P': { w: 1366, h: 768 },
    '1080P': { w: 1920, h: 1080 },
  };

  /** P3-6 批量导出成片：逐个 MP4（AI 声明元数据注入）+ SRT + 汇总 CSV（沿用元数据写入口径） */
  const batchExportCuts = async () => {
    const ids = Array.from(selected).filter(k => k.startsWith("cut|")).map(k => k.split("|")[1]);
    if (ids.length === 0) { toast.showToast("error", t("assetLibrary.batchSelectCut", "请先勾选成片")); return; }
    setBatchBusy({ kind: "export", done: 0, total: ids.length });
    const rows: Array<{ file: string; story: string; durationSec: number; size: number; metadata: string; qc: string }> = [];
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const cut = cuts.find(x => x.id === ids[i]);
      if (!cut) { failCount++; setBatchBusy({ kind: "export", done: i + 1, total: ids.length }); continue; }
      try {
        const title = storyTitles[cut.storyId] || cut.id;
        const safe = title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
        const base = safe + "-" + new Date(cut.createdAt).toISOString().slice(0, 10);
        let video = cut.videoBlob;
        let metadataApplied = false;
        try {
          const meta = complianceService.buildAiMetadata(cut.version);
          video = await ffmpegAdapter.withMetadata(cut.videoBlob, { comment: complianceService.serializeAiMetadata(meta) });
          metadataApplied = true;
        } catch {
          // 元数据写入失败不阻断下载（保持可用性，诚实降级）
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(video);
        a.download = base + ".mp4";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        if (cut.srtContent) {
          const s = document.createElement("a");
          s.href = URL.createObjectURL(new Blob([cut.srtContent], { type: "text/plain;charset=utf-8" }));
          s.download = base + ".srt";
          s.click();
          setTimeout(() => URL.revokeObjectURL(s.href), 30000);
        }
        rows.push({
          file: base + ".mp4",
          story: title,
          durationSec: Math.round((cut.duration || 0) / 1000),
          size: video.size,
          metadata: metadataApplied ? "written" : "skipped",
          qc: cut.qcReport ? cut.qcReport.recommendation : "none",
        });
        okCount++;
      } catch {
        failCount++;
      }
      setBatchBusy({ kind: "export", done: i + 1, total: ids.length });
    }
    // 汇总 CSV（沿用元数据写入口径：与单个成片导出一致）
    const header = "file,story,durationSec,size,metadata,qc";
    const csvLines = [header].concat(rows.map(r => [r.file, r.story.replace(/,/g, " "), String(r.durationSec), String(r.size), r.metadata, r.qc].join(",")));
    const csv = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const c2 = document.createElement("a");
    c2.href = URL.createObjectURL(csv);
    c2.download = "batch-export-" + Date.now() + ".csv";
    c2.click();
    setTimeout(() => URL.revokeObjectURL(c2.href), 30000);
    setBatchBusy(null);
    setSelected(new Set());
    toast.showToast("success", t("assetLibrary.batchExportDone", "批量导出完成：成功 {ok} / 失败 {fail}").replace("{ok}", String(okCount)).replace("{fail}", String(failCount)));
  };

  /** P3-6 批量 QC 重检：逐个 runQc，结论持久化到成片 qcReport 并刷新 */
  const batchRunQc = async () => {
    const ids = Array.from(selected).filter(k => k.startsWith("cut|")).map(k => k.split("|")[1]);
    if (ids.length === 0) { toast.showToast("error", t("assetLibrary.batchSelectCut", "请先勾选成片")); return; }
    setBatchBusy({ kind: "qc", done: 0, total: ids.length });
    let passed = 0;
    let issues = 0;
    for (let i = 0; i < ids.length; i++) {
      const cut = cuts.find(x => x.id === ids[i]);
      if (!cut || !cut.videoBlob) { issues++; setBatchBusy({ kind: "qc", done: i + 1, total: ids.length }); continue; }
      try {
        const res = cut.pipelineOptions?.videoResolution ? RES_EXPECT[cut.pipelineOptions.videoResolution] : undefined;
        const report = await qcService.runQc({
          video: cut.videoBlob,
          expectedDurationSec: cut.duration > 0 ? cut.duration / 1000 : undefined,
          expectedWidth: res?.w,
          expectedHeight: res?.h,
          subtitleEndSec: cut.srtContent ? parseSrtEndSec(cut.srtContent) : undefined,
        });
        const snapshot = {
          passed: report.passed,
          recommendation: report.recommendation,
          issueCount: report.issues.length,
          issues: report.issues.map(x => ({ check: x.check, severity: x.severity, message: x.message })),
          checkedAt: report.meta.checkedAt,
        };
        await finalCutRepo.save({ ...cut, qcReport: snapshot });
        if (report.passed) passed++; else issues++;
      } catch {
        issues++;
      }
      setBatchBusy({ kind: "qc", done: i + 1, total: ids.length });
    }
    setBatchBusy(null);
    setSelected(new Set());
    await loadCuts();
    toast.showToast("success", t("assetLibrary.batchQcDone", "批量质检完成：通过 {ok} / 待处理 {fail}").replace("{ok}", String(passed)).replace("{fail}", String(issues)));
  };

  /** 从 SRT 解析字幕最后一条结束时间（秒） */
  const parseSrtEndSec = (srt: string): number | undefined => {
    const times = srt.match(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g);
    if (!times || times.length === 0) return undefined;
    const last = times[times.length - 1];
    const m = last.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };
  const downloadAsset = async (kind: AssetKind, id: string, name: string) => {
    try {
      let url: string | null = null;
      if (kind === 'image') {
        const img = imagesQuery.images.find(i => i.id === id);
        if (img) url = await assetLibraryService.getImageBlobUrl(img);
      } else if (kind === 'voice') {
        const v = voicesQuery.voices.find(x => x.id === id);
        if (v) url = await assetLibraryService.getVoiceBlobUrl(v);
      } else if (kind === 'bgm') {
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

  const renderEmpty = (loading: boolean, count: number, emptyText: string) => {
    if (loading) return <AsyncState loading minHeight={140} />;
    if (count === 0) return <AsyncState empty emptyText={emptyText} minHeight={140} />;
    return null;
  };

  const filterOptions: Array<{ key: ArchiveFilter; label: string }> = [
    { key: 'all', label: t('assetLibrary.filterAll', '全部') },
    { key: 'active', label: t('assetLibrary.filterActive', '未归档') },
    { key: 'archived', label: t('assetLibrary.filterArchived', '已归档') },
  ];

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <h1 className="page-title">{t('assetLibrary.title', '素材库')}</h1>
        <p className="page-subtitle">{t('assetLibrary.subtitle', '成片与素材统一入库，跨故事复用')}</p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 28, width: '100%' }}
            placeholder={t('assetLibrary.searchPlaceholder', '搜索名称 / 故事…')}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          {filterOptions.map(f => (
            <button
              key={f.key}
              className={`tab${archiveFilter === f.key ? ' tab-active' : ''}`}
              style={{ padding: '0.25rem 0.6rem' }}
              onClick={() => setArchiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <>
          <button className="btn btn-primary btn-sm" onClick={() => void batchExportCuts()} disabled={!!batchBusy}>
            <Download size={13} /> {t('assetLibrary.batchExport', '批量导出 {n} 项').replace('{n}', String(Array.from(selected).filter(k => k.startsWith('cut|')).length))}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => void batchRunQc()} disabled={!!batchBusy}>
            <RefreshCw size={13} /> {t('assetLibrary.batchQc', '批量质检 {n} 项').replace('{n}', String(Array.from(selected).filter(k => k.startsWith('cut|')).length))}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => void batchDelete()} disabled={!!batchBusy}>
            <Trash2 size={13} /> {t('assetLibrary.batchDelete', '删除选中 {n} 项').replace('{n}', String(selected.size))}
          </button>
          </>
        )}
      </div>

      {batchBusy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
          {batchBusy.kind === 'export' ? t('assetLibrary.exporting', '正在批量导出…') : t('assetLibrary.qcing', '正在批量质检…')} {batchBusy.done}/{batchBusy.total}
        </div>
      )}

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
        {tab === 'cuts' && (renderEmpty(cutsLoading, cuts.length, t('assetLibrary.cutsEmpty', '暂无成片，导出中心生成的成片会自动归入此处')) ?? byFilter(cuts)
          .filter(c => {
            if (!keyword.trim()) return true;
            const title = storyTitles[c.storyId] || c.id;
            return title.toLowerCase().includes(keyword.trim().toLowerCase());
          })
          .map(c => (
            <AssetCard
              key={c.id}
              title={storyTitles[c.storyId] || t('assetLibrary.untitled', '未命名故事')}
              subtitle={(c.sourcePlatform || 'pipeline') + ' · ' + (c.duration ? c.duration.toFixed(1) + 's' : '') + (c.hasSubtitles ? ' · SRT' : '')}
              preview={<CutPreview cut={c} />}
              archived={c.archived}
              selected={selected.has('cut|' + c.id)}
              onToggleSelect={() => toggleSelect('cut|' + c.id)}
              onArchive={() => void toggleCutArchive(c)}
              onDelete={() => void deleteCut(c)}
            />
          )))}

        {tab === 'images' && (renderEmpty(imagesQuery.loading, imagesQuery.images.length, t('assetLibrary.empty', '暂无素材，生成结果可一键存入素材库')) ?? byFilter(imagesQuery.images).map(img => (
          <AssetCard
            key={img.id}
            title={img.name}
            subtitle={(img.model || '') + ' · ' + new Date(img.createdAt).toLocaleDateString()}
            preview={<ImagePreview img={img} />}
            archived={img.archived}
            renaming={renaming && renaming.kind === 'image' && renaming.id === img.id ? renaming : null}
            onStartRename={() => setRenaming({ kind: 'image', id: img.id, name: img.name })}
            onRenameChange={v => setRenaming(prev => prev ? { ...prev, name: v } : prev)}
            onRenameConfirm={() => renaming && void renameAsset('image', renaming.id, renaming.name)}
            onRenameCancel={() => setRenaming(null)}
            selected={selected.has('image|' + img.id)}
            onToggleSelect={() => toggleSelect('image|' + img.id)}
            onArchive={() => void toggleArchive('image', img.id, !img.archived, img.name)}
            onDelete={() => void deleteAsset('image', img.id, img.name)}
            onDownload={() => downloadAsset('image', img.id, (img.name || img.id) + '.png')}
          />
        )))}

        {tab === 'voices' && (renderEmpty(voicesQuery.loading, voicesQuery.voices.length, t('assetLibrary.empty', '暂无素材，生成结果可一键存入素材库')) ?? byFilter(voicesQuery.voices).map(v => (
          <AssetCard
            key={v.id}
            title={v.name}
            subtitle={(v.model || '') + ' · ' + new Date(v.createdAt).toLocaleDateString()}
            preview={<AudioPreview getUrl={async () => assetLibraryService.getVoiceBlobUrl(v)} />}
            archived={v.archived}
            renaming={renaming && renaming.kind === 'voice' && renaming.id === v.id ? renaming : null}
            onStartRename={() => setRenaming({ kind: 'voice', id: v.id, name: v.name })}
            onRenameChange={v2 => setRenaming(prev => prev ? { ...prev, name: v2 } : prev)}
            onRenameConfirm={() => renaming && void renameAsset('voice', renaming.id, renaming.name)}
            onRenameCancel={() => setRenaming(null)}
            selected={selected.has('voice|' + v.id)}
            onToggleSelect={() => toggleSelect('voice|' + v.id)}
            onArchive={() => void toggleArchive('voice', v.id, !v.archived, v.name)}
            onDelete={() => void deleteAsset('voice', v.id, v.name)}
            onDownload={() => downloadAsset('voice', v.id, (v.name || v.id) + '.mp3')}
          />
        )))}

        {tab === 'bgms' && (renderEmpty(bgmsQuery.loading, bgmsQuery.bgms.length, t('assetLibrary.empty', '暂无素材，生成结果可一键存入素材库')) ?? byFilter(bgmsQuery.bgms).map(b => (
          <AssetCard
            key={b.id}
            title={b.name}
            subtitle={(b.model || '') + ' · ' + (b.durationSec || 0) + 's · ' + new Date(b.createdAt).toLocaleDateString()}
            preview={<AudioPreview getUrl={async () => assetLibraryService.getBgmBlobUrl(b)} />}
            archived={b.archived}
            renaming={renaming && renaming.kind === 'bgm' && renaming.id === b.id ? renaming : null}
            onStartRename={() => setRenaming({ kind: 'bgm', id: b.id, name: b.name })}
            onRenameChange={v => setRenaming(prev => prev ? { ...prev, name: v } : prev)}
            onRenameConfirm={() => renaming && void renameAsset('bgm', renaming.id, renaming.name)}
            onRenameCancel={() => setRenaming(null)}
            selected={selected.has('bgm|' + b.id)}
            onToggleSelect={() => toggleSelect('bgm|' + b.id)}
            onArchive={() => void toggleArchive('bgm', b.id, !b.archived, b.name)}
            onDelete={() => void deleteAsset('bgm', b.id, b.name)}
            onDownload={() => downloadAsset('bgm', b.id, (b.name || b.id) + '.mp3')}
          />
        )))}

        {tab === 'videos' && (renderEmpty(videosQuery.loading, videosQuery.videos.length, t('assetLibrary.empty', '暂无素材，生成结果可一键存入素材库')) ?? byFilter(videosQuery.videos).map(v => (
          <AssetCard
            key={v.id}
            title={v.name}
            subtitle={(v.durationSec || 0) + 's · ' + new Date(v.createdAt).toLocaleDateString()}
            preview={<VideoPreview v={v} />}
            archived={v.archived}
            renaming={renaming && renaming.kind === 'video' && renaming.id === v.id ? renaming : null}
            onStartRename={() => setRenaming({ kind: 'video', id: v.id, name: v.name })}
            onRenameChange={v2 => setRenaming(prev => prev ? { ...prev, name: v2 } : prev)}
            onRenameConfirm={() => renaming && void renameAsset('video', renaming.id, renaming.name)}
            onRenameCancel={() => setRenaming(null)}
            selected={selected.has('video|' + v.id)}
            onToggleSelect={() => toggleSelect('video|' + v.id)}
            onArchive={() => void toggleArchive('video', v.id, !v.archived, v.name)}
            onDelete={() => void deleteAsset('video', v.id, v.name)}
            onDownload={() => downloadAsset('video', v.id, (v.name || v.id) + '.mp4')}
          />
        )))}
      </div>
    </div>
  );
};

function AssetCard(props: {
  title: string; subtitle: string; preview: React.ReactNode;
  onDelete?: () => void; onDownload?: () => void;
  archived?: boolean; onArchive?: () => void;
  onStartRename?: () => void;
  renaming?: { kind: AssetKind; id: string; name: string } | null;
  onRenameChange?: (v: string) => void;
  onRenameConfirm?: () => void;
  onRenameCancel?: () => void;
  selected?: boolean; onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ height: 110, background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {props.preview}
      </div>
      <div style={{ padding: '0.5rem 0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={!!props.selected} onChange={() => props.onToggleSelect && props.onToggleSelect()} />
          </label>
          {props.renaming ? (
            <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
              <input
                autoFocus
                className="form-input"
                style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', padding: '0.15rem 0.35rem' }}
                value={props.renaming.name}
                onChange={e => props.onRenameChange && props.onRenameChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && props.onRenameConfirm) props.onRenameConfirm(); if (e.key === 'Escape' && props.onRenameCancel) props.onRenameCancel(); }}
              />
              <button className="btn btn-primary btn-xs" onClick={() => props.onRenameConfirm && props.onRenameConfirm()}><Check size={12} /></button>
              <button className="btn btn-ghost btn-xs" onClick={() => props.onRenameCancel && props.onRenameCancel()}><X size={12} /></button>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.title}</div>
              {props.onStartRename && (
                <button className="btn btn-ghost btn-xs" style={{ padding: 2 }} onClick={() => props.onStartRename && props.onStartRename()} title={t('assetLibrary.rename', '重命名')}>
                  <Pencil size={11} />
                </button>
              )}
              {props.archived && <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '0 3px' }}>{t('assetLibrary.cutArchived', '已归档')}</span>}
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{props.subtitle}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {props.onDownload && (
            <button className="btn btn-ghost" style={{ flex: 1, padding: '0.25rem 0' }} onClick={props.onDownload}><Download size={12} /> {t('assetLibrary.downloadBtn', '下载')}</button>
          )}
          {props.onArchive && (
            <button className="btn btn-ghost" style={{ flex: 1, padding: '0.25rem 0' }} onClick={props.onArchive} title={props.archived ? t('assetLibrary.unarchive', '取消归档') : t('assetLibrary.archive', '归档')}>
              {props.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />} {props.archived ? t('assetLibrary.unarchiveShort', '取消归档') : t('assetLibrary.archiveShort', '归档')}
            </button>
          )}
          {props.onDelete && (
            <button className="btn btn-ghost" style={{ flex: 1, padding: '0.25rem 0', color: 'var(--color-danger)' }} onClick={props.onDelete}><Trash2 size={12} /> {t('assetLibrary.deleteBtn', '删除')}</button>
          )}
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

function CutPreview(props: { cut: FinalCut }) {
  const { t } = useTranslation();
  const qc = props.cut.qcReport;
  const qcBadge = (r?: QcRecommendation): string => {
    if (r === 'ok') return 'var(--color-success)';
    if (r === 'review') return 'var(--color-warning)';
    if (r === 'regenerate') return 'var(--color-danger)';
    return 'var(--text-secondary)';
  };
  if (qc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
        <span style={{ color: qcBadge(qc.recommendation), fontWeight: 600 }}>
          QC: {qc.recommendation} ({qc.issueCount})
        </span>
        <span>{props.cut.hasSubtitles ? t('assetLibrary.cutWithSrt', '含字幕') : t('assetLibrary.cutNoSrt', '无字幕')}</span>
      </div>
    );
  }
  if (props.cut.thumbnailUrl) {
    return <img src={props.cut.thumbnailUrl} alt={props.cut.id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
      <Clapperboard size={28} />
      <span>{props.cut.hasSubtitles ? t('assetLibrary.cutWithSrt', '含字幕') : t('assetLibrary.cutNoSrt', '无字幕')}</span>
    </div>
  );
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
