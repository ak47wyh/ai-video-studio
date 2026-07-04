import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Image as ImageIcon, BookOpen, Settings, ArrowRight, CheckCircle, XCircle, Clock, Film, Mic, MessageSquare, Sparkles, Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSpaceScopedCharacters, useSpaceScopedBackgrounds, useSpaceScopedStories, useSpaceVideoTaskStats, useRecentStories } from '../hooks/useSpaceScopedQuery';
import { AgentChatPanel } from '../components/AgentChatPanel';
import { AsyncState } from '../components/AsyncState';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Space-aware counts
  const characters = useSpaceScopedCharacters();
  const characterCount = characters.length;
  const backgrounds = useSpaceScopedBackgrounds();
  const backgroundCount = backgrounds.length;
  const stories = useSpaceScopedStories();
  const storyCount = stories.length;

  // Space-aware video task stats
  const taskStats = useSpaceVideoTaskStats();

  // Recent stories in current space
  const recentStories = useRecentStories(3);

  const steps = [
    {
      icon: <Users size={18} />,
      title: t('dashboard.step1Title'),
      desc: t('dashboard.step1Desc'),
      count: characterCount,
      countLabel: t('dashboard.charactersCount'),
      path: '/characters',
      color: 'var(--primary-color)'
    },
    {
      icon: <ImageIcon size={18} />,
      title: t('dashboard.step2Title'),
      desc: t('dashboard.step2Desc'),
      count: backgroundCount,
      countLabel: t('dashboard.backgroundsCount'),
      path: '/backgrounds',
      color: 'var(--lab-color-image)'
    },
    {
      icon: <BookOpen size={18} />,
      title: t('dashboard.step3Title'),
      desc: t('dashboard.step3Desc'),
      count: storyCount,
      countLabel: t('dashboard.storiesCount'),
      path: '/workbench',
      color: 'var(--lab-color-text)'
    },
    {
      icon: <Film size={18} />,
      title: t('dashboard.step4Title', '导出中心'),
      desc: t('dashboard.step4Desc', '合成最终视频并下载导出'),
      count: null,
      countLabel: '',
      path: '/export',
      color: 'var(--lab-color-video)'
    },
    {
      icon: <Settings size={18} />,
      title: t('dashboard.step5Title', '系统设置'),
      desc: t('dashboard.step5Desc', '配置您的系统偏好'),
      count: null,
      countLabel: '',
      path: '/settings',
      color: 'var(--color-info)'
    }
  ];

  const handleStoryClick = (storyId: string) => {
    navigate(`/workbench?story=${storyId}`);
  };

  // a11y：可点击卡片支持键盘操作（回车/空格触发导航）V3 §6.5
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(path);
    }
  };

  return (
    <div className="dashboard fade-in">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{t('dashboard.title')}</h1>
          <p className="dashboard-subtitle">{t('dashboard.welcome')}</p>
        </div>
      </div>

      {/* Workflow guide cards */}
      <div className="dashboard-section">
        <div className="dashboard-grid">
          {steps.map((step, index) => (
            <div
              key={step.path}
              className="dashboard-card"
              role="button"
              tabIndex={0}
              aria-label={`${step.title} — ${step.desc}`}
              onClick={() => navigate(step.path)}
              onKeyDown={(e) => handleCardKeyDown(e, step.path)}
            >
              <div className="dashboard-card-header">
                <div className="dashboard-card-icon" style={{ background: `color-mix(in srgb, ${step.color} 12%, transparent)`, color: step.color, position: 'relative' }}>
                  {step.icon}
                  <span className="dashboard-step-badge" style={{ background: step.color }}>{index + 1}</span>
                </div>
                <h3 className="dashboard-card-title">{step.title}</h3>
              </div>
              <p className="dashboard-card-desc">{step.desc}</p>
              <div className="dashboard-card-footer">
                {step.count !== null && (
                  <span className="dashboard-card-count" style={{ color: step.color }}>
                    {step.count} {step.countLabel}
                  </span>
                )}
                <span className="dashboard-card-go">
                  {t('dashboard.go')} <ArrowRight size={12} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI 实验室快捷入口 */}
      <div className="dashboard-section">
        <div className="dashboard-section-title">
          <Sparkles size={16} style={{ color: 'var(--primary-color)' }} />
          {t('dashboard.aiLab', 'AI 实验室')}
        </div>
        <div className="dashboard-grid">
          {[
            { icon: <ImageIcon size={16} />, label: t('nav.imageLab', '图片生成'), path: '/labs/image', color: 'var(--lab-color-image)', desc: t('dashboard.aiImageDesc', 'AI 图片生成与编辑') },
            { icon: <Film size={16} />, label: t('nav.videoLab', '视频生成'), path: '/labs/video', color: 'var(--lab-color-video)', desc: t('dashboard.aiVideoDesc', '文生视频、图生视频、首尾帧、主体参考') },
            { icon: <Mic size={16} />, label: t('nav.voiceLab', '音色与配音'), path: '/labs/voice', color: 'var(--lab-color-voice)', desc: t('dashboard.aiVoiceDesc', '音色克隆、文本配音、音色设计') },
            { icon: <Music size={16} />, label: t('nav.musicLab', '音乐生成'), path: '/labs/music', color: 'var(--lab-color-music)', desc: t('dashboard.aiMusicDesc', 'AI 音乐创作与 BGM 生成') },
            { icon: <MessageSquare size={16} />, label: t('nav.textLab', '文本润色'), path: '/labs/text', color: 'var(--lab-color-text)', desc: t('dashboard.aiTextDesc', 'AI 文本优化与改写') },
          ].map(item => (
            <div
              key={item.path}
              className="dashboard-card"
              role="button"
              tabIndex={0}
              aria-label={`${item.label} — ${item.desc}`}
              onClick={() => navigate(item.path)}
              onKeyDown={(e) => handleCardKeyDown(e, item.path)}
            >
              <div className="dashboard-card-header">
                <div className="dashboard-card-icon" style={{ background: `color-mix(in srgb, ${item.color} 12%, transparent)`, color: item.color }}>
                  {item.icon}
                </div>
                <span className="dashboard-card-title">{item.label}</span>
              </div>
              <p className="dashboard-card-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row: Video task stats + Recent stories */}
      <div className="dashboard-section">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 'var(--space-sm)' }}>
          {/* Video task stats — inline compact, no nested cards */}
          <div className="dashboard-card" style={{ cursor: 'default' }}>
            <h3 className="dashboard-section-title" style={{ marginBottom: '0.5rem' }}>{t('dashboard.videoStats')}</h3>
            {taskStats.total === 0 ? (
              <AsyncState empty emptyText={t('dashboard.noVideoStats')} minHeight={120} />
            ) : (
            <div className="dashboard-stats-row">
              <div className="dashboard-stat-item" style={{ background: 'var(--color-success-bg)' }}>
                <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-success) 20%, transparent)' }}>
                  <CheckCircle size={16} color="var(--color-success)" />
                </div>
                <div>
                  <div className="dashboard-stat-value" style={{ color: 'var(--color-success)' }}>{taskStats.success}</div>
                  <div className="dashboard-stat-label">{t('dashboard.statusSuccess')}</div>
                </div>
              </div>
              <div className="dashboard-stat-item" style={{ background: 'var(--color-danger-bg)' }}>
                <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-danger) 20%, transparent)' }}>
                  <XCircle size={16} color="var(--color-danger)" />
                </div>
                <div>
                  <div className="dashboard-stat-value" style={{ color: 'var(--color-danger)' }}>{taskStats.failed}</div>
                  <div className="dashboard-stat-label">{t('dashboard.statusFailed')}</div>
                </div>
              </div>
              <div className="dashboard-stat-item" style={{ background: 'var(--color-warning-bg)' }}>
                <div className="dashboard-stat-icon" style={{ background: 'color-mix(in srgb, var(--color-warning) 20%, transparent)' }}>
                  <Clock size={16} color="var(--color-warning)" />
                </div>
                <div>
                  <div className="dashboard-stat-value" style={{ color: 'var(--color-warning)' }}>{taskStats.processing}</div>
                  <div className="dashboard-stat-label">{t('dashboard.statusProcessing')}</div>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* Recent stories — compact list, no nested cards */}
          <div className="dashboard-card" style={{ cursor: 'default' }}>
            <h3 className="dashboard-section-title" style={{ marginBottom: '0.5rem' }}>{t('dashboard.recentStories')}</h3>
            {(!recentStories || recentStories.length === 0) ? (
              <AsyncState empty emptyText={t('dashboard.noStories')} minHeight={120} />
            ) : (
              <div className="dashboard-story-list">
                {recentStories.map(s => (
                  <div
                    key={s.id}
                    className="dashboard-story-item"
                    role="button"
                    tabIndex={0}
                    aria-label={`${t('dashboard.openStory', '打开故事')}《${s.title}》`}
                    onClick={() => handleStoryClick(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleStoryClick(s.id);
                      }
                    }}
                  >
                    <div>
                      <div className="dashboard-story-title">{s.title}</div>
                      <div className="dashboard-story-date">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="dashboard-story-badge" style={{
                      background: s.status === 'SPLIT' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                      color: s.status === 'SPLIT' ? 'var(--color-success)' : 'var(--color-warning)',
                    }}>
                      {s.status === 'SPLIT' ? t('dashboard.statusSplit') : t('dashboard.statusDraft')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* P1 接入：AI Agent 助手面板（ReAct 工具循环，自然语言驱动端到端创作） */}
      <div className="dashboard-section">
        <h3 className="dashboard-section-title">{t('dashboard.agentAssistant', 'AI 创作助手')}</h3>
        <div style={{ height: 480 }}>
          <AgentChatPanel />
        </div>
      </div>
    </div>
  );
};
