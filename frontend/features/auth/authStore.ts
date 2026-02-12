/**
 * Auth Store - 认证状态管理
 */

import { useState, useCallback, useEffect } from 'react';
import { tokenStorage } from '../../lib/tokenStorage';
import * as authApi from './api';
import type { AuthState, AuthStatus, User, UserProfile, LoginRequest, RegisterRequest } from './types';

// 初始状态
const INITIAL_AUTH_STATE: AuthState = {
  status: 'unknown',
  user: null,
  profile: null,
  token: null,
};

/**
 * 认证 Store Hook
 */
export function useAuthStore() {
  const [authState, setAuthState] = useState<AuthState>(INITIAL_AUTH_STATE);

  /**
   * Bootstrap - 应用启动时初始化认证状态
   */
  const bootstrap = useCallback(async () => {
    const token = tokenStorage.getToken();

    if (!token) {
      setAuthState({
        status: 'guest',
        user: null,
        profile: null,
        token: null,
      });
      return;
    }

    try {
      // 尝试获取用户信息
      const { user, profile } = await authApi.getCurrentUser();

      setAuthState({
        status: 'authed',
        user,
        profile,
        token,
      });
    } catch (error) {
      console.error('Bootstrap failed:', error);

      // Token 无效，清除并设置为 guest
      tokenStorage.clearToken();
      setAuthState({
        status: 'guest',
        user: null,
        profile: null,
        token: null,
      });
    }
  }, []);

  /**
   * 登录
   */
  const login = useCallback(async (data: LoginRequest) => {
    try {
      const response = await authApi.login(data);

      setAuthState({
        status: 'authed',
        user: response.user,
        profile: response.initialProfile || null,
        token: response.token,
      });

      return response;
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * 注册
   */
  const register = useCallback(async (data: RegisterRequest) => {
    try {
      const response = await authApi.register(data);

      setAuthState({
        status: 'authed',
        user: response.user,
        profile: response.initialProfile || null,
        token: response.token,
      });

      return response;
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * 登出
   */
  const logout = useCallback(() => {
    authApi.logout();

    setAuthState({
      status: 'guest',
      user: null,
      profile: null,
      token: null,
    });
  }, []);

  /**
   * 更新用户画像
   */
  const updateProfile = useCallback((profile: UserProfile) => {
    setAuthState((prev) => ({
      ...prev,
      profile,
    }));
  }, []);

  /**
   * 设置完整认证状态（用于兼容旧代码）
   */
  const setAuthData = useCallback((user: User, token: string, profile?: UserProfile) => {
    tokenStorage.setToken(token);

    setAuthState({
      status: 'authed',
      user,
      profile: profile || null,
      token,
    });
  }, []);

  return {
    authState,
    bootstrap,
    login,
    register,
    logout,
    updateProfile,
    setAuthData,
  };
}
