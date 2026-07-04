import React from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

export type BadgeStatus = 'live' | 'mock' | 'connected' | 'inactive' | 'error' | 'ready';

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
}

const BADGE_CONFIG: Record<BadgeStatus, { bg: string; color: string; border: string; icon: typeof CheckCircle }> = {
  live: {
    bg: 'rgba(52, 211, 153, 0.15)',
    color: '#34d399',
    border: 'rgba(52, 211, 153, 0.4)',
    icon: CheckCircle,
  },
  mock: {
    bg: 'rgba(251, 191, 36, 0.15)',
    color: '#fbbf24',
    border: 'rgba(251, 191, 36, 0.4)',
    icon: AlertCircle,
  },
  connected: {
    bg: 'rgba(52, 211, 153, 0.15)',
    color: '#34d399',
    border: 'rgba(52, 211, 153, 0.4)',
    icon: CheckCircle,
  },
  inactive: {
    bg: 'rgba(251, 191, 36, 0.15)',
    color: '#fbbf24',
    border: 'rgba(251, 191, 36, 0.4)',
    icon: AlertCircle,
  },
  ready: {
    bg: 'rgba(148, 163, 184, 0.15)',
    color: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.4)',
    icon: CheckCircle,
  },
  error: {
    bg: 'rgba(248, 113, 113, 0.15)',
    color: '#f87171',
    border: 'rgba(248, 113, 113, 0.4)',
    icon: AlertCircle,
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const config = BADGE_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.2rem 0.7rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 700,
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.border}`,
      }}
    >
      <Icon size={12} />
      {label}
    </span>
  );
};