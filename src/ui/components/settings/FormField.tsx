import React from 'react';
import { Key, ChevronDown } from 'lucide-react';

export interface FormFieldOption {
  value: string;
  label: string;
}

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'select';
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  showKeyIcon?: boolean;
  disabled?: boolean;
  options?: FormFieldOption[];
  /** 输入字符上限，设置后显示计数器（仅对 text/password 生效） */
  maxLength?: number;
}

/**
 * 软限制模式：不将 maxLength 透传给原生 input（不阻止输入），
 * 超限时计数器变红并显示提示文本，由提交逻辑调用 validateTextLimit 拦截。
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  hint,
  showKeyIcon = false,
  disabled = false,
  options,
  maxLength,
}) => {
  const showCounter = maxLength !== undefined && type !== 'select';
  const currentLength = typeof value === 'string' ? value.length : 0;
  const isOverLimit = !!(maxLength && currentLength > maxLength);
  // 同时显示 key 图标和计数器时，预留更宽右侧空间
  const paddingRight = showKeyIcon && showCounter
    ? '5rem'
    : showKeyIcon
      ? '2.5rem'
      : showCounter
        ? '3.5rem'
        : '0.75rem';

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ position: 'relative' }}>
        {type === 'select' ? (
          <div className="settings-select-wrapper">
            <select
              className="form-input"
              value={value}
              onChange={e => onChange(e.target.value)}
              disabled={disabled}
            >
              {(options ?? []).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="settings-select-arrow" aria-hidden="true">
              <ChevronDown size={16} />
            </span>
          </div>
        ) : (
          <input
            className="form-input"
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete={autoComplete}
            disabled={disabled}
            style={{ paddingRight, borderColor: isOverLimit ? 'var(--color-danger)' : undefined }}
          />
        )}
        {showKeyIcon && type !== 'select' && (
          <Key
            size={15}
            style={{
              position: 'absolute',
              right: showCounter ? '3rem' : '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
        )}
        {showCounter && (
          <div
            style={{
              position: 'absolute',
              right: '0.5rem',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '0.75rem',
              color: isOverLimit
                ? 'var(--color-danger)'
                : 'var(--text-muted)',
              pointerEvents: 'none',
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '0.1rem 0.4rem',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {currentLength}/{maxLength}
          </div>
        )}
      </div>
      {isOverLimit && (
        <p style={{ fontSize: '0.7rem', color: 'var(--color-danger)', marginTop: '0.25rem' }}>
          文本超限，请调整至 {maxLength} 字以内
        </p>
      )}
      {hint && (
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          {hint}
        </p>
      )}
    </div>
  );
};
