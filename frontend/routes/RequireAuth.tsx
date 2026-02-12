/**
 * RequireAuth - 路由守卫：要求已认证
 * 未登录用户访问受保护路由时，自动跳转到登录页
 */

import React, { useEffect } from 'react';
import { useAuth } from '../features/auth/hooks';

export interface RequireAuthProps {
  children: React.ReactNode;
  onUnauthorized: () => void;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children, onUnauthorized }) => {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'guest') {
      onUnauthorized();
    }
  }, [status, onUnauthorized]);

  // 加载中或未登录时不渲染子组件
  if (status !== 'authed') {
    return null;
  }

  return <>{children}</>;
};
