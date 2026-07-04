import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, AlertCircle } from 'lucide-react';

/** NotFoundPage —— 404 兜底页面 */
export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="not-found-page fade-in" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <AlertCircle size={64} style={{ color: 'var(--color-warning)', marginBottom: '1rem' }} />
      <h1 style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        404
      </h1>
      <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        {t('notFound.message', '您访问的页面不存在')}
      </p>
      <button className="btn btn-primary" onClick={() => navigate('/')}>
        <Home size={16} /> {t('notFound.backHome', '返回首页')}
      </button>
    </div>
  );
};
