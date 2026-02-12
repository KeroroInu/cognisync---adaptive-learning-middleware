import { apiClient } from '../../lib/apiClient';
import {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  User,
  UserProfile,
} from './types';

/**
 * 用户登录
 */
export async function login(data: LoginRequest): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/api/auth/login', data);
}

/**
 * 用户注册
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/api/auth/register', data);
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<{ user: User; profile: UserProfile }> {
  return apiClient.get<{ user: User; profile: UserProfile }>('/api/auth/me');
}

/**
 * 登出（清除本地 token）
 */
export function logout(): void {
  apiClient.setAuthToken(null);
}
