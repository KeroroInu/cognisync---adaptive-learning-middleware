/**
 * PublicOnly - 路由守卫：仅允许未认证用户访问
 * 已登录用户访问公开路由（如登录、注册页）时，自动跳转到应用首页
 */

import React, { useEffect } from 'react';
import { useAuth } from '../features/auth/hooks';

export interface PublicOnlyProps {
  children: React.ReactNode;
  onAuthorized: () => void;
}

export const PublicOnly: React.FC<PublicOnlyProps> = ({ children, onAuthorized }) => {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'authed') {
      onAuthorized();
    }
  }, [status, onAuthorized]);

  // 已登录时不渲染子组件
  if (status === 'authed') {
    return null;
  }

  return <>{children}</>;
};
