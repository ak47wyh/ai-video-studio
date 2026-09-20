import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Plus, Trash2, Download, Upload, Search } from 'lucide-react';
import { sensitiveWordRepo } from '../../dependencies';
import { ComplianceService } from '../../domain/services/ComplianceService';
import type { SensitiveWordEntry } from '../../domain/entities/models';
import { useToast } from '../contexts/ToastContext';

/** P3-2 合规治理中心：敏感词运营配置（多平台词表 + 命中预览 + 导入导出） */

const PLATFORMS = ['douyin', 'bilibili', 'generic'] as const;
type Platform = (typeof PLATFORMS)[number];

function genId(): string {
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const ComplianceCenterPage: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [platform, setPlatform] = useState<Platform>('douyin');
  const [words, setWords] = useState<SensitiveWordEntry[]>([]);
  const [newWord, setNewWord] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(async (p: Platform) => {
    try {
      setWords(await sensitiveWordRepo.listByPlatform(p));
    } catch {
      setWords([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    sensitiveWordRepo.listByPlatform(platform)
      .then(list => { if (alive) setWords(list); })
      .catch(() => { if (alive) setWords([]); });
    return () => { alive = false; };
  }, [platform]);

  const enabledWords = useMemo(() => words.filter(w => w.enabled !== false).map(w => w.word), [words]);

  const handleAdd = async () => {
    const word = ComplianceService.normalizeWords([newWord])[0];
    if (!word) return;
    if (words.some(w => w.word === word)) {
      showToast('info', t('compliance.duplicate', '该词已存在'));
      return;
    }
    const entry: SensitiveWordEntry = {
      id: genId(),
      word,
      platform,
      enabled: true,
      createdAt: Date.now(),
    };
    await sensitiveWordRepo.put(entry);
    setNewWord('');
    void refresh(platform);
  };

  const handleToggle = async (entry: SensitiveWordEntry) => {
    await sensitiveWordRepo.put({ ...entry, enabled: !(entry.enabled !== false) });
    void refresh(platform);
  };

  const handleDelete = async (id: string) => {
    await sensitiveWordRepo.delete(id);
    void refresh(platform);
  };

  const handleImport = async () => {
    const wordsToAdd = ComplianceService.normalizeWords(importText.split(/[\n,，;；]+/));
    if (wordsToAdd.length === 0) return;
    const existing = new Set(words.map(w => w.word));
    let added = 0;
    for (const word of wordsToAdd) {
      if (existing.has(word)) continue;
      await sensitiveWordRepo.put({
        id: genId(),
        word,
        platform,
        enabled: true,
        createdAt: Date.now(),
      });
      existing.add(word);
      added++;
    }
    showToast('success', t('compliance.imported', { count: added }));
    setImportText('');
    setImportOpen(false);
    void refresh(platform);
  };

  const handleExport = () => {
    const payload = JSON.stringify(words.map(w => ({ word: w.word, enabled: w.enabled !== false, note: w.note })), null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sensitive-words-${platform}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 命中检测与 ComplianceService.checkSensitiveWords 保持一致（大小写不敏感、子串匹配）
  const hits = useMemo(() => {
    if (!previewText || enabledWords.length === 0) return [];
    const lower = previewText.toLowerCase();
    return enabledWords.filter(w => lower.includes(w.toLowerCase()));
  }, [previewText, enabledWords]);

  return (
    <div style={{ padding: '1rem', maxWidth: '920px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ShieldCheck size={17} /> {t('compliance.title', '合规治理中心')}
        </h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {t('compliance.total', '词表')} {words.length} · {t('compliance.enabled', '生效')} {enabledWords.length}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        {PLATFORMS.map(p => (
          <button
            key={p}
            className={platform === p ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            onClick={() => setPlatform(p)}
          >
            {t(`compliance.platform.${p}`, p)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ flex: '1 1 260px', minWidth: 200 }}
          value={newWord}
          onChange={e => setNewWord(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
          placeholder={t('compliance.addPlaceholder', '输入敏感词后回车添加')}
        />
        <button className="btn btn-primary btn-sm" onClick={() => void handleAdd()} disabled={!newWord.trim()}>
          <Plus size={13} /> {t('compliance.add', '添加')}
        </button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(v => !v)}>
            <Upload size={13} /> {t('compliance.import', '导入')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={words.length === 0}>
            <Download size={13} /> {t('compliance.export', '导出')}
          </button>
        </span>
      </div>

      {importOpen && (
        <div style={{ background: '#FFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '0.6rem 0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            {t('compliance.importHint', '每行/逗号分隔一个词，自动去重并规范化')}
          </div>
          <textarea
            className="form-input"
            style={{ width: '100%', minHeight: 70, fontSize: '0.8rem' }}
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="词1, 词2&#10;词3"
          />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(false)}>{t('compliance.close', '关闭')}</button>
            <button className="btn btn-primary btn-sm" onClick={() => void handleImport()} disabled={!importText.trim()}>
              {t('compliance.doImport', '导入')}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#FFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, padding: '0.6rem 0.8rem', marginBottom: '0.8rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
          {t('compliance.previewHint', '命中预览：粘贴标题/简介文本，实时显示命中词条')}
        </div>
        <input
          className="form-input"
          style={{ width: '100%', fontSize: '0.8rem' }}
          value={previewText}
          onChange={e => setPreviewText(e.target.value)}
          placeholder={t('compliance.previewPlaceholder', '输入待发布文案…')}
        />
        {previewText && (
          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
            {hits.length === 0 ? (
              <span style={{ color: 'var(--color-success)' }}>{t('compliance.clean', '未命中敏感词')}</span>
            ) : (
              <span style={{ color: 'var(--color-danger)' }}>
                {t('compliance.hit', '命中')}: {hits.join('、')}
              </span>
            )}
          </div>
        )}
      </div>

      {words.length === 0 ? (
        <div style={{ padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {t('compliance.empty', '该平台暂无词条，添加后发布预检将实时生效')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {words.map(entry => (
            <div
              key={entry.id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.6rem', background: '#FFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, fontSize: '0.82rem' }}
            >
              <span style={{ flex: 1, textDecoration: entry.enabled === false ? 'line-through' : 'none', opacity: entry.enabled === false ? 0.5 : 1 }}>
                {entry.word}
              </span>
              {entry.note && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{entry.note}</span>}
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => void handleToggle(entry)}
                title={t('compliance.toggle', '启用/停用')}
              >
                {entry.enabled === false ? t('compliance.off', '停用') : t('compliance.on', '生效')}
              </button>
              <button className="btn btn-secondary btn-xs" onClick={() => void handleDelete(entry.id)} title={t('compliance.delete', '删除')}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.8rem', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <Search size={11} style={{ verticalAlign: '-1px' }} /> {t('compliance.footnote', '生效词条将自动注入发布预检：命中敏感词的成片发布按钮保持禁用并显示命中词条')}
      </div>
    </div>
  );
};
