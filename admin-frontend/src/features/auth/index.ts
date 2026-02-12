/**
 * 认证模块
 * 提供用户认证、登录、注册等功能
 */

// 类型定义
export type {
  User,
  UserProfile,
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  AuthStatus,
  AuthState,
} from './types';

// API 方法
export { login, register, getCurrentUser, logout } from './api';

// 状态管理
export {
  AuthProvider,
  useAuthContext,
  updateProfileGlobal as updateProfile,
  registerProfileUpdateCallback,
} from './authStore';

// Hooks
export { useAuth, useRequireAuth } from './hooks';
