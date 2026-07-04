import React, { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusBadge, type BadgeStatus } from './StatusBadge';

interface SettingsSectionProps {
  icon: ReactNode;
  title: string;
  badge?: {
    status: BadgeStatus;
    label: string;
  };
  children: ReactNode;
  defaultExpanded?: boolean;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  icon,
  title,
  badge,
  children,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="glass-panel" style={{ marginBottom: '0.75rem', overflow: 'hidden' }}>
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          width: '100%',
          padding: '1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--motion-fast) var(--ease-standard)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-panel-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* 图标 */}
        <span style={{ color: 'var(--primary-color)' }}>{icon}</span>

        {/* 标题 */}
        <h2
          style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text-inverse)',
            flex: 1,
          }}
        >
          {title}
        </h2>

        {/* 状态徽章 */}
        {badge && (
          <StatusBadge status={badge.status} label={badge.label} />
        )}

        {/* 展开/折叠指示器 */}
        {isExpanded ? (
          <ChevronDown size={18} style={{ color: 'var(--text-muted)' }} />
        ) : (
          <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />
        )}
      </button>

      {/* Section Content */}
      <div
        style={{
          maxHeight: isExpanded ? '2000px' : '0',
          opacity: isExpanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'all var(--motion-normal) var(--ease-standard)',
        }}
      >
        <div style={{ padding: '0 1rem 1rem 1rem' }}>
          {children}
        </div>
      </div>
    </div>
  );
};