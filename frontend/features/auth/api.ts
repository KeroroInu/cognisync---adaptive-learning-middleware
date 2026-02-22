/**
 * Auth API - 认证相关 API 调用
 */

import { apiClient } from '../../lib/apiClient';
import { tokenStorage } from '../../lib/tokenStorage';
import type { LoginRequest, RegisterRequest, AuthResponse, User, UserProfile } from './types';

/**
 * 用户登录
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/api/auth/login', data, {
    skipAuth: true, // 登录请求不需要 token
  });

  // 登录成功，存储 token（仅在有有效 token 时）
  if (response && response.token) {
    tokenStorage.setToken(response.token);
  } else {
    throw new Error('Invalid login response: missing token');
  }

  return response;
}

/**
 * 用户注册
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/api/auth/register', data, {
    skipAuth: true, // 注册请求不需要 token
  });

  // 注册成功，存储 token（仅在有有效 token 时）
  if (response && response.token) {
    tokenStorage.setToken(response.token);
  } else {
    throw new Error('Invalid registration response: missing token');
  }

  return response;
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<{ user: User; profile: UserProfile }> {
  return apiClient.get<{ user: User; profile: UserProfile }>('/api/auth/me');
}

/**
 * 登出
 */
export function logout(): void {
  tokenStorage.clearToken();
}
