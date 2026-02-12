import { useState, useCallback, useEffect } from 'react';
import { AppState, UserProfile, Node, CalibrationLog, ChatMessage, Language, User } from '../types';
import { INITIAL_STATE } from '../constants';
import { getCurrentUser } from './api';

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

  // 从 localStorage 读取 token，初始化认证状态
  const [state, setState] = useState<AppState>(() => {
    const token = localStorage.getItem('cognisync-token');
    return {
      ...INITIAL_STATE,
      token,
      user: null,
    };
  });

  // 初始化时如果有 token，获取用户信息
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('cognisync-token');
      if (token && !state.user) {
        try {
          const { user, profile } = await getCurrentUser();
          setState(prev => ({
            ...prev,
            user,
            profile,
            token,
          }));
        } catch (error) {
          console.error('Failed to get user info:', error);
          // Token 无效，清除
          localStorage.removeItem('cognisync-token');
          setState(prev => ({
            ...prev,
            token: null,
            user: null,
          }));
        }
      }
    };

    initAuth();
  }, []);

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

  // 认证相关方法
  const setUser = (user: User | null) => {
    setState(prev => ({
      ...prev,
      user,
    }));
  };

  const setToken = (token: string | null) => {
    if (token) {
      localStorage.setItem('cognisync-token', token);
    } else {
      localStorage.removeItem('cognisync-token');
    }
    setState(prev => ({
      ...prev,
      token,
    }));
  };

  const setAuth = (user: User, token: string, profile?: UserProfile) => {
    localStorage.setItem('cognisync-token', token);
    setState(prev => ({
      ...prev,
      user,
      token,
      profile: profile || prev.profile,
    }));
  };

  const clearAuth = () => {
    localStorage.removeItem('cognisync-token');
    setState(prev => ({
      ...prev,
      user: null,
      token: null,
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
    updateProfile,
    // 认证方法
    setUser,
    setToken,
    setAuth,
    clearAuth,
  };
};