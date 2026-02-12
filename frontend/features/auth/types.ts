/**
 * Auth Types - 认证相关类型定义
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
}

export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  mode: 'scale' | 'ai';
}

export interface AuthResponse {
  token: string;
  user: User;
  initialProfile?: UserProfile;
}

export type AuthStatus = 'unknown' | 'authed' | 'guest';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  token: string | null;
}
