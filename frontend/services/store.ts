import { useState, useCallback, useEffect } from 'react';
import { AppState, UserProfile, Node, CalibrationLog, ChatMessage, Language } from '../types';
import { INITIAL_STATE } from '../constants';

export type Theme = 'light' | 'dark';

export const useAppStore = () => {
  // 从localStorage读取主题偏好，默认为light
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('cognisync-theme');
    const initialTheme = (saved as Theme) || 'light';
    // 立即设置到DOM上，避免闪烁
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', initialTheme);
    }
    return initialTheme;
  });

  const [state, setState] = useState<AppState>(INITIAL_STATE);

  // 主题切换时更新localStorage和document类名
  useEffect(() => {
    localStorage.setItem('cognisync-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  const toggleResearchMode = () => {
    setState(prev => ({ ...prev, isResearchMode: !prev.isResearchMode }));
  };

  const setLanguage = (lang: Language) => {
    setState(prev => ({ ...prev, language: lang }));
  };

  const addMessage = (text: string, role: 'user' | 'assistant', analysis?: ChatMessage['analysis']) => {
    const newMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role,
      text,
      timestamp: new Date().toISOString(),
      analysis
    };

    setState(prev => {
      let newProfile = { ...prev.profile };
      let newNodes = [...prev.nodes];

      // Simulate Real-time Updates if analysis exists
      if (analysis) {
        // Update Profile
        if (analysis.delta.cognition) newProfile.cognition = Math.min(100, Math.max(0, newProfile.cognition + analysis.delta.cognition));
        if (analysis.delta.affect) newProfile.affect = Math.min(100, Math.max(0, newProfile.affect + analysis.delta.affect));
        if (analysis.delta.behavior) newProfile.behavior = Math.min(100, Math.max(0, newProfile.behavior + analysis.delta.behavior));
        newProfile.lastUpdate = new Date().toISOString();

        // Update Knowledge Graph Concepts
        analysis.detectedConcepts.forEach(conceptName => {
          const nodeIndex = newNodes.findIndex(n => n.name === conceptName);
          if (nodeIndex >= 0) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              frequency: Math.min(10, newNodes[nodeIndex].frequency + 1),
              // Randomly fluctuate mastery for simulation
              mastery: Math.min(100, Math.max(0, newNodes[nodeIndex].mastery + (role === 'assistant' ? 2 : -1)))
            };
          }
        });
      }

      return {
        ...prev,
        profile: newProfile,
        nodes: newNodes,
        messages: [...prev.messages, newMessage]
      };
    });
  };

  const addCalibrationLog = (log: Omit<CalibrationLog, 'id' | 'timestamp'>) => {
    const newLog: CalibrationLog = {
      ...log,
      id: `cal_${Date.now()}`,
      timestamp: new Date().toISOString()
    };

    setState(prev => ({
      ...prev,
      logs: [newLog, ...prev.logs]
    }));
  };

  const updateNode = (id: string, updates: Partial<Node>) => {
    setState(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === id ? { ...n, ...updates } : n)
    }));
  };

  const updateProfile = (profile: UserProfile) => {
    setState(prev => ({
      ...prev,
      profile
    }));
  };

  return {
    state,
    theme,
    toggleTheme,
    toggleResearchMode,
    setLanguage,
    addMessage,
    addCalibrationLog,
    updateNode,
    updateProfile
  };
};