import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { THEMES, type ThemeId } from '../../contexts/theme-types';

export const ThemeSelector: React.FC = () => {
  const { currentTheme, setTheme } = useTheme();

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
          gap: '0.5rem',
        }}
      >
        {THEMES.map(theme => (
          <button
            key={theme.id}
            type="button"
            onClick={() => setTheme(theme.id as ThemeId)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.5rem',
              borderRadius: 'var(--radius-lg)',
              background: currentTheme === theme.id
                ? 'var(--bg-panel-hover)'
                : 'var(--bg-panel)',
              border: `2px solid ${currentTheme === theme.id
                ? 'var(--primary-color)'
                : 'var(--border-color)'}`,
              cursor: 'pointer',
              transition: 'all var(--motion-fast) var(--ease-standard)',
              outline: 'none',
            }}
          >
            {/* 主题预览卡片 */}
            <div
              style={{
                width: '100%',
                height: '30px',
                borderRadius: 'var(--radius-md)',
                background: theme.previewColors.background,
                border: `1px solid ${theme.previewColors.primary}30`,
                padding: '0.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.125rem',
              }}
            >
              {/* 标题栏 */}
              <div
                style={{
                  height: '4px',
                  width: '60%',
                  borderRadius: '4px',
                  background: theme.previewColors.surface,
                }}
              />
              {/* 内容行 */}
              <div style={{ display: 'flex', gap: '0.125rem', marginTop: '0.125rem' }}>
                <div
                  style={{
                    flex: 1,
                    height: '10px',
                    borderRadius: '4px',
                    background: theme.previewColors.surface,
                  }}
                />
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '4px',
                    background: theme.previewColors.primary,
                  }}
                />
              </div>
              {/* 底部装饰 */}
              <div style={{ display: 'flex', gap: '0.125rem', marginTop: 'auto' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: theme.previewColors.primary,
                  }}
                />
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: theme.previewColors.secondary,
                  }}
                />
              </div>
            </div>

            {/* 主题名称 */}
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: currentTheme === theme.id
                  ? 'var(--primary-color)'
                  : 'var(--text-main)',
              }}
            >
              {theme.icon} {theme.name}
            </span>

            {/* 选中指示器 */}
            {currentTheme === theme.id && (
              <div
                style={{
                  width: '3px',
                  height: '3px',
                  borderRadius: '50%',
                  background: 'var(--primary-color)',
                }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
