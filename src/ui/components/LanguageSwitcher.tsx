import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../i18n';
import './LanguageSwitcher.css';

interface LanguageSwitcherProps {
  /** 折叠态：仅显示 Globe 图标，不显示语言名称与箭头（侧边栏折叠时使用） */
  collapsed?: boolean;
  /** 弹出方向：true=向上弹出（默认，侧边栏底部场景），false=向下弹出（移动端顶栏场景） */
  dropUp?: boolean;
}

/**
 * 语言切换器组件。
 *
 * 支持两种显示形态：
 *  - 展开态：`Globe + 当前语言 nativeName + ChevronDown`，完整按钮
 *  - 折叠态：仅 `Globe` 图标，配合 tooltip 说明
 *
 * 弹出方向通过 `dropUp` 控制，避免在移动端顶栏被遮挡。
 * 颜色全部走 CSS 变量（`--bg-panel` / `--border-color` / `--platform-accent-soft`），
 * 不再硬编码 `rgba(...)`。
 */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  collapsed = false,
  dropUp = true,
}) => {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Esc 键关闭菜单（键盘可访问性）
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  const handleSelect = (code: LanguageCode) => {
    void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="language-switcher">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`language-trigger ${collapsed ? 'language-trigger-collapsed' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={collapsed ? t('nav.languageSwitcherTooltip', { defaultValue: '切换语言' }) : undefined}
      >
        <Globe size={collapsed ? 18 : 16} />
        {!collapsed && <span className="language-current">{currentLang.nativeName}</span>}
        {!collapsed && <ChevronDown size={12} className={`language-chevron ${open ? 'language-chevron-open' : ''}`} />}
      </button>
      {open && (
        <div
          className={`language-dropdown ${dropUp ? 'language-dropdown-up' : 'language-dropdown-down'}`}
          role="listbox"
        >
          {SUPPORTED_LANGUAGES.map(lang => {
            const active = lang.code === i18n.language;
            return (
              <button
                key={lang.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => handleSelect(lang.code as LanguageCode)}
                className={`language-option ${active ? 'language-option-active' : ''}`}
              >
                <span className="language-option-native">{lang.nativeName}</span>
                <span className="language-option-name">{lang.name}</span>
                {active && <Check size={12} className="language-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
