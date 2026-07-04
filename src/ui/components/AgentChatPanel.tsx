import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Wand2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { agentService } from '../../dependencies';
import { useToast } from '../contexts/ToastContext';
import { useSpace } from '../contexts/SpaceContext';
import { getErrorMessage } from '../utils/errorUtils';
import type { AgentMessage, ReActEvent } from '../../domain/services/AgentService';
import { TextAreaWithCounter } from './TextAreaWithCounter';
import { TEXT_LIMITS } from '../../domain/constants/textLimits';

interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_result' | 'thinking';
  content: string;
  /** 工具调用名称（仅 role='tool_result' 时） */
  toolName?: string;
}

export const AgentChatPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentSpaceId } = useSpace();
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    if (!currentSpaceId) {
      showToast('warning', t('agent.noSpace', '请先选择工作空间'));
      return;
    }
    const userMsg: AgentChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };
    setMessages(prev => [...prev, userMsg]);
    const userInput = input;
    setInput('');
    setIsLoading(true);

    // 构建历史消息（仅 user/assistant，过滤掉 thinking/tool_result 展示态）
    const agentMessages: AgentMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      // P1 升级：使用 chatWithTools 启用 ReAct 工具循环（原 legacy chat 无工具能力）
      const result = await agentService.chatWithTools({
        messages: [...agentMessages, { role: 'user', content: userInput }],
        spaceId: currentSpaceId,
        onEvent: (event: ReActEvent) => {
          switch (event.type) {
            case 'thinking':
              setMessages(prev => [...prev, {
                id: `think_${event.iteration}_${event.timestamp}`,
                role: 'thinking',
                content: event.content,
              }]);
              break;
            case 'tool_calls':
              for (const tc of event.toolCalls) {
                setMessages(prev => [...prev, {
                  id: `tool_${tc.id}`,
                  role: 'tool_result',
                  content: tc.arguments,
                  toolName: tc.name,
                }]);
              }
              break;
            case 'final_answer':
              // 最终答案在 result.content 中统一处理，此处不重复添加
              break;
          }
        },
      });
      const assistantMsg: AgentChatMessage = {
        id: `asst_${Date.now()}`,
        role: 'assistant',
        content: result.content,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      showToast('error', getErrorMessage(e, t('agent.error')));
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: getErrorMessage(e, t('agent.error')),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, currentSpaceId, showToast, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickActions = [
    { label: t('agent.quickCreateCharacter'), prompt: t('agent.quickCreateCharacterPrompt') },
    { label: t('agent.quickSplitStory'), prompt: t('agent.quickSplitPrompt') },
    { label: t('agent.quickGenerateImage'), prompt: t('agent.quickGenerateImagePrompt') },
    { label: t('agent.quickGenerateNarration'), prompt: t('agent.quickGenerateNarrationPrompt') },
  ];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem',
        background: 'rgba(129,140,248,0.15)',
        borderBottom: '1px solid rgba(129,140,248,0.2)',
      }}>
        <Bot size={18} style={{ color: '#818cf8', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('agent.title')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('agent.subtitle')}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2rem' }}>
            <Sparkles size={32} style={{ margin: '0 auto 0.5rem', display: 'block', opacity: 0.5 }} />
            {t('agent.welcome')}
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: msg.role === 'user' ? 'rgba(99,102,248,0.2)' : 'rgba(129,140,248,0.2)',
            }}>
              {msg.role === 'user'
                ? <User size={14} style={{ color: '#818cf8' }} />
                : msg.role === 'tool_result'
                  ? <Wrench size={12} style={{ color: 'var(--warning)' }} />
                  : <Bot size={14} style={{ color: '#a78bfa' }} />
              }
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                {msg.role === 'user'
                  ? t('agent.you')
                  : msg.role === 'tool_result'
                    ? `🔧 ${msg.toolName ?? 'tool'}`
                    : msg.role === 'thinking'
                      ? '💭 thinking'
                      : 'Agent'}
              </div>
              <div style={{
                background: msg.role === 'thinking'
                  ? 'rgba(168,139,250,0.08)'
                  : msg.role === 'tool_result'
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(255,255,255,0.05)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                fontStyle: msg.role === 'thinking' ? 'italic' : undefined,
                opacity: msg.role === 'thinking' ? 0.8 : 1,
              }}>
                {msg.content || (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('agent.thinking')}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: 'rgba(129,140,248,0.2)',
            }}>
              <Bot size={14} style={{ color: '#a78bfa' }} />
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <Loader2 size={14} className="spin" />
              {t('agent.thinking')}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {messages.length === 0 && (
        <div style={{ padding: '0 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          {quickActions.map(action => (
            <button
              key={action.prompt}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => { setInput(action.prompt); textareaRef.current?.focus(); }}
            >
              <Wand2 size={12} />
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div style={{
        padding: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
      }}>
        <TextAreaWithCounter
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.placeholder')}
          rows={2}
          style={{ resize: 'none', flex: 1, fontSize: '0.875rem' }}
          disabled={isLoading}
          maxLength={TEXT_LIMITS.AGENT_INPUT_MAX}
        />
        <button
          className="btn btn-primary"
          style={{ padding: '0.5rem 0.75rem', alignSelf: 'flex-end', flexShrink: 0 }}
          disabled={!input.trim() || isLoading}
          onClick={sendMessage}
        >
          {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
};
