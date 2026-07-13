import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Ban, Check } from 'lucide-react';
import { apiConfigStoreAdapter } from '../../dependencies';
import type { PlatformId } from '../../domain/entities/platform';
import { PLATFORM_METADATA } from '../../domain/services/platformCapabilities';
import { usePlatform } from '../contexts/PlatformContext';
import { useToast } from '../contexts/ToastContext';
import './PlatformSwitcher.css';

interface PlatformSwitcherProps {
  /** 折叠态：仅显示平台图标按钮，垂直堆叠时配合语言切换器使用 */
  collapsed?: boolean;
}

/**
 * 平台切换器组件。
 *
 * 由两部分组成：
 *  1. 触发器（平台徽标）：展示当前激活平台的图标 + 名称，点击展开切换菜单
 *  2. 弹出菜单：列出所有平台，激活项高亮，未配置项置灰
 *
 * 设计意图：让用户无需跳转到 Settings 页即可在菜单栏快速切换激活平台。
 * 切换后通过 `ApiConfigStore.save()` 持久化，并触发订阅通知让 MainLayout 即时刷新。
 *
 * 颜色全部走 CSS 变量（`--platform-accent` 由 MainLayout 注入），无 inline style 硬编码。
 */
export const PlatformSwitcher: React.FC<PlatformSwitcherProps> = ({
  collapsed = false,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Esc 键关闭菜单
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // P4-1：走 PlatformContext 订阅 activePlatform，切换后组件即时刷新
  const { activePlatform, platformMeta: activeMeta } = usePlatform();
  const allPlatforms = Object.values(PLATFORM_METADATA);

  const handleSelect = (platform: PlatformId) => {
    // 未配置平台：阻止切换并提示
    if (!apiConfigStoreAdapter.isPlatformConfigured(platform)) {
      showToast('warning', t('nav.platformNotConfigured', { defaultValue: '平台未配置，请前往配置中心填写 API Key' }));
      return;
    }
    // 切换平台：读取最新配置 → 更新 activePlatform → 保存（触发订阅通知）
    const config = apiConfigStoreAdapter.load();
    void apiConfigStoreAdapter.save({ ...config, activePlatform: platform });
    const meta = PLATFORM_METADATA[platform];
    showToast('success', t('settings.platformSwitched', { name: meta?.name ?? platform }));
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="platform-switcher">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`platform-badge ${collapsed ? 'platform-badge-collapsed' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={collapsed
          ? t('nav.platformSwitcherTooltip', { defaultValue: '切换激活平台' })
          : t('nav.activePlatformInfo', {
              name: activeMeta.name,
              brand: activeMeta.brand,
              defaultValue: `${activeMeta.name} (${activeMeta.brand})`,
            })
        }
      >
        <span className="platform-badge-icon">{activeMeta.icon}</span>
        {!collapsed && (
          <>
            <span className="platform-badge-name">{activeMeta.name}</span>
            <ChevronDown size={12} className={`platform-badge-chevron ${open ? 'platform-badge-chevron-open' : ''}`} />
          </>
        )}
      </button>

      {open && (
        <div
          className="platform-dropdown platform-dropdown-up"
          role="listbox"
        >
          <div className="platform-dropdown-header">
            {t('nav.platformSwitcherTooltip', { defaultValue: '切换激活平台' })}
          </div>
          {allPlatforms.map(meta => {
            const isActive = meta.id === activePlatform;
            const isConfigured = apiConfigStoreAdapter.isPlatformConfigured(meta.id);
            return (
              <button
                key={meta.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(meta.id)}
                className={`platform-option ${isActive ? 'platform-option-active' : ''} ${!isConfigured ? 'platform-option-disabled' : ''}`}
                style={{ '--option-accent': meta.accentColor } as React.CSSProperties}
                title={!isConfigured ? t('nav.platformNotConfigured', { defaultValue: '平台未配置' }) : undefined}
              >
                <span className="platform-option-icon">{meta.icon}</span>
                <span className="platform-option-name">{meta.name}</span>
                <span className="platform-option-brand">{meta.brand}</span>
                {isActive ? (
                  <Check size={12} className="platform-option-check" />
                ) : !isConfigured ? (
                  <Ban size={12} className="platform-option-ban" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
