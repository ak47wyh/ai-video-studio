/**
 * BackupRestoreSection —— B3 全量备份 / 恢复（设置页）
 *
 * 能力：
 *   - 导出：assetExportPort.exportAllAsJson() 打包全部空间数据（角色/背景/故事/分镜/
 *     视频任务/成片）+ Pipeline 任务 + 成本记录为单个 JSON 文件下载
 *   - 导入：读取备份 JSON → importFromJson 恢复到本地 IndexedDB / localStorage
 *
 * 数据源：AssetExportAdapter（v1 schema，向后兼容：旧备份文件不含
 * pipelineTasks/costRecords 时仍可正常导入）。
 */
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Loader2, HardDrive, CheckCircle2, XCircle } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { assetExportPort } from '../../../dependencies';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export const BackupRestoreSection: React.FC = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setResult(null);
    try {
      const blob = await assetExportPort.exportAllAsJson();
      downloadBlob(blob, `ai-video-studio-backup-${stamp()}.json`);
      setResult({ ok: true, message: t('settings.backup.exportDone', '备份已导出') });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setResult(null);
    try {
      const { imported } = await assetExportPort.importFromJson(file);
      setResult({
        ok: true,
        message: t('settings.backup.importDone', { count: imported, defaultValue: '导入完成：{{count}} 条记录' }),
      });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <SettingsSection
      icon={<HardDrive size={18} />}
      title={t('settings.backup.title', '数据备份与恢复')}
      badge={result?.ok ? { status: 'ready', label: t('settings.backup.ready', '就绪') } : undefined}
    >
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {t('settings.backup.desc', '导出全部本地数据（空间、角色、背景、故事、分镜、视频任务、成片、Pipeline 任务与成本记录）为单个 JSON 文件，可随时导入恢复。')}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn-secondary"
          onClick={handleExport}
          disabled={isExporting}
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          {isExporting ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
          {t('settings.backup.exportBtn', '导出全量备份')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          {isImporting ? <Loader2 size={12} className="spin" /> : <Upload size={12} />}
          {t('settings.backup.importBtn', '导入备份')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      {result && (
        <p style={{ fontSize: '0.8rem', marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: result.ok ? '#34d399' : '#f87171' }}>
          {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {result.message}
        </p>
      )}
    </SettingsSection>
  );
};
