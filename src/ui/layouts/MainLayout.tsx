import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Image as ImageIcon, BookOpen,
  FolderOpen, Download, Mic, MessageSquare, Sparkles, Film, Scissors,
  ChevronLeft, ChevronRight, Plus, Zap, Palette, Music as MusicIcon, X, Menu, Eraser,
  Ban
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAllSpaces } from '../hooks/useSpaceScopedQuery';
import { useSpace } from '../contexts/SpaceContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { PlatformSwitcher } from '../components/PlatformSwitcher';
import { storySpaceService } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { usePlatform } from '../contexts/PlatformContext';
import { hasCapability, type Capability } from '../../domain/services/platformCapabilities';
import { ErrorBoundary } from '../components/ErrorBoundary';
import './MainLayout.css';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  /** 是否禁用（能力矩阵不支持） */
  disabled?: boolean;
  /** 禁用原因（tooltip） */
  disabledReason?: string;
  /** 该入口对应的能力（用于能力矩阵校验） */
  capability?: Capability;
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const MainLayout: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpaceId, setCurrentSpaceId } = useSpace();
  const spaces = useAllSpaces();
  const { showToast } = useToast();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // 懒初始化读取 matchMedia，避免在 effect 内同步 setState（react-hooks/set-state-in-effect）
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );

  // 当前激活平台（P4-1：统一走 PlatformContext，取代原本各页面各自 useState + subscribe）
  const { activePlatform, platformMeta: activeMeta } = usePlatform();
  // 保留原变量名，减少下方代码改动

  // 注入平台品牌色 CSS 变量（供 .platform-badge 等组件复用，避免 inline style 硬编码）
  useEffect(() => {
    if (activeMeta?.accentColor) {
      document.documentElement.style.setProperty('--platform-accent', activeMeta.accentColor);
    }
  }, [activeMeta?.accentColor]);

  // Detect mobile viewport — V3 §6.6：用 matchMedia 替代 resize 监听，
  // 性能更优且响应系统偏好变化（如响应式模式切换）
  // 初值已由 useState 懒初始化读取，effect 仅订阅后续变化
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Close mobile menu on route change — 在渲染期间调整 state，避免 effect 内同步 setState
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname);
    setMobileMenuOpen(false);
  }

  const handleSpaceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentSpaceId(e.target.value || null);
  };

  const handleCreateSpace = async () => {
    try {
      await storySpaceService.createSpace(t('space.defaultName', '新空间'), '');
      showToast('success', t('space.createSuccess'));
    } catch {
      showToast('error', t('space.createFailed', '创建空间失败'));
    }
  };

  const navGroups: NavGroup[] = [
    {
      key: 'overview',
      label: t('nav.groupOverview', '总览'),
      items: [
        { to: '/', icon: <LayoutDashboard size={18} />, label: t('nav.dashboard') },
      ],
    },
    {
      key: 'assets',
      label: t('nav.groupAssets', '素材'),
      items: [
        { to: '/characters', icon: <Users size={18} />, label: t('nav.characters') },
        { to: '/backgrounds', icon: <Palette size={18} />, label: t('nav.backgrounds') },
        { to: '/spaces', icon: <FolderOpen size={18} />, label: t('nav.spaces') },
      ],
    },
    {
      key: 'creation',
      label: t('nav.groupCreation', '创作'),
      items: [
        { to: '/story-film', icon: <Zap size={18} />, label: t('nav.storyFilm', 'AI 成片') },
        { to: '/workbench', icon: <BookOpen size={18} />, label: t('nav.workbench') },
        { to: '/editor', icon: <Scissors size={18} />, label: t('nav.editor', '视频剪辑') },
        { to: '/export', icon: <Download size={18} />, label: t('nav.export', '导出中心') },
      ],
    },
    {
      key: 'ai',
      label: t('nav.groupAI', 'AI 实验室'),
      items: [
        { to: '/labs/image', icon: <ImageIcon size={18} />, label: t('nav.imageLab', '图片生成'), capability: 'image' },
        { to: '/labs/video', icon: <Film size={18} />, label: t('nav.videoLab', '视频生成'), capability: 'video' },
        { to: '/labs/voice', icon: <Mic size={18} />, label: t('nav.voiceLab', '音色与配音'), capability: 'voice' },
        { to: '/labs/music', icon: <MusicIcon size={18} />, label: t('nav.musicLab', '音乐生成'), capability: 'music' },
        { to: '/labs/text', icon: <MessageSquare size={18} />, label: t('nav.textLab', '文本润色'), capability: 'text' },
        { to: '/labs/watermark', icon: <Eraser size={18} />, label: t('nav.watermarkLab', '去水印') },
        { to: '/labs/enhance', icon: <Sparkles size={18} />, label: t('nav.enhanceLab', '清晰度提升') },
      ],
    },
  ];

  // 根据当前激活平台的能力矩阵，计算每个 Lab 入口的禁用状态
  const navGroupsWithState: NavGroup[] = useMemo(() => navGroups.map(group => ({
    ...group,
    items: group.items.map(item => {
      if (!item.capability) return item;
      const supported = hasCapability(activePlatform, item.capability);
      return {
        ...item,
        disabled: !supported,
        disabledReason: supported ? undefined : t('nav.capabilityNotSupported', { platform: activeMeta?.name ?? activePlatform }),
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [activePlatform, t]);

  // 判断当前路径属于哪个创作步骤（用于流程指示器）
  const creationSteps = ['/story-film', '/characters', '/backgrounds', '/workbench', '/export'];
  const currentStepIndex = creationSteps.indexOf(location.pathname);

  // Bottom nav items (mobile) — most important 5
  const bottomNavItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: t('nav.dashboard'), end: true },
    { to: '/workbench', icon: <BookOpen size={20} />, label: t('nav.workbench') },
    { to: '/labs/image', icon: <ImageIcon size={20} />, label: t('nav.imageLab', '图片') },
    { to: '/labs/voice', icon: <Mic size={20} />, label: t('nav.voiceLab', '配音') },
    { to: '/export', icon: <Download size={20} />, label: t('nav.export', '导出') },
  ];

  return (
    <div className={`layout-container ${isMobile ? 'layout-mobile' : ''}`}>
      {/* Mobile Top Bar */}
      {isMobile && (
        <header className="mobile-topbar">
          <div className="mobile-topbar-brand">
            <div className="logo-icon" style={{ width: 28, height: 28 }}>
              <Zap size={16} />
            </div>
            <span className="mobile-topbar-title">AI Video Studio</span>
          </div>
          <div className="mobile-topbar-actions">
            <LanguageSwitcher collapsed dropUp={false} />
            <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </header>
      )}

      {/* Mobile Drawer Overlay */}
      {isMobile && mobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sidebar — Desktop: always visible, Mobile: drawer */}
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${isMobile ? 'sidebar-mobile' : ''} ${mobileMenuOpen ? 'sidebar-mobile-open' : ''}`}>
        {/* Close button for mobile drawer */}
        {isMobile && (
          <button className="mobile-drawer-close" onClick={() => setMobileMenuOpen(false)}>
            <X size={20} />
          </button>
        )}

        {/* Collapse button — desktop only */}
        {!isMobile && (
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? t('nav.expand', '展开') : t('nav.collapse', '收起')}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}

        {/* Logo */}
        <div className="sidebar-header">
          <div className="logo-icon">
            <Zap size={20} />
          </div>
          {(!collapsed || isMobile) && <h2 className="logo-text">AI Video Studio</h2>}
        </div>

        {/* 激活平台徽标已移至 sidebar-footer，与语言切换器并排显示 */}

        {/* Space Switcher */}
        {(!collapsed || isMobile) && (
          <div className="space-switcher">
            <select
              className="form-select space-select"
              value={currentSpaceId ?? ''}
              onChange={handleSpaceChange}
            >
              {(spaces ?? []).map(space => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <button className="space-add-btn" onClick={handleCreateSpace} title={t('space.newBtn')} aria-label={t('space.newBtn', '新建空间')}>
              <Plus size={14} />
            </button>
          </div>
        )}

        {/* Creation Flow — desktop only */}
        {!isMobile && !collapsed && currentStepIndex >= 0 && (
          <div className="creation-flow">
            <div className="flow-label">
              <Film size={12} />
              <span>{t('nav.creationFlow', '创作流程')}</span>
            </div>
            <div className="flow-steps">
              {[
                { icon: <Users size={10} />, label: t('nav.flowCharacters', '角色') },
                { icon: <Palette size={10} />, label: t('nav.flowBackgrounds', '场景') },
                { icon: <Sparkles size={10} />, label: t('nav.flowGenerate', '生成') },
                { icon: <Download size={10} />, label: t('nav.flowExport', '导出') },
              ].map((step, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div className={`flow-connector ${i <= currentStepIndex ? 'completed' : ''}`} />}
                  <div className={`flow-step ${i < currentStepIndex ? 'done' : ''} ${i === currentStepIndex ? 'current' : ''} ${i > currentStepIndex ? 'pending' : ''}`}>
                    <div className="flow-dot">{step.icon}</div>
                    <span className="flow-step-label">{step.label}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navGroupsWithState.map(group => (
            <div key={group.key} className="nav-group">
              {(!collapsed || isMobile) && <div className="nav-group-label">{group.label}</div>}
              {group.items.map(item => {
                // 禁用态：能力矩阵不支持，渲染为置灰 span + tooltip
                if (item.disabled) {
                  return (
                    <span
                      key={item.to}
                      className={`nav-item nav-item-disabled ${collapsed && !isMobile ? 'nav-item-collapsed' : ''}`}
                      title={item.disabledReason ?? t('nav.capabilityNotSupportedDefault')}
                      aria-disabled={true}
                    >
                      <span className="nav-icon" style={{ position: 'relative' }}>
                        {item.icon}
                        <Ban size={10} style={{ position: 'absolute', bottom: -2, right: -2, color: 'var(--text-muted)' }} />
                      </span>
                      {(!collapsed || isMobile) && <span className="nav-label">{item.label}</span>}
                    </span>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${collapsed && !isMobile ? 'nav-item-collapsed' : ''}`}
                    title={collapsed && !isMobile ? item.label : undefined}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {(!collapsed || isMobile) && <span className="nav-label">{item.label}</span>}
                    {(!collapsed || isMobile) && item.badge && <span className="nav-badge">{item.badge}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer — 激活平台徽标 + 语言切换器并排工具条（桌面端） */}
        {!isMobile && (
          <div className={`sidebar-footer ${collapsed ? 'sidebar-footer-collapsed' : ''}`}>
            {collapsed ? (
              // 折叠态：平台图标按钮 + 语言图标按钮垂直堆叠
              <div className="sidebar-footer-stack">
                <PlatformSwitcher collapsed />
                <LanguageSwitcher collapsed />
              </div>
            ) : (
              // 展开态：平台徽标 + 语言切换器横向并排
              <div className="sidebar-footer-toolbar">
                <PlatformSwitcher />
                <LanguageSwitcher />
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="glass-panel main-panel">
          <ErrorBoundary variant="route">
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="mobile-bottom-nav">
          {bottomNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `mobile-bottom-nav-item ${isActive ? 'mobile-bottom-nav-active' : ''}`}
            >
              {item.icon}
              <span className="mobile-bottom-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
};