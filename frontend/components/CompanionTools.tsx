import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Briefcase, MessageCircle, Moon, Sun } from 'lucide-react';
import { FloatingCompanion } from './FloatingCompanion';
import { REVIEW_HOLD_EVENT } from '../services/projectReview';

type Assistant = { open: boolean; busy: boolean; activate: () => void };
type Registration = Assistant & { token: symbol };
const AssistantContext = createContext<(assistant: Assistant) => () => void>(() => () => {});
const ToolboxContext = createContext<(activate: () => void) => () => void>(() => () => {});
export const CompanionAvailability = createContext(false);

export function useCompanionToolbox(enabled: boolean, activate: () => void) {
  const register = useContext(ToolboxContext);
  const latest = useRef(activate); latest.current = activate;
  useEffect(() => { if (enabled) return register(() => latest.current()); }, [register, enabled]);
}

// Pages register their own assistant; the launcher never creates a separate chat.
export function useCompanionAssistant(enabled: boolean, open: boolean, busy: boolean, activate: () => void) {
  const register = useContext(AssistantContext);
  const allowed = useContext(CompanionAvailability);
  const latest = useRef(activate);
  latest.current = activate;
  useEffect(() => {
    if (enabled && allowed) return register({ open, busy, activate: () => latest.current() });
  }, [register, enabled, allowed, open, busy]);
}

export const CompanionTools: React.FC<{
  children: React.ReactNode; userId: string; theme: 'light' | 'dark'; language: string;
  onToggleTheme: () => void; contextKey: string;
}> = ({ children, userId, theme, language, onToggleTheme, contextKey }) => {
  const [assistant, setAssistant] = useState<Registration | null>(null);
  const [toolbox, setToolbox] = useState<{ token: symbol; activate: () => void } | null>(null);
  const registerToolbox = useCallback((activate: () => void) => {
    const token = Symbol('page-toolbox'); setToolbox({ token, activate });
    return () => setToolbox(current => current?.token === token ? null : current);
  }, []);
  const [reviewHeld, setReviewHeld] = useState(false);
  useEffect(() => { const receive = (event: Event) => setReviewHeld(Boolean((event as CustomEvent).detail));
    window.addEventListener(REVIEW_HOLD_EVENT, receive); return () => window.removeEventListener(REVIEW_HOLD_EVENT, receive); }, []);
  const register = useCallback((next: Assistant) => {
    const token = Symbol('page-assistant');
    setAssistant({ ...next, token });
    return () => setAssistant(current => current?.token === token ? null : current);
  }, []);
  const zh = language !== 'en';
  return <AssistantContext.Provider value={register}><ToolboxContext.Provider value={registerToolbox}>
    {children}
    <FloatingCompanion userId={userId} contextKey={contextKey} open={assistant?.open ?? false} busy={assistant?.busy} actions={[
      { id: 'ask', label: zh ? '提问' : 'Ask AI', icon: <MessageCircle size={18} />, disabled: !assistant || reviewHeld,
        title: !assistant ? (zh ? '当前页面暂不可提问' : 'AI is unavailable on this page') : undefined,
        onSelect: () => { if (!reviewHeld) assistant?.activate(); } },
      { id: 'toolbox', label: zh ? '工具包' : 'Toolbox', icon: <Briefcase size={18} />, disabled: !toolbox || reviewHeld,
        onSelect: () => { if (!reviewHeld) toolbox?.activate(); } },
      { id: 'theme', label: zh ? '切换模式' : 'Appearance', icon: theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />,
        title: zh ? `切换为${theme === 'dark' ? '浅' : '深'}色模式` : `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
        onSelect: onToggleTheme },
    ]} />
  </ToolboxContext.Provider></AssistantContext.Provider>;
};
