/**
 * Auth Hooks - 认证相关 React Hooks
 */

import { useEffect } from 'react';
import { useAuthStore } from './authStore';
import type { AuthState } from './types';

// 全局认证 Store 实例（单例模式）
let globalAuthStore: ReturnType<typeof useAuthStore> | null = null;

/**
 * 获取全局认证 Store
 * 注意：需要在应用顶层初始化
 */
export function getAuthStore() {
  if (!globalAuthStore) {
    throw new Error('Auth store not initialized. Call initAuthStore() first.');
  }
  return globalAuthStore;
}

/**
 * 初始化全局认证 Store（在 App 组件中调用）
 */
export function initAuthStore(store: ReturnType<typeof useAuthStore>) {
  globalAuthStore = store;
}

/**
 * useAuth - 获取认证状态和方法
 */
export function useAuth() {
  if (!globalAuthStore) {
    throw new Error('Auth store not initialized. Wrap your app with AuthProvider.');
  }

  return {
    ...globalAuthStore.authState,
    login: globalAuthStore.login,
    register: globalAuthStore.register,
    logout: globalAuthStore.logout,
    updateProfile: globalAuthStore.updateProfile,
    bootstrap: globalAuthStore.bootstrap,
    isAuthed: globalAuthStore.authState.status === 'authed',
    isGuest: globalAuthStore.authState.status === 'guest',
    isLoading: globalAuthStore.authState.status === 'unknown',
  };
}

/**
 * useRequireAuth - 要求认证的 Hook
 * 如果未登录，触发回调（通常用于跳转到登录页）
 */
export function useRequireAuth(onUnauthorized?: () => void) {
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === 'guest' && onUnauthorized) {
      onUnauthorized();
    }
  }, [auth.status, onUnauthorized]);

  return auth;
}
