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

  // 从 localStorage 读取 token 和缓存的画像，初始化认证状态
  const [state, setState] = useState<AppState>(() => {
    const token = localStorage.getItem('cognisync-token');
    const profileStr = localStorage.getItem('cognisync-profile');
    let cachedProfile = INITIAL_STATE.profile;
    if (profileStr) {
      try {
        cachedProfile = JSON.parse(profileStr);
      } catch {
        // ignore parse errors
      }
    }
    return {
      ...INITIAL_STATE,
      token,
      profile: cachedProfile,
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
          if (profile) {
            localStorage.setItem('cognisync-profile', JSON.stringify(profile));
          }
          setState(prev => ({
            ...prev,
            user,
            // 如果 profile 为 null，保留初始默认值
            profile: profile || prev.profile,
            token,
          }));
        } catch (error) {
          console.error('Failed to get user info:', error);
          // Token 无效，清除
          localStorage.removeItem('cognisync-token');
          localStorage.removeItem('cognisync-profile');
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
      let newNodes = [...prev.nodes];

      // Update local knowledge graph nodes from detected concepts
      // (serves as fallback when Neo4j is unavailable)
      if (analysis?.detectedConcepts) {
        analysis.detectedConcepts.forEach(conceptName => {
          const nodeIndex = newNodes.findIndex(n => n.name === conceptName);
          if (nodeIndex >= 0) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              frequency: Math.min(10, newNodes[nodeIndex].frequency + 1),
            };
          } else {
            // Add newly detected concept as a local node
            newNodes.push({
              id: `local-${conceptName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-')}`,
              name: conceptName,
              mastery: 50,
              frequency: 1,
              description: '',
              category: '通用',
            });
          }
        });
      }

      return {
        ...prev,
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
    localStorage.setItem('cognisync-profile', JSON.stringify(profile));
    setState(prev => ({
      ...prev,
      profile
    }));
  };

  const clearMessages = () => {
    setState(prev => ({ ...prev, messages: [] }));
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
    if (profile) {
      localStorage.setItem('cognisync-profile', JSON.stringify(profile));
    }
    setState(prev => ({
      ...prev,
      user,
      token,
      profile: profile || prev.profile,
    }));
  };

  const clearAuth = () => {
    localStorage.removeItem('cognisync-token');
    localStorage.removeItem('cognisync-profile');
    // 清除 onboarding 相关的 localStorage 数据
    localStorage.removeItem('userAttributes');
    localStorage.removeItem('conceptSeeds');
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
    clearMessages,
    // 认证方法
    setUser,
    setToken,
    setAuth,
    clearAuth,
  };
};