import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare, Send, Bot, User, RefreshCw, Sparkles, BookmarkPlus,
  Film, Users, Image as ImageIcon, Music, Wand2, ChevronDown, ChevronUp,
  Copy, CheckCircle2, ArrowRight, Settings, Database,
} from 'lucide-react';
import { textLabService, modelManagementService, assetLibraryService } from '../../dependencies';
import type { TextModel, TextGenerationMessage, TextGenerationResult, ModelInfo } from '../../domain/ports/OutboundPorts';
import type { TextRefineScene, RefineStyle } from '../../domain/services/TextLabService';
import { useToast } from '../contexts/ToastContext';
import { getErrorMessage } from '../utils/errorUtils';
import { useSpace } from '../contexts/SpaceContext';
import { AssetSaveDialog } from '../components/AssetPicker';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { TokenUsageBar } from '../components/TokenUsageBar';
import { LabPageLayout } from '../components/LabPageLayout';
import { AsyncState } from '../components/AsyncState';
import { UnsupportedCapabilityNotice } from '../components/UnsupportedCapabilityNotice';
import { usePlatformCapabilities } from '../hooks/usePlatformCapabilities';
import { usePlatformTextModels } from '../hooks/usePlatformTextModels';
import { TextAreaWithCounter } from '../components/TextAreaWithCounter';
import { SegmentPicker, type SegmentBindField } from '../components/SegmentPicker';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

type TextLabTab = 'chat' | 'refine' | 'models';

// ==================== 场景模板 ====================
const SCENE_TEMPLATES: { key: TextRefineScene; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'script', label: '剧本润色', icon: <Film size={16} />, color: 'var(--lab-color-music)' },
  { key: 'storyboard', label: '分镜描述', icon: <ImageIcon size={16} />, color: 'var(--lab-color-video)' },
  { key: 'character', label: '角色刻画', icon: <Users size={16} />, color: 'var(--lab-color-image)' },
  { key: 'scene', label: '场景描写', icon: <ImageIcon size={16} />, color: 'var(--lab-color-voice)' },
  { key: 'bgm_style', label: 'BGM 风格', icon: <Music size={16} />, color: 'var(--lab-color-text)' },
  { key: 'prompt_optimize', label: '提示词优化', icon: <Wand2 size={16} />, color: 'var(--primary-color)' },
];

// ==================== 聊天消息类型 ====================
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  usage?: TextGenerationResult['usage'];
  isStreaming?: boolean;
}

export const TextLab: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const { hasCapability } = usePlatformCapabilities();
  const { textModels, defaultModel } = usePlatformTextModels();

  const [activeTab, setActiveTab] = useState<TextLabTab>('chat');

  // ==================== Chat Tab State ====================
  const [chatModel, setChatModel] = useState<TextModel>('MiniMax-M3');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '您好！我是文本助理。我可以帮您润色提示词、头脑风暴视频剧本、或回答任何问题。请问今天需要什么帮助？' },
  ]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.95);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [enableThinking, setEnableThinking] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveContent, setSaveContent] = useState('');

  // ==================== Refine Tab State ====================
  const [refineScene, setRefineScene] = useState<TextRefineScene>('script');
  const [refineInput, setRefineInput] = useState('');
  const [refineStyle, setRefineStyle] = useState<RefineStyle>('standard');
  const [refineModel, setRefineModel] = useState<TextModel>('MiniMax-M3');

  // 平台切换时同步模型选择
  useEffect(() => {
    setChatModel(defaultModel);
    setRefineModel(defaultModel);
  }, [defaultModel]);
  const [isRefining, setIsRefining] = useState(false);
  const [refineResult, setRefineResult] = useState<{ content: string; thinking?: string; usage?: TextGenerationResult['usage'] } | null>(null);
  const [refineStreamingContent, setRefineStreamingContent] = useState('');
  const [refineStreamingThinking, setRefineStreamingThinking] = useState('');
  const refineAbortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);

  // ==================== Models Tab State ====================
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // ==================== SegmentPicker (发送到分镜) ====================
  const [pickerAsset, setPickerAsset] = useState<{ url: string; field: SegmentBindField; prompt?: string } | null>(null);

  // ==================== Auto-scroll ====================
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ==================== Chat Handlers ====================
  const handleSend = useCallback(() => {
    if (!input.trim() || isGenerating) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsGenerating(true);

    // Add streaming placeholder
    const assistantIdx = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', isStreaming: true }]);

    const apiMessages: TextGenerationMessage[] = newMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    let fullContent = '';
    let fullThinking = '';
    // eslint-disable-next-line prefer-const
    let usageData: TextGenerationResult['usage'] = undefined;

    const controller = textLabService.chatStream(apiMessages, {
      onTextDelta: (text) => {
        fullContent += text;
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: fullContent, thinking: fullThinking || undefined, isStreaming: true, usage: usageData };
          return updated;
        });
      },
      onThinkingDelta: (thinking) => {
        fullThinking += thinking;
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: fullContent, thinking: fullThinking || undefined, isStreaming: true, usage: usageData };
          return updated;
        });
      },
      onComplete: (result) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: result.content || fullContent, thinking: result.thinking || fullThinking || undefined, isStreaming: false, usage: result.usage || usageData };
          return updated;
        });
        setIsGenerating(false);
      },
      onError: (error) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', content: `*请求失败: ${error.message}*`, isStreaming: false };
          return updated;
        });
        setIsGenerating(false);
      },
    }, {
      model: chatModel,
      temperature,
      topP,
      maxTokens,
      thinking: enableThinking,
    });

    abortRef.current = controller;
  }, [input, isGenerating, messages, chatModel, temperature, topP, maxTokens, enableThinking]);

  const handleStopGenerating = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([
      { role: 'assistant', content: '您好！我是文本助理。我可以帮您润色提示词、头脑风暴视频剧本、或回答任何问题。请问今天需要什么帮助？' },
    ]);
  };

  // ==================== Refine Handlers ====================
  const handleRefine = useCallback(() => {
    if (!refineInput.trim() || isRefining) return;
    setIsRefining(true);
    setRefineResult(null);
    setRefineStreamingContent('');
    setRefineStreamingThinking('');

    let fullContent = '';
    let fullThinking = '';
    // eslint-disable-next-line prefer-const
    let usageData: TextGenerationResult['usage'] = undefined;

    const controller = textLabService.refineBySceneStream(
      refineScene,
      refineInput,
      refineStyle,
      {
        onTextDelta: (text) => {
          fullContent += text;
          setRefineStreamingContent(fullContent);
        },
        onThinkingDelta: (thinking) => {
          fullThinking += thinking;
          setRefineStreamingThinking(fullThinking);
        },
        onComplete: (result) => {
          setRefineResult({
            content: result.content || fullContent,
            thinking: result.thinking || fullThinking || undefined,
            usage: result.usage || usageData,
          });
          setRefineStreamingContent('');
          setRefineStreamingThinking('');
          setIsRefining(false);
        },
        onError: (error) => {
          showToast('error', getErrorMessage(error, t('textLab.refineFailed', '润色失败')));
          setIsRefining(false);
        },
      },
      refineModel,
    );

    refineAbortRef.current = controller;
  }, [refineInput, refineScene, refineStyle, refineModel, isRefining, showToast, t]);

  const handleCopyResult = useCallback(() => {
    const text = refineResult?.content || refineStreamingContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [refineResult, refineStreamingContent]);

  // ==================== Models Handlers ====================
  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const result = await modelManagementService.getModels();
      setModelList(result);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('textLab.modelLoadFailed', '获取模型列表失败')));
    } finally {
      setIsLoadingModels(false);
    }
  }, [showToast, t]);

  // ==================== Save to Library ====================
  const handleCollectPrompt = (content: string) => {
    setSaveContent(content);
    setShowSaveDialog(true);
  };

  const handleSavePrompt = async (name: string, tags: string) => {
    if (!currentSpaceId || !saveContent) return;
    try {
      await assetLibraryService.savePrompt({
        spaceId: currentSpaceId,
        name,
        content: saveContent,
        category: 'other',
        tags: tags ? tags.split(',').map(tg => tg.trim()).filter(Boolean) : [],
        sourceType: 'lab',
      });
      showToast('success', t('assetLibrary.collectSuccess', '提示词收藏成功'));
      setShowSaveDialog(false);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('assetLibrary.saveFailed', '素材保存失败')));
    }
  };

  // ==================== Tab 配置 ====================
  const tabs: { key: TextLabTab; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'chat', label: t('textLab.tabChat', '智能对话'), icon: <MessageSquare size={16} />, color: 'var(--lab-color-text)' },
    { key: 'refine', label: t('textLab.tabRefine', '场景润色'), icon: <Sparkles size={16} />, color: 'var(--lab-color-image)' },
    { key: 'models', label: t('textLab.tabModels', '模型管理'), icon: <Settings size={16} />, color: 'var(--lab-color-voice)' },
  ];

  // 当前展示的润色结果（流式或最终）
  const displayRefineContent = refineStreamingContent || refineResult?.content || '';
  const displayRefineThinking = refineStreamingThinking || refineResult?.thinking || '';
  const displayRefineUsage = refineResult?.usage;

  // P1 平台能力前置检测：文本生成仅部分平台支持，不支持时渲染提示
  if (!hasCapability('text')) {
    return <UnsupportedCapabilityNotice capability="text" />;
  }

  return (
    <LabPageLayout
      icon={<MessageSquare size={32} />}
      iconBg="color-mix(in srgb, var(--lab-color-text) 10%, transparent)"
      iconColor="var(--lab-color-text)"
      title={t('textLab.title', '文本实验室 (Text Lab)')}
      subtitle={t('textLab.desc', 'AI 文本润色、剧本创作、提示词优化，支持多模型与思维链')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TextLabTab)}
    >
      {/* ==================== Chat Tab ==================== */}
      {activeTab === 'chat' && (
        <div className="chat-layout">
          {/* Top bar — compact inline */}
          <div className="chat-top-bar">
            <select className="form-select btn-sm" style={{ width: 'auto', fontSize: '0.8rem' }} value={chatModel} onChange={e => setChatModel(e.target.value as TextModel)}>
              {textModels.map(m => (
                <option key={m.id} value={m.id}>{m.label} — {m.description}</option>
              ))}
              {textModels.length === 0 && <option disabled>当前平台不支持文本生成</option>}
            </select>
            <button className="btn btn-secondary btn-xs" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {t('textLab.advanced', '高级参数')}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={clearChat}>
              <RefreshCw size={12} /> {t('textLab.clearChat', '清空')}
            </button>
          </div>

          {/* Advanced settings */}
          {showAdvanced && (
            <div className="chat-advanced">
              <div className="chat-advanced-item">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('textLab.temperature', '温度')} ({temperature})</label>
                <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--lab-color-text)' }} />
              </div>
              <div className="chat-advanced-item">
                <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('textLab.topP', 'Top P')} ({topP})</label>
                <input type="range" min="0" max="1" step="0.05" value={topP} onChange={e => setTopP(parseFloat(e.target.value))} style={{ width: '100%', accentColor: 'var(--lab-color-text)' }} />
              </div>
              <div style={{ flex: 1, minWidth: '100px' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>{t('textLab.maxTokens', 'Max Tokens')}</label>
                <select className="form-select btn-xs" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))}>
                  <option value={2048}>2048</option>
                  <option value={4096}>4096</option>
                  <option value={8192}>8192</option>
                  <option value={16384}>16384</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={enableThinking} onChange={e => setEnableThinking(e.target.checked)} style={{ width: '12px', height: '12px', accentColor: 'var(--lab-color-music)' }} />
                {t('textLab.enableThinking', 'Thinking')}
              </label>
            </div>
          )}

          {/* Chat area */}
          <div className="glass-panel chat-panel">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <AsyncState empty emptyText="开始对话吧" />
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`chat-message ${msg.role === 'user' ? 'chat-message-user' : ''}`}>
                    <div className={`chat-avatar ${msg.role === 'user' ? 'chat-avatar-user' : 'chat-avatar-assistant'}`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}>
                      {msg.isStreaming && !msg.content ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          <Sparkles size={12} className="spin" /> {t('textLab.thinking', '思考中...')}
                        </span>
                      ) : (
                        <>
                          {msg.content}
                          {msg.isStreaming && <span className="blink-cursor" style={{ borderRight: '2px solid var(--primary-color)', marginLeft: '2px' }}>&nbsp;</span>}
                        </>
                      )}
                      {msg.role === 'assistant' && msg.thinking && !msg.isStreaming && (
                        <ThinkingBlock thinking={msg.thinking} />
                      )}
                      {msg.role === 'assistant' && msg.usage && !msg.isStreaming && (
                        <TokenUsageBar usage={msg.usage} style={{ marginTop: '0.4rem' }} />
                      )}
                      {msg.role === 'assistant' && idx > 0 && !msg.isStreaming && (
                        <div className="chat-action-btn">
                          <button onClick={() => handleCollectPrompt(msg.content)} title={t('assetLibrary.collectBtn', '收藏')}>
                            <BookmarkPlus size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input — compact */}
            <div className="chat-input-area">
              <div className="chat-input-row">
                <TextAreaWithCounter
                  className="form-input"
                  style={{ flex: 1, resize: 'none', padding: '0.5rem', fontSize: '0.9rem' }}
                  rows={1}
                  placeholder={t('textLab.inputPlaceholder', '输入提示词或问题... (Shift+Enter 换行)')}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={TEXT_LIMITS.CHAT_INPUT_MAX}
                />
                <button
                  className="btn btn-primary btn-sm"
                  style={{ background: isGenerating ? 'var(--color-danger)' : 'var(--color-success)', border: 'none', color: 'var(--text-inverse)', padding: '0 1rem' }}
                  disabled={!input.trim() && !isGenerating}
                  onClick={isGenerating ? handleStopGenerating : handleSend}
                >
                  {isGenerating ? <RefreshCw size={16} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== Refine Tab ==================== */}
      {activeTab === 'refine' && (
        <div className="textlab-refine-layout">
          {/* Left: Input panel */}
          <div className="glass-panel textlab-refine-input-panel" style={{ padding: '0.75rem' }}>
            <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>{t('textLab.selectScene', '润色场景')}</label>
            <div className="textlab-scene-chips">
              {SCENE_TEMPLATES.map(s => (
                <button
                  key={s.key}
                  className={`textlab-scene-chip${refineScene === s.key ? ' active' : ''}`}
                  style={refineScene === s.key ? { background: s.color, borderColor: s.color } : undefined}
                  onClick={() => { setRefineScene(s.key); setRefineResult(null); }}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>

            <TextAreaWithCounter
              className="form-input"
              rows={8}
              placeholder={t('textLab.refineInputPlaceholder', '粘贴或输入需要润色的文本...')}
              value={refineInput}
              onChange={e => setRefineInput(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '0.6rem' }}
              maxLength={TEXT_LIMITS.REFINE_INPUT_MAX}
            />

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="textlab-style-chips">
                {(['concise', 'standard', 'detailed'] as RefineStyle[]).map(s => (
                  <button key={s} className={`textlab-style-chip${refineStyle === s ? ' active' : ''}`}
                    onClick={() => setRefineStyle(s)}>
                    {s === 'concise' ? '简洁' : s === 'standard' ? '标准' : '详细'}
                  </button>
                ))}
              </div>
              <select className="form-select btn-xs" style={{ width: '130px' }} value={refineModel} onChange={e => setRefineModel(e.target.value as TextModel)}>
                {textModels.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <button
              className="btn btn-primary btn-sm"
              style={{ background: 'var(--lab-color-image)', width: '100%' }}
              disabled={!refineInput.trim() || isRefining}
              onClick={handleRefine}
            >
              {isRefining ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />}
              {isRefining ? t('textLab.refining', '润色中...') : t('textLab.refineBtn', '一键润色')}
            </button>
          </div>

          {/* Right: Result panel */}
          {(displayRefineContent || isRefining) ? (
            <div className="glass-panel textlab-refine-result-panel" style={{ padding: '0.75rem', background: 'color-mix(in srgb, var(--lab-color-music) 6%, transparent)', borderColor: 'color-mix(in srgb, var(--lab-color-music) 20%, transparent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                <CheckCircle2 size={14} style={{ color: 'var(--lab-color-enhance)' }} />
                <span style={{ color: 'var(--lab-color-enhance)', fontWeight: 600, fontSize: '0.85rem' }}>{t('textLab.refineResult', '润色结果')}</span>
                {isRefining && <RefreshCw size={12} className="spin" style={{ color: 'var(--lab-color-enhance)' }} />}
              </div>
              <div style={{ fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, overflowY: 'auto' }}>
                {displayRefineContent}
                {isRefining && <span style={{ borderRight: '2px solid var(--lab-color-music)', marginLeft: '2px' }}>&nbsp;</span>}
              </div>
              {displayRefineThinking && !isRefining && <ThinkingBlock thinking={displayRefineThinking} />}
              {displayRefineUsage && !isRefining && <TokenUsageBar usage={displayRefineUsage} style={{ marginTop: '0.4rem' }} />}
              {!isRefining && displayRefineContent && (
                <div className="textlab-refine-actions" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                  <button className="btn btn-secondary btn-xs" onClick={handleCopyResult}>
                    {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                    {copied ? t('textLab.copied', '已复制') : t('textLab.copy', '复制')}
                  </button>
                  <button className="btn btn-secondary btn-xs" onClick={() => handleCollectPrompt(displayRefineContent)}>
                    <BookmarkPlus size={12} /> {t('assetLibrary.collectBtn', '收藏')}
                  </button>
                  {refineScene === 'bgm_style' && (
                    <button className="btn btn-xs" style={{ background: 'var(--lab-color-music)', color: 'var(--text-inverse)' }} onClick={() => { showToast('success', t('textLab.applied', '已复制到剪贴板')); navigator.clipboard.writeText(displayRefineContent); }}>
                      <ArrowRight size={12} /> {t('textLab.useForMusic', '用于音乐')}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPickerAsset({ url: displayRefineContent, field: 'prompt' })}
                  >
                    <Send size={12} /> {t('segmentPicker.sendToSegment', '发送到分镜')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel textlab-refine-result-panel" style={{ padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
              <div style={{ textAlign: 'center' }}>
                <Sparkles size={32} style={{ marginBottom: '0.5rem' }} />
                <p style={{ fontSize: '0.85rem' }}>{t('textLab.refineResultHint', '润色结果将在此显示')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== Models Tab ==================== */}
      {activeTab === 'models' && (
        <div className="glass-panel slide-up" style={{ padding: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>{t('textLab.availableModels', '可用模型')}</h3>
            <button className="btn btn-secondary btn-xs" onClick={loadModels} disabled={isLoadingModels}>
              {isLoadingModels ? <RefreshCw className="spin" size={12} /> : <Database size={12} />} {t('textLab.refreshModels', '刷新')}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="textlab-model-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th style={{ textAlign: 'center' }}>文本</th>
                  <th style={{ textAlign: 'center' }}>图片理解</th>
                  <th style={{ textAlign: 'center' }}>Thinking</th>
                  <th style={{ textAlign: 'center' }}>工具调用</th>
                  <th>推荐场景</th>
                </tr>
              </thead>
              <tbody>
                {textModels.map(m => (
                  <tr key={m.id}>
                    <td><strong>{m.id}</strong></td>
                    <td style={{ textAlign: 'center' }}>{'✅'}</td>
                    <td style={{ textAlign: 'center' }}>{m.multimodal ? '✅' : '—'}</td>
                    <td style={{ textAlign: 'center', color: m.thinking === 'adaptive' ? 'var(--lab-color-image)' : 'var(--text-muted)' }}>
                      {m.thinking === 'adaptive' ? '可控' : m.thinking === 'always' ? '始终' : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{m.tools ? '✅' : '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{m.rec}</td>
                  </tr>
                ))}
                {textModels.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>当前平台不支持文本模型</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {modelList.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.4rem 0' }}>{t('textLab.apiModels', 'API 返回的模型列表')}</h4>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {modelList.map(m => (
                  <span key={m.id} className="textlab-model-tag">{m.displayName || m.id}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 保存对话框 ==================== */}
      {showSaveDialog && (
        <AssetSaveDialog
          title={t('assetLibrary.collectBtn', '收藏提示词')}
          defaultName={saveContent.slice(0, 20) + (saveContent.length > 20 ? '...' : '')}
          onSave={handleSavePrompt}
          onCancel={() => setShowSaveDialog(false)}
        />
      )}
      <SegmentPicker
        isOpen={!!pickerAsset}
        assetUrl={pickerAsset?.url ?? ''}
        bindField={pickerAsset?.field ?? 'image'}
        assetPrompt={pickerAsset?.prompt}
        onClose={() => setPickerAsset(null)}
      />
    </LabPageLayout>
  );
};
