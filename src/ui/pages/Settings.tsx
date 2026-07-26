import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw, Cpu, Trash2, FolderCog, Palette, CheckCircle, ChevronDown, Zap, Save, Database, Bug, AlertTriangle, BookOpen } from 'lucide-react';
import { apiConfigStoreAdapter, modelManagementService } from '../../dependencies';
import type { ApiConfig, PlatformId, VolcArkProtocol } from '../../domain/entities/platform';
import { useToast } from '../contexts/ToastContext';
import type { ModelInfo } from '../../domain/ports/OutboundPorts';
import { getErrorMessage } from '../utils/errorUtils';
import { PLATFORM_METADATA, type Capability } from '../../domain/services/platformCapabilities';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';
import {
  getMediaCacheStats,
  clearAllMediaCache,
  type MediaCacheStats,
} from '../../utils/imageCache';

// Settings Components
import { SettingsSection } from '../components/settings/SettingsSection';
import { FormField } from '../components/settings/FormField';
import { StatusBadge } from '../components/settings/StatusBadge';
import { ValidationButton } from '../components/settings/ValidationButton';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { CostMeterSection } from '../components/settings/CostMeterSection';

// ===== Token 校验函数 =====

/** CORS 拦截特征：浏览器原生 fetch 抛 TypeError + 经典文案 */
const CORS_PATTERNS = /Failed to fetch|NetworkError when attempting to fetch resource/i;

interface ValidationResult {
  ok: boolean;
  /** 通用错误文案（用于 toast 兜底） */
  error?: string;
  /** CORS 拦截专属标记，UI 据此展示反代引导卡片 */
  corsBlocked?: boolean;
}

async function validateArkToken(
  apiKey: string,
  protocol: VolcArkProtocol,
  baseUrl: string,
  anthropicModel?: string,
): Promise<ValidationResult> {
  try {
    if (protocol === 'anthropic') {
      // Anthropic 协议校验：POST /v1/messages 最小请求
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: anthropicModel ?? 'doubao-seed-2.0-pro',
          max_tokens: 1,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errText}` };
      }
      return { ok: true };
    }
    // OpenAI 协议校验：GET /models
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${errText}` };
    }
    return { ok: true };
  } catch (err) {
    // CORS 拦截识别：浏览器原生 fetch 在预检失败时抛 TypeError
    if (err instanceof TypeError && CORS_PATTERNS.test(err.message)) {
      return {
        ok: false,
        corsBlocked: true,
        error: 'CORS_BLOCKED',
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ===== 能力标签映射 =====
const CAPABILITY_LABEL_KEYS: Record<Capability, string> = {
  video: 'settings.capVideo',
  videoFl2v: 'settings.capVideoFl2v',
  videoS2v: 'settings.capVideoS2v',
  image: 'settings.capImage',
  text: 'settings.capText',
  voice: 'settings.capVoice',
  music: 'settings.capMusic',
};

/** 能力小标签 */
const CapabilityChips: React.FC<{ platform: PlatformId; accentColor: string }> = ({ platform, accentColor }) => {
  const { t } = useTranslation();
  const caps = PLATFORM_METADATA[platform]?.capabilities ?? [];
  if (caps.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
      {caps.map(c => (
        <span
          key={c}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0.1rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.68rem',
            fontWeight: 600,
            background: `${accentColor}1a`,
            color: accentColor,
            border: `1px solid ${accentColor}33`,
          }}
        >
          {t(CAPABILITY_LABEL_KEYS[c])}
        </span>
      ))}
    </div>
  );
};

// ===== 平台配置卡片组件（可折叠 + 能力标签） =====

interface PlatformCardProps {
  id: PlatformId;
  icon: React.ReactNode;
  name: string;
  description: string;
  isActive: boolean;
  isConfigured: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  children: React.ReactNode;
  onActivate: () => void;
  onValidate: () => Promise<void>;
  validateLabel: string;
  externalLink?: string;
  externalLinkLabel?: string;
  docLink?: string;
  accentColor?: string;
}

const PlatformCard: React.FC<PlatformCardProps> = ({
  id,
  icon,
  name,
  description,
  isActive,
  isConfigured,
  expanded,
  onToggleExpand,
  children,
  onActivate,
  onValidate,
  validateLabel,
  externalLink,
  externalLinkLabel,
  docLink,
  accentColor = 'var(--primary-color)',
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="glass-panel"
      style={{
        padding: 0,
        border: isActive ? `1px solid ${accentColor}` : '1px solid var(--border-color)',
        borderLeft: `3px solid ${isActive ? accentColor : 'transparent'}`,
        transition: `all var(--motion-normal) var(--ease-standard)`,
        boxShadow: isActive ? `0 4px 16px ${accentColor}22` : 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header（可点击折叠） ── */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.85rem 1rem',
          cursor: 'pointer',
          transition: 'background var(--motion-fast) var(--ease-standard)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-panel-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* 图标方块（带品牌色底） */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.3rem',
            background: `${accentColor}1a`,
            border: `1px solid ${accentColor}33`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>

        {/* 名称 + 状态 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-main)' }}>{name}</h3>
            {isActive && <StatusBadge status="connected" label={t('settings.statusActivated')} />}
            {isConfigured && !isActive && <StatusBadge status="ready" label={t('settings.statusReady')} />}
            {!isConfigured && !isActive && <StatusBadge status="inactive" label={t('settings.statusNotConfigured')} />}
          </div>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            {description}
          </p>
        </div>

        {/* 折叠箭头 */}
        <ChevronDown
          size={18}
          style={{
            color: 'var(--text-muted)',
            transition: 'transform var(--motion-fast) var(--ease-standard)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        />
      </div>

      {/* ── 展开内容：能力标签 + 配置字段 + 操作 ── */}
      {expanded && (
        <div
          style={{
            padding: '0 1rem 1rem',
            borderTop: '1px solid var(--border-color)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {/* 能力标签栏（移入展开区顶部） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.75rem', paddingBottom: '0.65rem' }}>
            <CapabilityChips platform={id} accentColor={accentColor} />
          </div>

          {/* 配置字段 */}
          <div style={{ display: 'grid', gap: '0.65rem', paddingTop: '0.2rem', borderTop: '1px solid var(--border-color)' }}>
            {children}
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 激活按钮 */}
            <button
              type="button"
              className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
              onClick={onActivate}
              disabled={!isConfigured && !isActive}
              style={{
                background: isActive ? accentColor : undefined,
                borderColor: isActive ? accentColor : undefined,
                fontSize: '0.82rem',
                padding: '0.5rem 1rem',
              }}
            >
              {isActive ? (
                <>
                  <CheckCircle size={14} />
                  {t('settings.statusActivated')}
                </>
              ) : (
                <>
                  <Zap size={14} />
                  {t('settings.activatePlatform')}
                </>
              )}
            </button>

            {/* 验证按钮 */}
            {isConfigured && (
              <ValidationButton onValidate={onValidate} label={validateLabel} />
            )}

            {/* 外部链接 */}
            {externalLink && (
              <a
                href={externalLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  fontSize: '0.78rem', color: 'var(--primary-color)',
                  textDecoration: 'none', marginLeft: 'auto',
                }}
              >
                <ExternalLink size={13} />
                {externalLinkLabel}
              </a>
            )}

            {/* API 文档链接 */}
            {docLink && (
              <a
                href={docLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  textDecoration: 'none',
                }}
              >
                <BookOpen size={13} />
                {t('settings.docLink')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [config, setConfig] = useState<ApiConfig>(() => apiConfigStoreAdapter.load());

  // 当前展开的平台卡片（默认展开激活平台）
  const [expandedPlatform, setExpandedPlatform] = useState<PlatformId | null>(
    () => apiConfigStoreAdapter.load().activePlatform,
  );
  const toggleExpand = useCallback((platform: PlatformId) => {
    setExpandedPlatform(prev => (prev === platform ? null : platform));
  }, []);

  // MiniMax 协议切换（UI 本地状态，不持久化到 ApiConfig；两个 URL 字段都已存在）
  // 默认 anthropic，与火山引擎协议下拉范式一致
  const [minimaxProtocol, setMinimaxProtocol] = useState<'anthropic' | 'openai'>('anthropic');

  // 监听配置变化，自动保存
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      apiConfigStoreAdapter.autoSave(config);
    }, 500); // 防抖 500ms
    return () => clearTimeout(timeoutId);
  }, [config]);

  const handleChange = useCallback((field: keyof ApiConfig, value: string | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleActivate = useCallback((platform: PlatformId) => {
    setConfig(prev => ({ ...prev, activePlatform: platform }));
    setExpandedPlatform(platform); // 激活后自动展开该平台
    const meta = PLATFORM_METADATA[platform];
    showToast('success', t('settings.platformSwitched', { name: meta?.name ?? platform }));
  }, [showToast, t]);

  // Model management state
  const [textModels, setTextModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  // 初始化时读取缓存
  useEffect(() => {
    modelManagementService.getCachedModels().then(cached => {
      if (cached) {
        setTextModels(cached.models);
        setCachedAt(new Date(cached.cachedAt).toLocaleString());
      }
    });
  }, []);

  const handleRefreshModels = async () => {
    setIsLoadingModels(true);
    try {
      const models = await modelManagementService.refreshModels();
      setTextModels(models);
      const cached = await modelManagementService.getCachedModels();
      setCachedAt(cached ? new Date(cached.cachedAt).toLocaleString() : null);
      showToast('success', t('models.refreshSuccess'));
    } catch (e) {
      showToast('error', getErrorMessage(e, t('models.refreshFailed')));
    } finally {
      setIsLoadingModels(false);
    }
  };

  /** 校验 OpenAI 协议配置（视频/图片/语音 Ark TTS 使用） */
  const handleVolcValidateOpenAi = async () => {
    const result = await validateArkToken(
      config.volcArkOpenAiApiKey,
      'openai',
      config.volcArkBaseUrl,
    );
    if (result.ok) {
      showToast('success', t('settings.volcValidateSuccess'));
    } else {
      showToast('error', t('settings.volcValidateFailed', { error: result.error ?? '' }));
    }
  };

  /** 校验 Anthropic 协议配置（文本生成 Agent Plan 使用） */
  const handleVolcValidateAnthropic = async () => {
    const result = await validateArkToken(
      config.volcArkAnthropicApiKey,
      'anthropic',
      config.volcArkAnthropicBaseUrl,
      config.volcArkAnthropicModel,
    );
    if (result.ok) {
      showToast('success', t('settings.volcValidateSuccess'));
    } else if (result.corsBlocked) {
      // CORS 拦截专属提示：引导用户配置反代或开启自动降级
      showToast('error', t('settings.volcCorsBlockedToast', { defaultValue: '跨域请求被拦截，请配置反代地址或开启自动降级' }));
    } else {
      showToast('error', t('settings.volcValidateFailed', { error: result.error ?? '' }));
    }
  };

  // 检查平台是否已配置
  const isMiniMaxConfigured = !!config.minimaxApiKey.trim();
  // 双协议并存：任一协议配置完整即视为平台已配置
  const isVolcOpenAiReady = !!config.volcArkOpenAiApiKey.trim() && !!config.volcArkBaseUrl.trim();
  const isVolcAnthropicReady = !!config.volcArkAnthropicApiKey.trim() && !!config.volcArkAnthropicBaseUrl.trim();
  const isVolcConfigured = isVolcOpenAiReady || isVolcAnthropicReady;
  const isKlingConfigured = !!config.klingAccessKey.trim() && !!config.klingSecretKey.trim();
  const isWanConfigured = !!config.wanApiKey.trim();
  const isHunyuanConfigured = !!config.hunyuanSecretId.trim() && !!config.hunyuanSecretKey.trim();
  const isZhipuConfigured = !!config.zhipuApiKey.trim();
  const isViduConfigured = !!config.viduApiKey.trim();

  const staticVideoModels = modelManagementService.getStaticVideoModels();
  const staticImageModels = modelManagementService.getStaticImageModels();
  const staticMusicModels = modelManagementService.getStaticMusicModels();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('settings.title')}</h1>
        </div>
      </div>

      {/* ── Appearance Section ─────────────────────────────── */}
      <SettingsSection
        icon={<Palette size={20} />}
        title={t('settings.appearanceSection')}
        badge={undefined}
        defaultExpanded={true}
      >
        <ThemeSelector />
      </SettingsSection>

      {/* ── Developer Tools Section ────────────────────────── */}
      <SettingsSection
        icon={<Bug size={20} />}
        title={t('settings.developerTools')}
        badge={undefined}
        defaultExpanded={false}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            cursor: 'pointer',
          }}>
            <span className="settings-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-checked={config.vconsoleEnabled}
                checked={config.vconsoleEnabled}
                onChange={e => handleChange('vconsoleEnabled', e.target.checked)}
              />
              <span className="settings-toggle-track">
                <span className="settings-toggle-thumb" />
              </span>
            </span>
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-main)' }}>
                {t('settings.vconsoleToggle')}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {t('settings.vconsoleDesc')}
              </div>
            </div>
          </label>
        </div>
      </SettingsSection>

      {/* ── Platform Configuration ─────────────────────────── */}
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--text-muted)',
          marginBottom: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {t('settings.platformConfig')}
        </h2>


        {/* ── 分组① 全模态平台 ── */}
        <div className="settings-platform-group-title">
          <span>{t('settings.fullModalPlatforms')}</span>
          <span className="settings-platform-group-hint">{t('settings.fullModalHint')}</span>
        </div>
        <div className="settings-platform-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '0.75rem',
        }}>
          {/* MiniMax */}
          <PlatformCard
            id="minimax"
            icon="🎬"
            name="MiniMax · 海螺"
            description="全模态 · 视频/图片/文本/语音/音乐"
            isActive={config.activePlatform === 'minimax'}
            isConfigured={isMiniMaxConfigured}
            expanded={expandedPlatform === 'minimax'}
            onToggleExpand={() => toggleExpand('minimax')}
            onActivate={() => handleActivate('minimax')}
            onValidate={async () => showToast('info', t('settings.noValidationNeeded'))}
            validateLabel={t('settings.validateBtn')}
            externalLink="https://platform.minimaxi.com/user-center/basic-information/interface-key"
            externalLinkLabel={t('settings.getTokenLink')}
            docLink={PLATFORM_METADATA.minimax.docLink}
            accentColor="#6366f1"
          >
            {/* 接入协议下拉：默认 Anthropic 兼容，可切换 OpenAI 格式 */}
            <FormField
              label={t('settings.volcArkProtocolLabel', { defaultValue: '接入协议' })}
              value={minimaxProtocol}
              onChange={v => setMinimaxProtocol(v as 'anthropic' | 'openai')}
              type="select"
              options={[
                { value: 'anthropic', label: t('settings.minimaxProtocolAnthropic', { defaultValue: 'Anthropic 兼容' }) },
                { value: 'openai', label: t('settings.minimaxProtocolOpenai', { defaultValue: 'OpenAI 格式' }) },
              ]}
              hint={minimaxProtocol === 'anthropic'
                ? t('settings.minimaxProtocolAnthropicHint', { defaultValue: '使用 /anthropic 端点，兼容 Anthropic SDK 调用' })
                : t('settings.minimaxProtocolOpenaiHint', { defaultValue: '使用 /v1 端点，兼容 OpenAI SDK 调用' })
              }
            />
            <FormField
              label={t('settings.apiKeyLabel')}
              value={config.minimaxApiKey}
              onChange={v => handleChange('minimaxApiKey', v)}
              type="password"
              placeholder={t('settings.apiKeyPlaceholder')}
              autoComplete="off"
              showKeyIcon
            />
            {minimaxProtocol === 'openai' ? (
              <FormField
                label={t('settings.baseUrlLabel', { defaultValue: 'OpenAI Base URL' })}
                value={config.minimaxBaseUrl}
                onChange={v => handleChange('minimaxBaseUrl', v)}
                placeholder={t('settings.baseUrlPlaceholder')}
              />
            ) : (
              <FormField
                label={t('settings.anthropicBaseUrlLabel', { defaultValue: 'Anthropic Base URL' })}
                value={config.minimaxAnthropicBaseUrl}
                onChange={v => handleChange('minimaxAnthropicBaseUrl', v)}
                placeholder={t('settings.anthropicBaseUrlPlaceholder')}
                hint={t('settings.anthropicBaseUrlHint')}
              />
            )}
          </PlatformCard>

          {/* Volcano Engine */}
          <PlatformCard
            id="volcengine"
            icon="🌋"
            name="火山引擎 · 即梦"
            description="Seedance · 视频/图片/文本/3D"
            isActive={config.activePlatform === 'volcengine'}
            isConfigured={isVolcConfigured}
            expanded={expandedPlatform === 'volcengine'}
            onToggleExpand={() => toggleExpand('volcengine')}
            onActivate={() => handleActivate('volcengine')}
            onValidate={async () => showToast('info', t('settings.volcValidateHint', { defaultValue: '请分别校验 OpenAI 与 Anthropic 两套配置' }))}
            validateLabel={t('settings.volcValidateBtn')}
            externalLink="https://console.volcengine.com/ark"
            externalLinkLabel={t('settings.getTokenLink')}
            docLink={PLATFORM_METADATA.volcengine.docLink}
            accentColor="#f97316"
          >
            {/* 双协议并存状态摘要 */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {isVolcOpenAiReady ? (
                <span className="badge badge-success" style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '0.375rem', background: 'var(--success-color, #10b981)', color: '#fff' }}>
                  {t('settings.volcOpenAiReady', { defaultValue: '视频/图片/语音 Ark TTS 可用' })}
                </span>
              ) : (
                <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '0.375rem', background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                  {t('settings.volcOpenAiNotReady', { defaultValue: '视频/图片需配置 OpenAI Key' })}
                </span>
              )}
              {isVolcAnthropicReady ? (
                <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '0.375rem', background: 'var(--success-color, #10b981)', color: '#fff' }}>
                  {t('settings.volcAnthropicReady', { defaultValue: 'Anthropic 文本生成可用' })}
                </span>
              ) : (
                <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '0.375rem', background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}>
                  {t('settings.volcAnthropicNotReady', { defaultValue: 'Anthropic 文本生成未配置' })}
                </span>
              )}
            </div>

            {/* ── OpenAI 协议配置卡片（视频/图片/语音 Ark TTS）── */}
            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '0.75rem',
              background: 'var(--bg-elevated, var(--bg-overlay))',
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                {t('settings.volcOpenAiSectionTitle', { defaultValue: 'OpenAI 协议（Agent Plan 套餐）' })}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {t('settings.volcOpenAiSectionHint', { defaultValue: '用于：视频生成 / 图片生成 / 语音 Ark TTS / 文本生成（OpenAI 兼容）' })}
              </div>
              <FormField
                label={t('settings.volcArkOpenAiApiKeyLabel', { defaultValue: 'API Key（OpenAI 协议）' })}
                value={config.volcArkOpenAiApiKey}
                onChange={v => handleChange('volcArkOpenAiApiKey', v)}
                maxLength={TEXT_LIMITS.API_KEY_MAX}
                type="password"
                placeholder={t('settings.volcArkApiKeyPlaceholder')}
                autoComplete="off"
                showKeyIcon
              />
              <FormField
                label={t('settings.volcArkBaseUrlLabel', { defaultValue: 'OpenAI Base URL' })}
                value={config.volcArkBaseUrl}
                onChange={v => handleChange('volcArkBaseUrl', v)}
                placeholder={t('settings.volcArkBaseUrlPlaceholder')}
              />
              <FormField
                label={t('settings.volcArkImageModelLabel', { defaultValue: '图片生成模型 ID' })}
                value={config.volcArkImageModel}
                onChange={v => handleChange('volcArkImageModel', v)}
                placeholder="doubao-seedream-5.0-lite"
                hint={t('settings.volcArkImageModelHint', { defaultValue: 'Agent Plan 套餐仅支持 doubao-seedream-5.0-lite。留空则使用默认模型。' })}
              />
              <button
                type="button"
                onClick={handleVolcValidateOpenAi}
                disabled={!config.volcArkOpenAiApiKey.trim()}
                style={{
                  fontSize: '0.75rem', padding: '0.3rem 0.75rem', borderRadius: '0.375rem',
                  border: '1px solid var(--border-color)', background: 'var(--bg-overlay)',
                  color: 'var(--text-main)', cursor: config.volcArkOpenAiApiKey.trim() ? 'pointer' : 'not-allowed',
                  opacity: config.volcArkOpenAiApiKey.trim() ? 1 : 0.5,
                }}
              >
                {t('settings.volcValidateBtn')}
              </button>
            </div>

            {/* ── Anthropic 协议配置卡片（文本生成 Agent Plan）── */}
            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '0.75rem',
              background: 'var(--bg-elevated, var(--bg-overlay))',
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                {t('settings.volcAnthropicSectionTitle', { defaultValue: 'Anthropic 协议（Agent Plan 订阅）' })}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {t('settings.volcAnthropicSectionHint', { defaultValue: '用于：文本生成（Agent Plan 专属模型，如 doubao-seed-2.0-pro）' })}
              </div>
              <FormField
                label={t('settings.volcArkAnthropicApiKeyLabel', { defaultValue: 'API Key（Anthropic 协议）' })}
                value={config.volcArkAnthropicApiKey}
                onChange={v => handleChange('volcArkAnthropicApiKey', v)}
                maxLength={TEXT_LIMITS.API_KEY_MAX}
                type="password"
                placeholder={t('settings.volcArkApiKeyAnthropicPlaceholder', { defaultValue: '填入 Agent Plan 专属 API Key' })}
                autoComplete="off"
                showKeyIcon
              />
              <FormField
                label={t('settings.volcArkAnthropicBaseUrlLabel', { defaultValue: 'Anthropic Base URL' })}
                value={config.volcArkAnthropicBaseUrl}
                onChange={v => handleChange('volcArkAnthropicBaseUrl', v)}
                placeholder="https://ark.cn-beijing.volces.com/api/plan"
              />
              <FormField
                label={t('settings.volcArkAnthropicModelLabel', { defaultValue: '文本模型（Agent Plan）' })}
                value={config.volcArkAnthropicModel}
                onChange={v => handleChange('volcArkAnthropicModel', v)}
                placeholder="doubao-seed-2.0-pro"
                hint={t('settings.volcArkAnthropicModelHint', { defaultValue: '可选：doubao-seed-2.0-mini/lite/pro/code, deepseek-v4-flash/pro, glm-5.2, kimi-k2.6 等' })}
              />

              {/* CORS 反代警告卡片：直连官方端点时浏览器预检会因 anthropic-version 头被拒 */}
              {config.volcArkAnthropicBaseUrl.includes('ark.cn-beijing.volces.com') && (
                <div className="settings-alert settings-alert-warning" role="status" aria-live="polite">
                  <AlertTriangle size={14} className="settings-alert-icon" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span>{t('settings.volcCorsWarning', { defaultValue: 'Anthropic 协议端点不支持浏览器直连 CORS（预检会拒绝 anthropic-version 头）。如遇跨域错误，可将 Base URL 改为您的反代地址，或开启下方自动降级。' })}</span>
                    <details style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      <summary style={{ cursor: 'pointer' }}>
                        {t('settings.volcProxyGuide', { defaultValue: '查看反代示例（Cloudflare Worker）' })}
                      </summary>
                      <pre style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        background: 'var(--bg-overlay)',
                        borderRadius: '0.375rem',
                        overflowX: 'auto',
                        fontSize: '0.7rem',
                        lineHeight: 1.4,
                      }}>
{`export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'ark.cn-beijing.volces.com';
    const resp = await fetch(url, request);
    const r = new Response(resp.body, resp);
    r.headers.set('Access-Control-Allow-Origin', '*');
    r.headers.set('Access-Control-Allow-Headers', '*');
    r.headers.set('Access-Control-Allow-Methods', '*');
    return r;
  },
};`}
                      </pre>
                    </details>
                  </div>
                </div>
              )}

              {/* 自动降级开关：Anthropic CORS 拦截时自动切换到 OpenAI 协议 */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                cursor: 'pointer',
                padding: '0.5rem 0',
              }}>
                <span className="settings-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={config.volcArkAutoFallback}
                    checked={config.volcArkAutoFallback}
                    onChange={e => handleChange('volcArkAutoFallback', e.target.checked)}
                  />
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </span>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-main)' }}>
                    {t('settings.volcAutoFallbackToggle', { defaultValue: 'CORS 拦截时自动降级到 OpenAI 协议' })}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {t('settings.volcAutoFallbackDesc', { defaultValue: 'Anthropic 端点被浏览器预检拦截时，自动改用 OpenAI 协议发起请求。需独立配置 OpenAI API Key。' })}
                  </div>
                </div>
              </label>

              <button
                type="button"
                onClick={handleVolcValidateAnthropic}
                disabled={!config.volcArkAnthropicApiKey.trim()}
                style={{
                  fontSize: '0.75rem', padding: '0.3rem 0.75rem', borderRadius: '0.375rem',
                  border: '1px solid var(--border-color)', background: 'var(--bg-overlay)',
                  color: 'var(--text-main)', cursor: config.volcArkAnthropicApiKey.trim() ? 'pointer' : 'not-allowed',
                  opacity: config.volcArkAnthropicApiKey.trim() ? 1 : 0.5,
                }}
              >
                {t('settings.volcValidateBtn')}
              </button>
            </div>

            {/* ── 文本生成协议偏好（仅影响 Text 能力，Video/Image 永远走 OpenAI）── */}
            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '0.75rem',
              background: 'var(--bg-elevated, var(--bg-overlay))',
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                {t('settings.volcTextProtocolTitle', { defaultValue: '文本生成协议偏好' })}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {t('settings.volcTextProtocolHint', { defaultValue: '仅影响文本生成；视频/图片始终走 OpenAI 协议' })}
              </div>
              <FormField
                label={t('settings.volcArkProtocolLabel', { defaultValue: '默认协议' })}
                value={config.volcArkTextProtocol}
                onChange={v => handleChange('volcArkTextProtocol', v as VolcArkProtocol)}
                type="select"
                options={[
                  { value: 'openai', label: t('settings.volcArkProtocolOpenai', { defaultValue: 'Agent Plan（OpenAI 协议）' }) },
                  { value: 'anthropic', label: t('settings.volcArkProtocolAnthropic', { defaultValue: 'Agent Plan（Anthropic 协议）' }) },
                ]}
              />
            </div>

            {/* ── 语音技术配置（声音复刻 + 大模型 TTS，独立于方舟 Ark 体系）── */}
            <div className="settings-section-divider" style={{
              marginTop: '1rem',
              marginBottom: '0.75rem',
              padding: '0.5rem 0',
              borderTop: '1px dashed var(--border-color)',
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                {t('settings.volcVoiceSectionTitle', { defaultValue: '语音技术配置（声音复刻 + 大模型 TTS）' })}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {t('settings.volcVoiceHelpText', { defaultValue: '声音复刻需单独开通语音技术服务，与方舟 API Key 不同体系。鉴权格式：Bearer;<Token>' })}
              </div>
            </div>

            <FormField
              label={t('settings.volcVoiceAppIdLabel', { defaultValue: '语音技术 AppID' })}
              value={config.volcVoiceAppId}
              onChange={v => handleChange('volcVoiceAppId', v)}
              placeholder={t('settings.volcVoiceAppIdPlaceholder', { defaultValue: '从火山引擎控制台「语音技术」获取' })}
              autoComplete="off"
            />
            <FormField
              label={t('settings.volcVoiceAccessTokenLabel', { defaultValue: '语音技术 Access Token' })}
              value={config.volcVoiceAccessToken}
              onChange={v => handleChange('volcVoiceAccessToken', v)}
              placeholder={t('settings.volcVoiceAccessTokenPlaceholder', { defaultValue: '鉴权头格式：Bearer;<Token>' })}
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label={t('settings.volcVoiceClusterLabel', { defaultValue: '业务集群' })}
              value={config.volcVoiceCluster}
              onChange={v => handleChange('volcVoiceCluster', v)}
              placeholder="volcano_icl"
              hint={t('settings.volcVoiceClusterHint', { defaultValue: '标准音色：volcano_tts / 复刻字符版：volcano_icl / 复刻并发版：volcano_icl_concurr' })}
            />
            <div className="settings-form-row" style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-main)', display: 'block', marginBottom: '0.35rem' }}>
                {t('settings.volcVoiceCloneModelTypeLabel', { defaultValue: '复刻模型版本' })}
              </label>
              <select
                className="settings-select"
                value={config.volcVoiceCloneModelType}
                onChange={e => setConfig(prev => ({ ...prev, volcVoiceCloneModelType: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 }))}
                style={{ width: '100%', padding: '0.4rem 0.6rem' }}
              >
                <option value={1}>{t('settings.volcVoiceModelIcl1', { defaultValue: 'ICL 1.0（推荐，2024.07）' })}</option>
                <option value={4}>{t('settings.volcVoiceModelIcl2', { defaultValue: 'ICL 2.0（最新，2025.10）' })}</option>
                <option value={2}>{t('settings.volcVoiceModelDitStandard', { defaultValue: 'DiT 标准版（不还原风格）' })}</option>
                <option value={3}>{t('settings.volcVoiceModelDitRestore', { defaultValue: 'DiT 还原版（还原口音/语速）' })}</option>
                <option value={0}>{t('settings.volcVoiceModelMega', { defaultValue: 'MEGA 效果（早期，不推荐）' })}</option>
              </select>
            </div>

            {/* 豆包语音合成 2.0 启用开关（2025 新模型，不支持 Auto 切换，需用户手动开通） */}
            <div className="settings-form-row" style={{ marginBottom: '0.75rem' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.78rem',
                color: 'var(--text-main)',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={config.volcSeedTtsEnabled}
                  onChange={e => setConfig(prev => ({ ...prev, volcSeedTtsEnabled: e.target.checked }))}
                />
                {t('settings.volcSeedTtsEnabledLabel', { defaultValue: '启用豆包语音合成 2.0（实验性）' })}
              </label>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {t('settings.volcSeedTtsEnabledHint', { defaultValue: '需在火山引擎控制台开通 doubao-seed-tts-2.0 模型，不支持 Auto 切换。启用后音色与配音菜单将显示该模型选项。' })}
              </div>
            </div>
          </PlatformCard>
        </div>

        {/* ── 分组② 垂直生成平台 ── */}
        <div className="settings-platform-group-title">
          <span>{t('settings.verticalPlatforms')}</span>
          <span className="settings-platform-group-hint">{t('settings.verticalHint')}</span>
        </div>
        <div className="settings-platform-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '0.75rem',
        }}>
          {/* 可灵 Kling */}
          <PlatformCard
            id="kling"
            icon={PLATFORM_METADATA.kling.icon}
            name={`${PLATFORM_METADATA.kling.name} · ${PLATFORM_METADATA.kling.brand}`}
            description={PLATFORM_METADATA.kling.description}
            isActive={config.activePlatform === 'kling'}
            isConfigured={isKlingConfigured}
            expanded={expandedPlatform === 'kling'}
            onToggleExpand={() => toggleExpand('kling')}
            onActivate={() => handleActivate('kling')}
            onValidate={async () => showToast('info', t('settings.validateViaLab', { platform: t('settings.capVideo') }))}
            validateLabel={t('settings.validateBtn')}
            externalLink={PLATFORM_METADATA.kling.externalLink}
            externalLinkLabel={t('settings.getKeyLink')}
            docLink={PLATFORM_METADATA.kling.docLink}
            accentColor={PLATFORM_METADATA.kling.accentColor}
          >
            <FormField
              label="AccessKey"
              value={config.klingAccessKey}
              onChange={v => handleChange('klingAccessKey', v)}
              maxLength={TEXT_LIMITS.API_KEY_MAX}
              type="password"
              placeholder="可灵 AccessKey"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="SecretKey"
              value={config.klingSecretKey}
              onChange={v => handleChange('klingSecretKey', v)}
              type="password"
              placeholder="可灵 SecretKey"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="Base URL"
              value={config.klingBaseUrl}
              onChange={v => handleChange('klingBaseUrl', v)}
              maxLength={TEXT_LIMITS.BASE_URL_MAX}
              placeholder="https://api.klingai.com"
            />
          </PlatformCard>

          {/* 通义万相 Wan */}
          <PlatformCard
            id="wan"
            icon={PLATFORM_METADATA.wan.icon}
            name={`${PLATFORM_METADATA.wan.name} · ${PLATFORM_METADATA.wan.brand}`}
            description={PLATFORM_METADATA.wan.description}
            isActive={config.activePlatform === 'wan'}
            isConfigured={isWanConfigured}
            expanded={expandedPlatform === 'wan'}
            onToggleExpand={() => toggleExpand('wan')}
            onActivate={() => handleActivate('wan')}
            onValidate={async () => showToast('info', t('settings.validateViaLab', { platform: t('settings.capVideo') }))}
            validateLabel={t('settings.validateBtn')}
            externalLink={PLATFORM_METADATA.wan.externalLink}
            externalLinkLabel={t('settings.getKeyLink')}
            docLink={PLATFORM_METADATA.wan.docLink}
            accentColor={PLATFORM_METADATA.wan.accentColor}
          >
            <FormField
              label="API-Key"
              value={config.wanApiKey}
              onChange={v => handleChange('wanApiKey', v)}
              maxLength={TEXT_LIMITS.API_KEY_MAX}
              type="password"
              placeholder="DashScope API-Key"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="Base URL"
              value={config.wanBaseUrl}
              onChange={v => handleChange('wanBaseUrl', v)}
              placeholder="https://dashscope.aliyuncs.com/api/v1"
            />
          </PlatformCard>

          {/* 腾讯混元 Hunyuan */}
          <PlatformCard
            id="hunyuan"
            icon={PLATFORM_METADATA.hunyuan.icon}
            name={`${PLATFORM_METADATA.hunyuan.name} · ${PLATFORM_METADATA.hunyuan.brand}`}
            description={PLATFORM_METADATA.hunyuan.description}
            isActive={config.activePlatform === 'hunyuan'}
            isConfigured={isHunyuanConfigured}
            expanded={expandedPlatform === 'hunyuan'}
            onToggleExpand={() => toggleExpand('hunyuan')}
            onActivate={() => handleActivate('hunyuan')}
            onValidate={async () => showToast('info', t('settings.validateViaLab', { platform: t('settings.capVideo') }))}
            validateLabel={t('settings.validateBtn')}
            externalLink={PLATFORM_METADATA.hunyuan.externalLink}
            externalLinkLabel={t('settings.getKeyLink')}
            docLink={PLATFORM_METADATA.hunyuan.docLink}
            accentColor={PLATFORM_METADATA.hunyuan.accentColor}
          >
            <FormField
              label="SecretId"
              value={config.hunyuanSecretId}
              onChange={v => handleChange('hunyuanSecretId', v)}
              maxLength={TEXT_LIMITS.API_KEY_MAX}
              type="password"
              placeholder="腾讯云 SecretId"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="SecretKey"
              value={config.hunyuanSecretKey}
              onChange={v => handleChange('hunyuanSecretKey', v)}
              maxLength={TEXT_LIMITS.API_KEY_MAX}
              type="password"
              placeholder="腾讯云 SecretKey"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="Base URL"
              value={config.hunyuanBaseUrl}
              onChange={v => handleChange('hunyuanBaseUrl', v)}
              maxLength={TEXT_LIMITS.BASE_URL_MAX}
              placeholder="https://hunyuan.tencentcloudapi.com"
            />
          </PlatformCard>

          {/* 智谱 Zhipu */}
          <PlatformCard
            id="zhipu"
            icon={PLATFORM_METADATA.zhipu.icon}
            name={`${PLATFORM_METADATA.zhipu.name} · ${PLATFORM_METADATA.zhipu.brand}`}
            description={PLATFORM_METADATA.zhipu.description}
            isActive={config.activePlatform === 'zhipu'}
            isConfigured={isZhipuConfigured}
            expanded={expandedPlatform === 'zhipu'}
            onToggleExpand={() => toggleExpand('zhipu')}
            onActivate={() => handleActivate('zhipu')}
            onValidate={async () => showToast('info', t('settings.validateViaLab', { platform: t('settings.capVideo') }))}
            validateLabel={t('settings.validateBtn')}
            externalLink={PLATFORM_METADATA.zhipu.externalLink}
            externalLinkLabel={t('settings.getKeyLink')}
            docLink={PLATFORM_METADATA.zhipu.docLink}
            accentColor={PLATFORM_METADATA.zhipu.accentColor}
          >
            <FormField
              label="API-Key"
              value={config.zhipuApiKey}
              onChange={v => handleChange('zhipuApiKey', v)}
              maxLength={TEXT_LIMITS.API_KEY_MAX}
              type="password"
              placeholder="智谱 API-Key"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="Base URL"
              value={config.zhipuBaseUrl}
              onChange={v => handleChange('zhipuBaseUrl', v)}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
            />
          </PlatformCard>

          {/* Vidu */}
          <PlatformCard
            id="vidu"
            icon={PLATFORM_METADATA.vidu.icon}
            name={`${PLATFORM_METADATA.vidu.name} · ${PLATFORM_METADATA.vidu.brand}`}
            description={PLATFORM_METADATA.vidu.description}
            isActive={config.activePlatform === 'vidu'}
            isConfigured={isViduConfigured}
            expanded={expandedPlatform === 'vidu'}
            onToggleExpand={() => toggleExpand('vidu')}
            onActivate={() => handleActivate('vidu')}
            onValidate={async () => showToast('info', t('settings.validateViaLab', { platform: t('settings.capVideo') }))}
            validateLabel={t('settings.validateBtn')}
            externalLink={PLATFORM_METADATA.vidu.externalLink}
            externalLinkLabel={t('settings.getKeyLink')}
            docLink={PLATFORM_METADATA.vidu.docLink}
            accentColor={PLATFORM_METADATA.vidu.accentColor}
          >
            <FormField
              label="API-Key"
              value={config.viduApiKey}
              onChange={v => handleChange('viduApiKey', v)}
              type="password"
              placeholder="Vidu API-Key"
              autoComplete="off"
              showKeyIcon
            />
            <FormField
              label="Base URL"
              value={config.viduBaseUrl}
              onChange={v => handleChange('viduBaseUrl', v)}
              maxLength={TEXT_LIMITS.BASE_URL_MAX}
              placeholder="https://api.vidu.cn"
            />
          </PlatformCard>
        </div>


      </div>

      {/* ── Available Models Section ────────────────────── */}
      <SettingsSection
        icon={<Cpu size={20} />}
        title={t('models.title')}
        badge={undefined}
        defaultExpanded={false}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          {cachedAt && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t('models.cachedAt', { time: cachedAt })}
            </p>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={isLoadingModels}
            onClick={handleRefreshModels}
          >
            {isLoadingModels ? <RefreshCw size={12} className="spin" /> : <RefreshCw size={12} />}
            {isLoadingModels ? t('models.refreshing') : t('models.refreshBtn')}
          </button>
        </div>

        {/* Text Models */}
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
            {t('models.textModels')}
          </h4>
          {textModels.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {textModels.map(m => (
                <span key={m.id} className="lab-chip" style={{ fontSize: '0.75rem' }}>
                  {m.displayName}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('models.noModels')}</p>
          )}
        </div>

        {/* Video Models */}
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
            {t('models.videoModels')}
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {staticVideoModels.map(m => (
              <span key={m.id} className="lab-chip" style={{ fontSize: '0.75rem' }}>
                {m.displayName}
              </span>
            ))}
          </div>
        </div>

        {/* Image Models */}
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
            {t('models.imageModels')}
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {staticImageModels.map(m => (
              <span key={m.id} className="lab-chip" style={{ fontSize: '0.75rem' }}>
                {m.displayName}
              </span>
            ))}
          </div>
        </div>

        {/* Music Models */}
        <div>
          <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
            {t('models.musicModels')}
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {staticMusicModels.map(m => (
              <span key={m.id} className="lab-chip" style={{ fontSize: '0.75rem' }}>
                {m.displayName}
              </span>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* ── 本地保存路径（避开外部 OSS CORS） ─────────────── */}
      <LocalStorageSettingsSection />

      {/* ── 媒体缓存（Service Worker） ─────────────────── */}
      <MediaCacheSettingsSection />

      {/* ── AI 调用成本统计（P1-21） ─────────────────── */}
      <CostMeterSection />

      {/* ── Auto-save indicator ─────────────────────────── */}
      <div className="settings-autosave-floating" style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        padding: '0.5rem 1rem',
        borderRadius: 'var(--radius-full)',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        backdropFilter: 'blur(8px)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <CheckCircle size={12} style={{ color: 'var(--primary-color)' }} />
        {t('settings.autosaveEnabled')}
      </div>
    </div>
  );
}

// ==========================================
// 本地文件存储配置区块 —— 让用户选择存储后端与本地保存路径
// ==========================================

/** 把字节数格式化为人类可读字符串（KB/MB/GB） */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function LocalStorageSettingsSection() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  // 用户偏好：local（默认）/ opfs / auto —— 已移除 indexeddb 选项（文件不存入 IndexedDB）
  const [preference, setPreference] = useState<'local' | 'opfs' | 'auto'>(() => {
    const v = window.localStorage.getItem('ai_vido_storage_preference');
    if (v === 'local' || v === 'opfs' || v === 'auto') return v;
    // 旧值（含 indexeddb）统一迁移为 local
    return 'local';
  });

  // 探测 Vite 插件的 API 路径（默认 /__files / files）
  const [apiBase, setApiBase] = useState(() =>
    window.localStorage.getItem('ai_vido_files_api_base') || '/__files'
  );
  const [publicPath, setPublicPath] = useState(() =>
    window.localStorage.getItem('ai_vido_files_public_path') || '/files'
  );

  // 服务端实际保存根目录（可编辑，通过 GET/POST /__files/config 端点读写）
  const [serverRoot, setServerRoot] = useState<string>('docs/files');
  const [serverRootEditing, setServerRootEditing] = useState(false);
  const [migrateOnSwitch, setMigrateOnSwitch] = useState(true);
  const [applyingRoot, setApplyingRoot] = useState(false);
  const [pluginOnline, setPluginOnline] = useState<boolean | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  // 磁盘用量聚合（由 /__files/stats 提供）
  const [diskUsage, setDiskUsage] = useState<{
    totalSize: number;
    totalFiles: number;
    byType: Record<string, { count: number; size: number }>;
    maxUploadBytes?: number;
  } | null>(null);

  // 探测插件可用性 + 文件数量 + 磁盘用量 + 读取服务端实际 rootDir
  useEffect(() => {
    let cancelled = false;
    // 同步重置状态是必要的"探测中"UI提示，
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPluginOnline(null);
    (async () => {
      try {
        // 优先用 /__files/stats（一次拿全）
        const r = await fetch(`${apiBase}/stats`);
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          setPluginOnline(true);
          setDiskUsage({
            totalSize: data.totalSize ?? 0,
            totalFiles: data.totalFiles ?? 0,
            byType: data.byType ?? {},
            maxUploadBytes: data.maxUploadBytes,
          });
          setFileCount(data.totalFiles ?? 0);
          // 读取服务端实际 rootDir
          try {
            const cr = await fetch(`${apiBase}/config`);
            if (cr.ok) {
              const cfg = await cr.json();
              if (cfg.rootDir) setServerRoot(cfg.rootDir);
            }
          } catch {
            // config 端点不可用时保留默认值
          }
          return;
        }
        // 回退：用 list 接口
        const lr = await fetch(`${apiBase}/list?dir=images`);
        if (cancelled) return;
        setPluginOnline(lr.ok);
        if (lr.ok) {
          const data = await lr.json();
          const entries = Array.isArray(data.entries) ? data.entries : [];
          setFileCount(entries.length);
        } else {
          setFileCount(null);
        }
      } catch {
        if (cancelled) return;
        setPluginOnline(false);
        setFileCount(null);
        setDiskUsage(null);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  const probePlugin = useCallback(() => {
    // 触发重新探测：重置状态再启动 effect
    setPluginOnline(null);
  }, []);

  // 应用新目录：调用 POST /__files/config 切换服务端 rootDir
  const applyServerRoot = useCallback(async () => {
    setApplyingRoot(true);
    try {
      const r = await fetch(`${apiBase}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: serverRoot, migrate: migrateOnSwitch }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        showToast('success', t('settings.localStorage.directorySwitched', { path: data.absoluteRoot, count: data.migratedFiles ?? 0 }));
        setServerRootEditing(false);
        window.location.reload();
      } else {
        showToast('error', t('settings.localStorage.switchFailed', { error: data.error ?? t('common.unknownError') }));
      }
    } catch (e) {
      showToast('error', t('settings.localStorage.switchFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setApplyingRoot(false);
    }
  }, [apiBase, serverRoot, migrateOnSwitch, showToast, t]);

  // 持久化
  const persist = useCallback((next: { preference?: typeof preference; apiBase?: string; publicPath?: string }) => {
    if (next.preference !== undefined) {
      setPreference(next.preference);
      window.localStorage.setItem('ai_vido_storage_preference', next.preference);
    }
    if (next.apiBase !== undefined) {
      setApiBase(next.apiBase);
      window.localStorage.setItem('ai_vido_files_api_base', next.apiBase);
    }
    if (next.publicPath !== undefined) {
      setPublicPath(next.publicPath);
      window.localStorage.setItem('ai_vido_files_public_path', next.publicPath);
    }
  }, []);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <SettingsSection
      icon={<FolderCog size={20} />}
      title={t('settings.localStorage.title', '本地保存路径')}
      badge={undefined}
      defaultExpanded={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{
          padding: '0.75rem 1rem',
          background: pluginOnline === false ? 'rgba(248, 113, 113, 0.1)' : 'rgba(74, 222, 128, 0.1)',
          border: `1px solid ${pluginOnline === false ? 'rgba(248, 113, 113, 0.3)' : 'rgba(74, 222, 128, 0.3)'}`,
          borderRadius: '8px',
          fontSize: '0.85rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500 }}>
            {pluginOnline === false ? '⚠️ ' : pluginOnline === true ? '✅ ' : '⏳ '}
            {pluginOnline === false
              ? t('settings.localStorage.pluginOffline', 'Vite 文件存储插件未挂载')
              : pluginOnline === true
              ? t('settings.localStorage.pluginOnline', 'Vite 文件存储插件已挂载')
              : t('settings.localStorage.probing', '正在探测插件状态...')}
          </div>
          {pluginOnline === false && (
            <div style={{ marginTop: '0.4rem', color: 'var(--text-muted)' }}>
              {t(
                'settings.localStorage.pluginOfflineHint',
                '请检查 vite.config.ts 中是否注册了 filesStoragePlugin()；或设置环境变量 FILES_DIR 指定保存目录。'
              )}
            </div>
          )}
        </div>

        <FormField
          label={t('settings.localStorage.preferenceLabel', '存储后端')}
          value={preference}
          onChange={v => persist({ preference: v as typeof preference })}
          placeholder="auto"
          type="select"
          options={[
            { value: 'local', label: t('settings.localStorage.prefLocal', '本地磁盘（配置目录，推荐）') },
            { value: 'opfs', label: t('settings.localStorage.prefOpfs', '浏览器 OPFS（Origin Private File System）') },
            { value: 'auto', label: t('settings.localStorage.prefAuto', '自动（优先本地磁盘，回退 OPFS）') },
          ]}
        />

        <FormField
          label={t('settings.localStorage.serverRootLabel', '服务端保存目录')}
          value={serverRoot}
          onChange={v => { setServerRoot(v); setServerRootEditing(true); }}
          maxLength={TEXT_LIMITS.BASE_URL_MAX}
          hint={t(
            'settings.localStorage.serverRootHint',
            '文件保存的物理目录（相对项目根或绝对路径）。修改后点击"应用"切换，可选迁移老文件。'
          )}
        />
        {serverRootEditing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={migrateOnSwitch}
                onChange={e => setMigrateOnSwitch(e.target.checked)}
              />
              {t('settings.localStorage.migrateLabel', '切换时迁移老文件到新目录')}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary"
                onClick={applyServerRoot}
                disabled={applyingRoot}
                style={{ padding: '0.3rem 0.8rem' }}
              >
                {applyingRoot ? t('settings.localStorage.applying', '应用中...') : t('settings.localStorage.applyBtn', '应用')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setServerRootEditing(false); }}
                disabled={applyingRoot}
                style={{ padding: '0.3rem 0.8rem' }}
              >
                {t('common.cancel', '取消')}
              </button>
            </div>
          </div>
        )}

        <FormField
          label={t('settings.localStorage.apiBaseLabel', 'API 路由前缀')}
          value={apiBase}
          onChange={v => persist({ apiBase: v })}
          placeholder="/__files"
          hint={t(
            'settings.localStorage.apiBaseHint',
            'Vite 插件提供的上传/删除/列表 API 前缀。'
          )}
        />

        <FormField
          label={t('settings.localStorage.publicPathLabel', '静态访问前缀')}
          value={publicPath}
          onChange={v => persist({ publicPath: v })}
          maxLength={TEXT_LIMITS.PATH_PREFIX_MAX}
          placeholder="/files"
          hint={t(
            'settings.localStorage.publicPathHint',
            '已保存文件可通过此路径访问，例如 /files/images/abc.png。'
          )}
        />

        {diskUsage && (
          <div style={{
            padding: '0.75rem',
            background: 'rgba(0,0,0,0.04)',
            borderRadius: '6px',
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-color, #fff)' }}>
              {t('settings.localStorage.diskUsage', '磁盘用量')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem' }}>
              <div>{t('settings.localStorage.diskUsageImages', '图片')}</div>
              <div style={{ textAlign: 'right' }}>
                {diskUsage.byType.images?.count ?? 0} ·{' '}
                {formatBytes(diskUsage.byType.images?.size ?? 0)}
              </div>
              <div>{t('settings.localStorage.diskUsageAudio', '音频')}</div>
              <div style={{ textAlign: 'right' }}>
                {diskUsage.byType.audio?.count ?? 0} ·{' '}
                {formatBytes(diskUsage.byType.audio?.size ?? 0)}
              </div>
              <div>{t('settings.localStorage.diskUsageVideo', '视频')}</div>
              <div style={{ textAlign: 'right' }}>
                {diskUsage.byType.video?.count ?? 0} ·{' '}
                {formatBytes(diskUsage.byType.video?.size ?? 0)}
              </div>
              <div>{t('settings.localStorage.diskUsageOther', '其他')}</div>
              <div style={{ textAlign: 'right' }}>
                {diskUsage.byType.other?.count ?? 0} ·{' '}
                {formatBytes(diskUsage.byType.other?.size ?? 0)}
              </div>
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.25rem', fontWeight: 500 }}>
                {t('settings.localStorage.diskUsageTotal', '合计')}
              </div>
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.25rem', textAlign: 'right', fontWeight: 500 }}>
                {diskUsage.totalFiles} · {formatBytes(diskUsage.totalSize)}
              </div>
            </div>
            {diskUsage.maxUploadBytes && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
                {t(
                  'settings.localStorage.maxUpload',
                  '单次上传上限：{{size}}MB（可在 vite.config.ts 调整）',
                  { size: (diskUsage.maxUploadBytes / 1024 / 1024).toFixed(1) }
                )}
              </div>
            )}
          </div>
        )}
        {!diskUsage && fileCount !== null && (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t(
              'settings.localStorage.fileCount',
              '「images」目录下已有 {{count}} 个文件（插件版本较旧，无 stats 接口）',
              { count: fileCount }
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={probePlugin}
            disabled={pluginOnline === null}
          >
            <RefreshCw size={14} />
            {t('settings.localStorage.probeBtn', '重新探测')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleReload}
          >
            <Save size={14} />
            {t('settings.localStorage.saveAndReloadBtn', '保存并刷新')}
          </button>
        </div>

        <div style={{
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          padding: '0.5rem',
          background: 'rgba(0,0,0,0.05)',
          borderRadius: '6px',
          lineHeight: 1.5,
        }}>
          {t(
            'settings.localStorage.whyHint',
            '为什么需要本地保存？\n外部图片 URL（如 OSS 签名链接）通常被浏览器 CORS 策略拦截，无法直接 fetch 到 Blob。本适配器把生成的图片/音频/视频 Blob 直接 POST 到本地 Vite 服务，由服务端写到磁盘，完全不调用任何外部接口。'
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

// ==========================================
// 媒体缓存配置区块 —— CacheStorage 统计 / 清空
// ==========================================
function MediaCacheSettingsSection() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<MediaCacheStats | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // 初始加载缓存统计
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getMediaCacheStats();
        if (cancelled) return;
        setStats(s);
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = useCallback(async () => {
    setStats(null);
    const s = await getMediaCacheStats();
    setStats(s);
  }, []);

  const handleClear = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      await clearAllMediaCache();
      // 清空后立即重新加载统计
      await handleRefresh();
    } finally {
      setIsClearing(false);
    }
  }, [handleRefresh, isClearing]);

  return (
    <SettingsSection
      icon={<Database size={20} />}
      title={t('settings.mediaCache.title', '媒体缓存')}
      badge={undefined}
      defaultExpanded={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {stats && (
          <div style={{
            padding: '0.75rem',
            background: 'rgba(0,0,0,0.04)',
            borderRadius: '6px',
            fontSize: '0.82rem',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem' }}>
              <div>{t('settings.mediaCache.entryCount', '已缓存条目')}</div>
              <div style={{ textAlign: 'right' }}>{stats.count} / {stats.maxEntries}</div>
              <div>{t('settings.mediaCache.totalSize', '估算大小')}</div>
              <div style={{ textAlign: 'right' }}>{formatBytes(stats.totalBytes)}</div>
              {stats.oldestTimestamp > 0 && (
                <>
                  <div>{t('settings.mediaCache.oldest', '最旧缓存')}</div>
                  <div style={{ textAlign: 'right' }}>
                    {new Date(stats.oldestTimestamp).toLocaleString()}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={stats === null}
          >
            <RefreshCw size={14} />
            {t('settings.mediaCache.refreshBtn', '刷新状态')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleClear}
            disabled={isClearing || stats === null}
            style={{ background: 'rgba(248, 113, 113, 0.2)', color: 'var(--color-danger)' }}
          >
            <Trash2 size={14} />
            {isClearing
              ? t('settings.mediaCache.clearing', '清空中...')
              : t('settings.mediaCache.clearBtn', '清空媒体缓存')}
          </button>
        </div>

        <div style={{
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          padding: '0.5rem',
          background: 'rgba(0,0,0,0.05)',
          borderRadius: '6px',
          lineHeight: 1.5,
        }}>
          {t(
            'settings.mediaCache.howItWorks',
            '工作原理：\n• 跨域图片 URL（如 OSS 签名链接）首次通过 <img> 加载时，Service Worker 自动缓存到 CacheStorage。\n• 点击「保存」时，主线程从 CacheStorage 读取字节（绕过 CORS），调用本地磁盘落盘。\n• 二次保存 0 网络请求。\n• 最多缓存 200 条（LRU 淘汰）。'
          )}
        </div>
      </div>
    </SettingsSection>
  );
}