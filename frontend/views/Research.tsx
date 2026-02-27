import React, { useState, useRef, useEffect, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Send, CheckCircle, FlaskConical, Loader, Save } from 'lucide-react';
import type { ChatMessage, Language, UserProfile, ResearchTask } from '../types';
import {
  sendChatMessage,
  getActiveResearchTask,
  saveResearchProgress,
  completeResearchTask,
} from '../services/api';

interface Props {
  onUpdateProfile: (profile: UserProfile) => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
}

export const Research: React.FC<Props> = ({
  onUpdateProfile,
  language,
  theme,
  userId,
}) => {
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [code, setCode] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isZh = language === 'zh';

  useEffect(() => {
    getActiveResearchTask()
      .then(t => {
        setTask(t);
        if (t) setCode(t.code_content);
      })
      .catch(() => setTask(null))
      .finally(() => setLoadingTask(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!task) return;
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveResearchProgress(task.id, value);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [task]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !task) return;
    const userText = input;
    setInput('');
    setError(null);
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      text: userText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);
    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode: true,
        currentCode: code,
      });
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        text: response.message,
        timestamp: new Date().toISOString(),
        analysis: response.analysis,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (response.updatedProfile) onUpdateProfile(response.updatedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : isZh ? '发送失败' : 'Failed to send');
    } finally {
      setIsTyping(false);
    }
  };

  const handleComplete = async () => {
    if (!task || completing || completed) return;
    setCompleting(true);
    try {
      await completeResearchTask(task.id, code);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : isZh ? '提交失败' : 'Failed to submit');
    } finally {
      setCompleting(false);
    }
  };

  const getExtensions = () => {
    if (!task) return [];
    switch (task.language.toLowerCase()) {
      case 'python': return [python()];
      case 'javascript': case 'js': return [javascript()];
      case 'typescript': case 'ts': return [javascript({ typescript: true })];
      default: return [];
    }
  };

  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
  const textColor = theme === 'light' ? '#000000' : '#ffffff';
  const panelBg = theme === 'light' ? 'rgba(249,250,251,0.8)' : 'rgba(15,23,42,0.8)';
  const inputBg = theme === 'light' ? '#ffffff' : '#1e293b';

  if (loadingTask) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-24" style={{ color: theme === 'light' ? '#6b7280' : '#94a3b8' }}>
        <FlaskConical className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-lg font-medium">
          {isZh ? '暂无活跃的研究任务' : 'No active research task'}
        </p>
        <p className="text-sm mt-2">
          {isZh ? '教师发布任务后，将会在此处显示。' : 'Tasks will appear here once published by your instructor.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Left: Code Editor Panel */}
      <div
        className="flex-[3] flex flex-col min-h-0 rounded-2xl overflow-hidden border"
        style={{ borderColor, background: theme === 'light' ? '#ffffff' : '#0f172a' }}
      >
        {/* Task header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <FlaskConical size={16} className="text-indigo-500 shrink-0" />
            <span className="font-semibold text-sm truncate" style={{ color: textColor }}>
              {task.title}
            </span>
            <span className="px-2 py-0.5 text-xs font-mono rounded shrink-0 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              {task.language}
            </span>
          </div>
          {task.instructions && (
            <span className="text-xs text-gray-500 max-w-sm truncate ml-4 shrink-0">
              {task.instructions}
            </span>
          )}
        </div>

        {/* CodeMirror editor */}
        <div className="flex-1 overflow-hidden">
          <CodeMirror
            value={code}
            onChange={handleCodeChange}
            extensions={getExtensions()}
            theme={theme === 'dark' ? oneDark : undefined}
            height="100%"
            style={{ height: '100%', fontSize: '13px' }}
          />
        </div>

        {/* Footer: save status + complete button */}
        <div
          className="px-4 py-2 border-t flex items-center justify-between shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Save size={12} />
            <span>
              {saveStatus === 'saving'
                ? (isZh ? '保存中...' : 'Saving...')
                : saveStatus === 'saved'
                ? (isZh ? '已保存' : 'Saved')
                : (isZh ? '未保存' : 'Unsaved')}
            </span>
          </div>
          <button
            onClick={handleComplete}
            disabled={completing || completed}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
            style={{ background: completed ? '#6b7280' : 'linear-gradient(to right, #10b981, #059669)' }}
          >
            {completing
              ? <Loader size={14} className="animate-spin" />
              : <CheckCircle size={14} />}
            <span>
              {completed
                ? (isZh ? '已提交' : 'Submitted')
                : (isZh ? '完成任务' : 'Submit Task')}
            </span>
          </button>
        </div>
      </div>

      {/* Right: Chat Panel */}
      <div
        className="flex-[2] flex flex-col min-h-0 rounded-2xl overflow-hidden border"
        style={{ borderColor, background: theme === 'light' ? '#ffffff' : '#0f172a' }}
      >
        {/* Chat header */}
        <div
          className="px-4 py-3 border-b shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          <p className="text-sm font-semibold" style={{ color: textColor }}>
            {isZh ? 'AI 学习助手' : 'AI Learning Assistant'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: theme === 'light' ? '#6b7280' : '#94a3b8' }}>
            {isZh ? '遇到问题？和我聊聊吧' : 'Stuck? Chat with me'}
          </p>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div
              className="text-center text-sm mt-8"
              style={{ color: theme === 'light' ? '#9ca3af' : '#64748b' }}
            >
              {isZh
                ? '开始提问，我会帮助你完成代码！'
                : "Start asking — I'll help you complete the code!"}
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-sm'
                    : ''
                }`}
                style={msg.role === 'assistant' ? {
                  backgroundColor: theme === 'light' ? '#f3f4f6' : '#1e293b',
                  color: textColor,
                  borderRadius: '1rem 1rem 1rem 0.25rem',
                } : {}}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl rounded-bl-sm px-4 py-3"
                style={{ backgroundColor: theme === 'light' ? '#f3f4f6' : '#1e293b' }}
              >
                <div className="flex gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="w-2 h-2 rounded-full animate-bounce"
                      style={{ backgroundColor: '#9ca3af', animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-1 text-xs text-red-500 text-center">{error}</div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 shrink-0">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isZh ? '问我任何问题...' : 'Ask me anything...'}
              disabled={completed}
              className="flex-1 px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{
                borderColor,
                backgroundColor: inputBg,
                color: textColor,
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping || completed}
              className="p-2 rounded-xl text-white hover:opacity-90 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(to right, #6366f1, #9333ea)' }}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
