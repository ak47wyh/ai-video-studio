import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../i18n';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
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

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  const handleSelect = (code: LanguageCode) => {
    i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="btn btn-secondary"
        style={{ padding: '0.4rem 0.8rem', border: 'none', gap: '0.5rem', opacity: 0.8 }}
      >
        <Globe size={18} />
        <span>{currentLang.nativeName}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '0.25rem',
          minWidth: '180px',
          background: 'rgba(20,20,30,0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 'var(--radius-md)',
          padding: '0.25rem',
          zIndex: 1000,
          maxHeight: '320px',
          overflowY: 'auto',
        }}>
          {SUPPORTED_LANGUAGES.map(lang => {
            const active = lang.code === i18n.language;
            return (
              <button
                key={lang.code}
                onClick={() => handleSelect(lang.code as LanguageCode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  width: '100%', padding: '0.5rem 0.75rem',
                  background: active ? 'rgba(129,140,248,0.15)' : 'transparent',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  color: active ? 'var(--primary-color)' : 'inherit',
                  cursor: 'pointer', fontSize: '0.85rem',
                  textAlign: 'left',
                }}
              >
                <span style={{ flex: 1 }}>{lang.nativeName}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{lang.name}</span>
                {active && <Check size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
