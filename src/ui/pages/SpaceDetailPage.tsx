/**
 * SpaceDetailPage — 故事空间详情页
 *
 * 展示单个故事空间的资产总览（图片/角色/背景/故事），
 * 支持空间信息编辑、删除、资产浏览和管理。
 * 路由：/spaces/:id
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Pencil, Trash2, Image as ImageIcon, Users, Palette, BookOpen,
  Search, Download, Zap, FileText
} from 'lucide-react';
import { storySpaceService, characterRepo, backgroundRepo, storyService, assetLibraryService, spaceQueryPort } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { InputWithCounter } from '../components/InputWithCounter';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { BatchCompressDialog } from '../components/BatchCompressDialog';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';
import type { StorySpace, SavedImage, Character, Background, Story } from '../../domain/entities/models';
import type { SpaceAssetCounts } from '../../domain/ports/SpaceQueryPort';

type TabKey = 'images' | 'characters' | 'backgrounds' | 'stories';

/**
 * 通用空间查询 Hook -- 封装 spaceQueryPort 订阅 + cancelled 守卫模式。
 * 自动在数据变更时重新查询，组件卸载时取消订阅。
 *
 * @param queryFn 查询函数（返回 Promise）
 * @param deps 依赖数组，控制何时重新订阅
 * @returns 查询结果（初始为 undefined）
 */
function useSpaceQuery<T>(
  queryFn: () => Promise<T>,
  deps: React.DependencyList,
): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      queryFn()
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((e) => {
          console.warn('[useSpaceQuery] query failed', e);
        });
    };
    run();
    const unsubscribe = spaceQueryPort.subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // queryFn 由调用方通过 deps 控制重新订阅时机，此处禁用避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}

export const SpaceDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  // --- 空间信息（通过 useSpaceQuery 订阅，替代手动 useEffect + subscribe 模式） ---
  const space = useSpaceQuery<StorySpace | undefined>(
    () => (id ? spaceQueryPort.getSpace(id) : Promise.resolve(undefined)),
    [id],
  );

  // --- 编辑态 ---
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // --- Tab 态 ---
  const [activeTab, setActiveTab] = useState<TabKey>('images');

  // --- 各资产数量（用于 Tab 栏计数） ---
  const counts = useSpaceQuery<SpaceAssetCounts>(
    () => (id ? spaceQueryPort.countBySpace(id) : Promise.resolve({ images: 0, characters: 0, backgrounds: 0, stories: 0 })),
    [id],
  ) ?? { images: 0, characters: 0, backgrounds: 0, stories: 0 };

  // --- 空间不存在 ---
  if (!space) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
          {t('space.notFound', '空间不存在或已删除')}
        </p>
        <button className="btn btn-secondary" onClick={() => navigate('/spaces')}>
          <ArrowLeft size={16} /> {t('space.backToList', '返回空间列表')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* 返回按钮 */}
      <button
        className="btn btn-secondary"
        onClick={() => navigate('/spaces')}
        style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
      >
        <ArrowLeft size={16} /> {t('space.backToList', '返回空间列表')}
      </button>

      {/* 空间信息 Header */}
      <SpaceHeader
        space={space}
        isEditing={isEditing}
        editName={editName}
        editDesc={editDesc}
        onEditNameChange={setEditName}
        onEditDescChange={setEditDesc}
        onEditToggle={() => {
          if (isEditing) {
            // 取消编辑
            setIsEditing(false);
            setEditName(space.name);
            setEditDesc(space.description);
          } else {
            // 开始编辑
            setEditName(space.name);
            setEditDesc(space.description);
            setIsEditing(true);
          }
        }}
        onSave={async () => {
          if (!editName.trim()) return;
          await storySpaceService.updateSpace({ ...space, name: editName.trim(), description: editDesc.trim() });
          showToast('success', t('space.updateSuccess'));
          setIsEditing(false);
        }}
        onDelete={async () => {
          const ok = await confirm({
            title: t('space.confirmDeleteTitle'),
            message: t('space.confirmDelete'),
            confirmLabel: t('space.deleteConfirmBtn'),
            danger: true,
          });
          if (!ok) return;
          await storySpaceService.deleteSpace(space.id);
          showToast('success', t('space.deleteSuccess'));
          navigate('/spaces');
        }}
      />

      {/* Tab 栏 */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} counts={counts} />

      {/* Tab 内容区 */}
      <div style={{ marginTop: '1rem' }}>
        {activeTab === 'images' && <ImagesTab spaceId={id!} />}
        {activeTab === 'characters' && <CharactersTab spaceId={id!} />}
        {activeTab === 'backgrounds' && <BackgroundsTab spaceId={id!} />}
        {activeTab === 'stories' && <StoriesTab spaceId={id!} />}
      </div>
    </div>
  );
};

// ============================================================
// SpaceHeader — 空间信息展示/编辑
// ============================================================
interface SpaceHeaderProps {
  space: StorySpace;
  isEditing: boolean;
  editName: string;
  editDesc: string;
  onEditNameChange: (v: string) => void;
  onEditDescChange: (v: string) => void;
  onEditToggle: () => void;
  onSave: () => void;
  onDelete: () => void;
}

const SpaceHeader: React.FC<SpaceHeaderProps> = ({
  space,
  isEditing,
  editName,
  editDesc,
  onEditNameChange,
  onEditDescChange,
  onEditToggle,
  onSave,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        {/* 空间图标 */}
        <div style={{
          width: 48,
          height: 48,
          borderRadius: '0.5rem',
          background: 'var(--primary-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: '1.2rem',
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {space.name.charAt(0).toUpperCase()}
        </div>

        {/* 空间名称 + 描述 */}
        <div style={{ flex: 1 }}>
          {isEditing ? (
            <>
              <InputWithCounter
                value={editName}
                onChange={e => onEditNameChange(e.target.value)}
                maxLength={TEXT_LIMITS.SPACE_NAME_MAX}
                style={{ marginBottom: '0.5rem' }}
              />
              <TextAreaWithCounter
                value={editDesc}
                onChange={e => onEditDescChange(e.target.value)}
                maxLength={TEXT_LIMITS.SPACE_DESC_MAX}
                rows={2}
                style={{ width: '100%' }}
              />
            </>
          ) : (
            <>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{space.name}</h2>
              {space.description && (
                <p style={{ color: 'var(--text-muted)', margin: '0.3rem 0 0', fontSize: '0.85rem' }}>
                  {space.description}
                </p>
              )}
            </>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          {isEditing ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={onSave}>
                {t('space.saveBtn')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onEditToggle}>
                {t('space.cancelBtn')}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onEditToggle} title={t('space.editTitle')}>
                <Pencil size={14} /> {t('space.editTitle')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onDelete} title={t('common.delete')} style={{ color: 'var(--color-danger)' }}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// TabBar — Tab 切换栏
// ============================================================
interface TabCounts {
  images: number;
  characters: number;
  backgrounds: number;
  stories: number;
}

interface TabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  counts: TabCounts;
}

const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, counts }) => {
  const { t } = useTranslation();

  const tabs = [
    { key: 'images' as TabKey, label: t('space.tabImages', '图片'), icon: <ImageIcon size={14} />, count: counts.images },
    { key: 'characters' as TabKey, label: t('space.tabCharacters', '角色'), icon: <Users size={14} />, count: counts.characters },
    { key: 'backgrounds' as TabKey, label: t('space.tabBackgrounds', '背景'), icon: <Palette size={14} />, count: counts.backgrounds },
    { key: 'stories' as TabKey, label: t('space.tabStories', '故事'), icon: <BookOpen size={14} />, count: counts.stories },
  ];

  return (
    <div className="lab-tabs">
      {tabs.map(tab => (
        <button
          key={tab.key}
          className={`lab-tab ${activeTab === tab.key ? 'lab-tab-active' : ''}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.icon} {tab.label}({tab.count})
        </button>
      ))}
    </div>
  );
};

// ============================================================
// ImagesTab — 图片资产 Tab
// ============================================================
interface ImagesTabProps {
  spaceId: string;
}

const ImagesTab: React.FC<ImagesTabProps> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // 通过 useSpaceQuery 订阅图片资产
  const allImages = useSpaceQuery<SavedImage[]>(
    () => spaceQueryPort.listImagesBySpace(spaceId),
    [spaceId],
  ) ?? [];

  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCompressDialog, setShowCompressDialog] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  // 筛选
  const filteredImages = allImages.filter(img => {
    if (keyword) {
      const kw = keyword.toLowerCase();
      return img.name.toLowerCase().includes(kw)
        || img.tags.some(tg => tg.toLowerCase().includes(kw))
        || (img.prompt || '').toLowerCase().includes(kw);
    }
    return true;
  });

  // 加载缩略图 URL
  useEffect(() => {
    let cancelled = false;
    const imgs = allImages;
    const localUrls: Record<string, string> = {};
    (async () => {
      for (const img of imgs) {
        try {
          localUrls[img.id] = await assetLibraryService.getImageBlobUrl(img);
        } catch {
          localUrls[img.id] = '';
        }
      }
      if (!cancelled) setUrls(localUrls);
    })();
    return () => {
      cancelled = true;
      Object.values(localUrls).forEach(u => { if (u) URL.revokeObjectURL(u); });
    };
  }, [allImages]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await assetLibraryService.deleteImage(id);
      showToast('success', t('fileManager.deleteSuccess', '已删除'));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) {
      showToast('error', t('fileManager.deleteFailed', '删除失败：{{msg}}', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleDownload = async (id: string) => {
    const img = allImages.find(i => i.id === id);
    if (!img) return;
    const url = urls[id];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${img.name}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await handleDelete(id);
    }
  };

  if (allImages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        {t('space.imagesEmpty', '该空间暂无已保存的图片')}
      </div>
    );
  }

  return (
    <div>
      {/* 搜索栏 */}
      <div style={{ position: 'relative', marginBottom: '0.75rem', maxWidth: '400px' }}>
        <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder={t('fileManager.searchPlaceholder', '搜索名称/标签/提示词...')}
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: '100%', padding: '0.4rem 0.4rem 0.4rem 2rem', boxSizing: 'border-box' }}
          maxLength={100}
        />
      </div>

      {/* 批量操作工具栏 */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', gap: '0.5rem', padding: '0.6rem 0.8rem',
          background: 'var(--bg-secondary, rgba(255,255,255,0.05))',
          borderRadius: '0.4rem', marginBottom: '0.75rem', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.85rem' }}>
            {t('fileManager.selected', '已选 {{count}} 项', { count: selectedIds.size })}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-xs" onClick={() => setShowCompressDialog(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Zap size={14} /> {t('fileManager.batchCompress', '批量压缩')}
          </button>
          <button className="btn btn-secondary btn-xs" onClick={handleBatchDelete} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Trash2 size={14} /> {t('fileManager.batchDelete', '批量删除')}
          </button>
          <button className="btn btn-secondary btn-xs" onClick={() => setSelectedIds(new Set())}>
            {t('fileManager.clearSelection', '取消选择')}
          </button>
        </div>
      )}

      {/* 图片网格 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '0.8rem',
      }}>
        {filteredImages.map(img => (
          <div
            key={img.id}
            style={{
              border: selectedIds.has(img.id) ? '2px solid var(--primary-color, #3b82f6)' : '1px solid var(--border-color, #333)',
              borderRadius: '0.4rem',
              overflow: 'hidden',
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={() => toggleSelect(img.id)}
          >
            {urls[img.id] ? (
              <img src={urls[img.id]} alt={img.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', aspectRatio: '1', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={24} style={{ color: 'var(--text-muted)' }} />
              </div>
            )}
            <div style={{ padding: '0.4rem' }}>
              <div style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {img.name}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {img.sourceType}
              </div>
            </div>
            {/* 悬浮操作 */}
            <div style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', display: 'flex', gap: '0.2rem', opacity: 0.8 }}>
              <button
                onClick={e => { e.stopPropagation(); handleDownload(img.id); }}
                style={{ background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '0.2rem', cursor: 'pointer', color: '#fff', padding: '0.2rem' }}
                title={t('common.download', '下载')}
              >
                <Download size={12} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(img.id); }}
                style={{ background: 'color-mix(in srgb, var(--color-danger) 70%, transparent)', border: 'none', borderRadius: '0.2rem', cursor: 'pointer', color: '#fff', padding: '0.2rem' }}
                title={t('common.delete', '删除')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 批量压缩对话框 */}
      {showCompressDialog && (
        <BatchCompressDialog
          imageIds={Array.from(selectedIds)}
          onClose={() => setShowCompressDialog(false)}
          onComplete={() => {
            setSelectedIds(new Set());
            showToast('success', t('fileManager.compressComplete', '压缩完成，素材已更新'));
          }}
        />
      )}
    </div>
  );
};

// ============================================================
// CharactersTab — 角色资产 Tab
// ============================================================
interface CharactersTabProps {
  spaceId: string;
}

const CharactersTab: React.FC<CharactersTabProps> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const characters = useSpaceQuery<Character[]>(
    () => spaceQueryPort.listCharactersBySpace(spaceId),
    [spaceId],
  ) ?? [];

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('character.confirmDeleteTitle'),
      message: t('character.confirmDelete'),
      confirmLabel: t('character.deleteConfirmBtn'),
      danger: true,
    });
    if (!ok) return;
    await storyService.removeCharacterFromSegments(id);
    await characterRepo.delete(id);
    showToast('success', t('character.deleteSuccess'));
  };

  if (characters.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        {t('space.charactersEmpty', '该空间暂无角色')}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
      {characters.map(char => (
        <div
          key={char.id}
          className="glass-panel"
          style={{ padding: '0.75rem', cursor: 'pointer', position: 'relative' }}
          onClick={() => navigate(`/characters?spaceId=${spaceId}`)}
        >
          {char.referenceImageUrl && (
            <img
              src={char.referenceImageUrl}
              alt={char.name}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.3rem', marginBottom: '0.5rem' }}
            />
          )}
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{char.name}</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            {new Date(char.createdAt).toLocaleDateString()}
          </p>
          <div style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', display: 'flex', gap: '0.2rem' }}>
            <button
              className="btn btn-secondary btn-xs"
              style={{ padding: '0.2rem', border: 'none' }}
              onClick={e => { e.stopPropagation(); handleDelete(char.id); }}
              title={t('common.delete')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// BackgroundsTab — 背景资产 Tab
// ============================================================
interface BackgroundsTabProps {
  spaceId: string;
}

const BackgroundsTab: React.FC<BackgroundsTabProps> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const backgrounds = useSpaceQuery<Background[]>(
    () => spaceQueryPort.listBackgroundsBySpace(spaceId),
    [spaceId],
  ) ?? [];

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('background.confirmDeleteTitle'),
      message: t('background.confirmDelete'),
      confirmLabel: t('background.deleteConfirmBtn'),
      danger: true,
    });
    if (!ok) return;
    await storyService.removeBackgroundFromSegments(id);
    await backgroundRepo.delete(id);
    showToast('success', t('background.deleteSuccess'));
  };

  if (backgrounds.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        {t('space.backgroundsEmpty', '该空间暂无背景')}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
      {backgrounds.map(bg => (
        <div
          key={bg.id}
          className="glass-panel"
          style={{ padding: '0.75rem', cursor: 'pointer', position: 'relative' }}
          onClick={() => navigate(`/backgrounds?spaceId=${spaceId}`)}
        >
          {bg.referenceImageUrl && (
            <img
              src={bg.referenceImageUrl}
              alt={bg.name}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '0.3rem', marginBottom: '0.5rem' }}
            />
          )}
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{bg.name}</h4>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            {new Date(bg.createdAt).toLocaleDateString()}
          </p>
          <div style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', display: 'flex', gap: '0.2rem' }}>
            <button
              className="btn btn-secondary btn-xs"
              style={{ padding: '0.2rem', border: 'none' }}
              onClick={e => { e.stopPropagation(); handleDelete(bg.id); }}
              title={t('common.delete')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// StoriesTab — 故事资产 Tab
// ============================================================
interface StoriesTabProps {
  spaceId: string;
}

const StoriesTab: React.FC<StoriesTabProps> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const stories = useSpaceQuery<Story[]>(
    () => spaceQueryPort.listStoriesBySpace(spaceId),
    [spaceId],
  ) ?? [];

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('story.confirmDeleteTitle'),
      message: t('story.confirmDelete'),
      confirmLabel: t('story.deleteConfirmBtn'),
      danger: true,
    });
    if (!ok) return;
    await storyService.deleteStory(id);
    showToast('success', t('story.deleteSuccess'));
  };

  if (stories.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        {t('space.storiesEmpty', '该空间暂无故事')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {stories.map(story => (
        <div
          key={story.id}
          className="glass-panel"
          style={{ padding: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          onClick={() => navigate(`/workbench?story=${story.id}`)}
        >
          <BookOpen size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{story.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {new Date(story.createdAt).toLocaleDateString()}
            </div>
          </div>
          <span style={{
            fontSize: '0.7rem',
            padding: '0.15rem 0.4rem',
            borderRadius: '0.2rem',
            background: story.status === 'DRAFT' ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)',
            color: story.status === 'DRAFT' ? 'var(--primary-color)' : 'var(--color-success)',
          }}>
            {story.status}
          </span>
          <button
            className="btn btn-secondary btn-xs"
            style={{ padding: '0.3rem', border: 'none', flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); handleDelete(story.id); }}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};