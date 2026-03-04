import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { apiClient } from '../../lib/apiClient';
import * as authApi from './api';
import {
  AuthState,
  AuthStatus,
  User,
  UserProfile,
  LoginRequest,
} from './types';

interface AuthContextValue extends AuthState {
  login: (data: LoginRequest) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  updateUser: (user: User) => void;
  updateProfile: (profile: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// 全局 profile 更新回调，供其他模块使用
let globalProfileUpdateCallback: ((profile: UserProfile) => void) | null = null;

export const registerProfileUpdateCallback = (callback: (profile: UserProfile) => void) => {
  globalProfileUpdateCallback = callback;
};

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);

  /**
   * 登录
   */
  const login = useCallback(async (data: LoginRequest) => {
    try {
      const response = await authApi.login(data);

      // 保存 token
      apiClient.setAuthToken(response.token);

      // 更新状态
      setStatus('authed');
      setUser(response.user);
      setProfile(response.initialProfile || null);
      setToken(response.token);

      // 如果有初始 profile，触发全局更新
      if (response.initialProfile && globalProfileUpdateCallback) {
        globalProfileUpdateCallback(response.initialProfile);
      }
    } catch (error) {
      // 登录失败，清除状态
      apiClient.setAuthToken(null);
      setStatus('guest');
      setUser(null);
      setProfile(null);
      setToken(null);
      throw error;
    }
  }, []);

  /**
   * 登出
   */
  const logout = useCallback(() => {
    authApi.logout();
    setStatus('guest');
    setUser(null);
    setProfile(null);
    setToken(null);
  }, []);

  /**
   * 应用启动时调用，检查是否已登录
   */
  const bootstrap = useCallback(async () => {
    const token = localStorage.getItem('auth_token');

    if (!token) {
      setStatus('guest');
      return;
    }

    try {
      // 有 token，尝试获取用户信息
      const { user, profile } = await authApi.getCurrentUser();

      setStatus('authed');
      setUser(user);
      setProfile(profile);
      setToken(token);

      // 触发全局 profile 更新
      if (profile && globalProfileUpdateCallback) {
        globalProfileUpdateCallback(profile);
      }
    } catch (error) {
      // token 无效，清除状态
      authApi.logout();
      setStatus('guest');
      setUser(null);
      setProfile(null);
      setToken(null);
    }
  }, []);

  /**
   * 更新用户信息
   */
  const updateUser = useCallback((user: User) => {
    setUser(user);
  }, []);

  /**
   * 更新用户 profile
   */
  const updateProfile = useCallback((profile: UserProfile) => {
    setProfile(profile);

    // 触发全局更新
    if (globalProfileUpdateCallback) {
      globalProfileUpdateCallback(profile);
    }
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    profile,
    token,
    login,
    logout,
    bootstrap,
    updateUser,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * 使用认证上下文的 hook
 */
export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
}

/**
 * 全局 updateProfile 函数，供其他模块调用
 * 注意：这需要在 AuthProvider 内部使用
 */
export const updateProfileGlobal = (profile: UserProfile) => {
  if (globalProfileUpdateCallback) {
    globalProfileUpdateCallback(profile);
  }
};
