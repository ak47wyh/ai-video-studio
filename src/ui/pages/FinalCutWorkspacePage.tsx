import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Film, Download, ShieldCheck, RefreshCw, Send, GitBranch, Scissors, Clock, LayoutDashboard, ChevronLeft, AlertTriangle } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { AsyncState } from '../components/AsyncState';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { finalCutRepo, storyRepo, qcService, versionCompareService, publishService, complianceService, ffmpegAdapter } from '../../dependencies';
import type { FinalCut } from '../../domain/entities/models';


/**
 * P4-1 成片工作台（FinalCut Workspace）：
 * 单成片详情页 —— 版本时间线切换 + 预览 + QC（含重检持久化）+ 成本 + 字幕 + 下载/发布/回改入口，
 * 让"对比→重检→回改→发布→下载"在一个页面完成（ExportCenter 收敛为列表入口）。
 */

const RES_EXPECT: Record<string, { w: number; h: number }> = {
  '512P': { w: 910, h: 512 },
  '720P': { w: 1280, h: 720 },
  '768P': { w: 1366, h: 768 },
  '1080P': { w: 1920, h: 1080 },
};

function parseSrtEndSec(srt: string): number | undefined {
  const times = srt.match(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g);
  if (!times || times.length === 0) return undefined;
  const last = times[times.length - 1];
  const m = last.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const FinalCutWorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [allCuts, setAllCuts] = useState<FinalCut[]>([]);
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [qcRunning, setQcRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expandedSrt, setExpandedSrt] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      finalCutRepo.listAll ? finalCutRepo.listAll() : Promise.resolve<FinalCut[]>([]),
      storyRepo.findAll(),
    ]).then(([cuts, stories]) => {
      if (!alive) return;
      setAllCuts(cuts);
      const m: Record<string, string> = {};
      for (const s of stories) m[s.id] = s.title;
      setStoryTitles(m);
      if (!cuts.some(c => c.id === selectedId)) setSelectedId(cuts[0]?.id ?? null);
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cut = useMemo(() => allCuts.find(c => c.id === selectedId) ?? null, [allCuts, selectedId]);
  const versions = useMemo(() => {
    if (!cut) return [];
    return versionCompareService.listVersionsByStory(allCuts, cut.storyId);
  }, [allCuts, cut]);

  const videoUrl = useObjectUrl(cut?.videoBlob);
  const cost = useMemo(() => (cut ? versionCompareService.getVersionCost(cut.pipelineTaskId) : null), [cut]);
  const storyTitle = cut ? (storyTitles[cut.storyId] ?? t('workspace.untitledStory', '未命名故事')) : '';

  const handleRunQc = async () => {
    if (!cut) return;
    setQcRunning(true);
    try {
      const res = cut.pipelineOptions?.videoResolution ? RES_EXPECT[cut.pipelineOptions.videoResolution] : undefined;
      const report = await qcService.runQc({
        video: cut.videoBlob,
        expectedDurationSec: cut.duration > 0 ? cut.duration / 1000 : undefined,
        expectedWidth: res?.w,
        expectedHeight: res?.h,
        subtitleEndSec: cut.srtContent ? parseSrtEndSec(cut.srtContent) : undefined,
      });
      const snap = {
        passed: report.passed,
        recommendation: report.recommendation,
        issueCount: report.issues.length,
        issues: report.issues,
        checkedAt: report.meta.checkedAt,
      };
      await finalCutRepo.save({ ...cut, qcReport: snap });
      setAllCuts(prev => prev.map(x => x.id === cut.id ? { ...x, qcReport: snap } : x));
      toast.showToast(report.passed ? 'success' : 'error', report.passed ? t('workspace.qc.done', '质检通过') : t('workspace.qc.issues', '发现 {n} 个质检问题').replace('{n}', String(report.issues.length)));
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setQcRunning(false);
    }
  };

  const handleDownload = async () => {
    if (!cut) return;
    setDownloading(true);
    try {
      let video = cut.videoBlob;
      try {
        const meta = complianceService.buildAiMetadata(cut.version);
        video = await ffmpegAdapter.withMetadata(cut.videoBlob, { comment: complianceService.serializeAiMetadata(meta) });
      } catch {
        // 元数据写入失败不阻断下载
      }
      downloadBlob(video, `${storyTitle}-v${cut.version ?? 1}.mp4`);
      if (cut.srtContent) downloadBlob(new Blob([cut.srtContent], { type: 'text/plain;charset=utf-8' }), `${storyTitle}-v${cut.version ?? 1}.srt`);
      toast.showToast('success', t('workspace.downloaded', '已下载（含 AI 生成声明元数据）'));
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleCreatePublishTask = async () => {
    if (!cut) return;
    const ok = await confirm.confirm({
      title: t('workspace.publish.title', '发起发布'),
      message: t('workspace.publish.confirm', '为当前版本创建发布任务？可在发布管理中继续推进。'),
      confirmLabel: t('workspace.publish.create', '创建任务'),
      danger: false,
    });
    if (!ok) return;
    try {
      await publishService.createTask({
        finalCutId: cut.id,
        storyId: cut.storyId,
        platform: cut.publishChannel ?? 'generic',
        title: storyTitle,
        tags: [],
      });
      toast.showToast('success', t('workspace.publish.created', '发布任务已创建，前往发布管理'));
      navigate('/publish');
    } catch (e) {
      toast.showToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  const qcBadgeColor = (r?: string): string => {
    if (r === 'ok') return 'var(--color-success)';
    if (r === 'review') return 'var(--color-warning)';
    if (r === 'regenerate') return 'var(--color-danger)';
    return 'var(--text-secondary)';
  };

  const srtPreview = useMemo(() => {
    if (!cut?.srtContent) return null;
    const lines = cut.srtContent.split('\n');
    return expandedSrt ? lines : lines.slice(0, 30);
  }, [cut, expandedSrt]);

  if (loading) return <div className="page-container fade-in"><AsyncState loading minHeight={240} /></div>;

  if (!cut) {
    return (
      <div className="page-container fade-in">
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}><ChevronLeft size={14} /> {t('workspace.back', '返回')}</button>
        </div>
        <AsyncState empty emptyText={t('workspace.notFound', '未找到该成片，可能已被删除')} minHeight={200} />
      </div>
    );
  }

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}><ChevronLeft size={14} /> {t('workspace.back', '返回')}</button>
          <h1 className="page-title" style={{ margin: 0 }}>{storyTitle}</h1>
        </div>
        <p className="page-subtitle">
          {t('workspace.subtitle', '成片工作台：对比 / 重检 / 回改 / 发布 / 下载 一处完成')}
        </p>
      </div>

      {/* 版本时间线 */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {versions.map(v => (
          <button
            key={v.id}
            className={`btn btn-sm ${v.id === cut.id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
            onClick={() => setSelectedId(v.id)}
          >
            v{v.version ?? '—'}
            {v.qcReport && (
              <span style={{ marginLeft: 4, color: qcBadgeColor(v.qcReport.recommendation) }}>
                {v.qcReport.recommendation === 'ok' ? '✓' : v.qcReport.recommendation === 'regenerate' ? '!' : '?'}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', boxSizing: 'border-box' }}>
        {/* 左：视频预览 */}
        <div style={{ flex: '1 1 340px', minWidth: 0, boxSizing: 'border-box' }}>
          <div className="card" style={{ padding: '0.6rem' }}>
            <div style={{ aspectRatio: '16/9', background: '#000', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {videoUrl ? (
                <video src={videoUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <Film size={40} style={{ color: 'rgba(255,255,255,0.4)' }} />
              )}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.4rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span>{fmtSize(cut.size)}</span>
              <span><Clock size={11} /> {fmtDuration(cut.duration)}</span>
              <span>{cut.hasSubtitles ? t('workspace.withSubs', '含字幕') : t('workspace.noSubs', '无字幕')}</span>
              <span>{new Date(cut.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: '0.72rem', marginTop: '0.3rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ padding: '0.12rem 0.5rem', borderRadius: 999, background: qcBadgeColor(cut.lifecycle) + '22', color: qcBadgeColor(cut.lifecycle), fontWeight: 600 }}>
                {cut.lifecycle ?? t('workspace.lifecycleDraft', 'draft')}
              </span>
              {cut.publishChannel && (
                <span style={{ padding: '0.12rem 0.5rem', borderRadius: 999, background: 'rgba(155,187,244,0.18)', color: '#4a5fc1', fontWeight: 600 }}>
                  {cut.publishChannel}
                </span>
              )}
            </div>
          </div>

          {/* 操作区 */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" disabled={downloading} onClick={() => void handleDownload()}>
              <Download size={13} /> {downloading ? t('workspace.downloading', '下载中…') : t('workspace.download', '下载')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/editor?storyId=${cut.storyId}`)}>
              <Scissors size={13} /> {t('workspace.rework', '回改（进剪辑）')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/compare?storyId=${cut.storyId}`)}>
              <GitBranch size={13} /> {t('workspace.compare', '版本对比')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => void handleCreatePublishTask()}>
              <Send size={13} /> {t('workspace.publish.create', '创建发布任务')}
            </button>
            <Link className="btn btn-ghost btn-sm" to="/assets">
              <LayoutDashboard size={13} /> {t('workspace.toAssets', '资产中心')}
            </Link>
          </div>
        </div>

        {/* 右：QC / 成本 / 字幕 */}
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', boxSizing: 'border-box' }}>
          <div className="card" style={{ padding: '0.6rem 0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>
              <ShieldCheck size={13} /> {t('workspace.qc.title', '质检')}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: '0.68rem', padding: '0.15rem 0.45rem' }} disabled={qcRunning} onClick={() => void handleRunQc()}>
                <RefreshCw size={11} className={qcRunning ? 'spin' : ''} /> {qcRunning ? t('workspace.qc.running', '检测中…') : t('workspace.qc.recheck', '重检')}
              </button>
            </div>
            {cut.qcReport ? (
              <>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: qcBadgeColor(cut.qcReport.recommendation), marginBottom: '0.2rem' }}>
                  {cut.qcReport.recommendation === 'ok' ? t('workspace.qc.ok', '通过') : cut.qcReport.recommendation === 'review' ? t('workspace.qc.review', '建议复核') : t('workspace.qc.regenerate', '建议重新生成')}
                  {' · '}{new Date(cut.qcReport.checkedAt).toLocaleString()}
                </div>
                {cut.qcReport.issues.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('workspace.qc.noIssues', '无问题')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {cut.qcReport.issues.map((iss, i) => (
                      <div key={i} style={{ fontSize: '0.7rem', color: iss.severity === 'error' ? 'var(--color-danger)' : 'var(--color-warning)', display: 'flex', gap: 4 }}>
                        <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} /> {iss.message}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('workspace.qc.none', '尚未质检 — 点击重检生成快照')}</div>
            )}
          </div>

          <div className="card" style={{ padding: '0.6rem 0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>{t('workspace.cost.title', '版本成本')}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <span>{t('workspace.cost.calls', '调用')}: {cost?.callCount ?? 0}</span>
              <span>{t('workspace.cost.tokens', 'Token')}: {cost?.tokenCount ?? 0}</span>
              {cost && Object.keys(cost.byModel).length > 0 && (
                <span>{t('workspace.cost.models', '模型')}: {Object.entries(cost.byModel).map(([m, n]) => `${m}×${n}`).join(', ')}</span>
              )}
            </div>
          </div>

          {cut.srtContent && (
            <div className="card" style={{ padding: '0.6rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                {t('workspace.srt.title', '字幕')}
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: '0.68rem', padding: '0.15rem 0.45rem' }} onClick={() => setExpandedSrt(!expandedSrt)}>
                  {expandedSrt ? t('workspace.srt.collapse', '收起') : t('workspace.srt.expand', '展开全部')}
                </button>
              </div>
              <pre style={{ fontSize: '0.68rem', lineHeight: 1.5, color: 'var(--text-secondary)', maxHeight: 160, overflowY: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {srtPreview?.join('\n') ?? ''}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FinalCutWorkspacePage;
