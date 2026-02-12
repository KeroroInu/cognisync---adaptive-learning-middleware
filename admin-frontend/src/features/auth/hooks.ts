import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from './authStore';
import { AuthStatus, User, UserProfile, LoginRequest } from './types';

interface UseAuthReturn {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  token: string | null;
  isAuthed: boolean;
  isGuest: boolean;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
}

/**
 * 认证状态 hook
 * 返回认证状态和方法
 */
export function useAuth(): UseAuthReturn {
  const { status, user, profile, token, login, logout, bootstrap } = useAuthContext();

  return {
    status,
    user,
    profile,
    token,
    isAuthed: status === 'authed',
    isGuest: status === 'guest',
    isLoading: status === 'unknown',
    login,
    logout,
    bootstrap,
  };
}

/**
 * 要求登录的 hook
 * 如果未登录，自动跳转到登录页
 *
 * @param redirectTo - 登录后跳转的路径，默认为当前路径
 * @returns 认证状态
 */
export function useRequireAuth(redirectTo?: string): UseAuthReturn {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // 如果状态未知，等待 bootstrap 完成
    if (auth.status === 'unknown') {
      return;
    }

    // 如果是访客（未登录），跳转到登录页
    if (auth.status === 'guest') {
      const currentPath = redirectTo || window.location.pathname;
      navigate(`/login?redirect=${encodeURIComponent(currentPath)}`, { replace: true });
    }
  }, [auth.status, navigate, redirectTo]);

  return auth;
}
