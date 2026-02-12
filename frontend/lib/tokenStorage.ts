/**
 * Token Storage - 抽象 Token 存储层
 * MVP 使用 localStorage，未来可切换为 httpOnly cookie
 */

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export const tokenStorage = {
  /**
   * 获取访问令牌
   */
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      console.error('Failed to get token:', error);
      return null;
    }
  },

  /**
   * 设置访问令牌
   */
  setToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      console.error('Failed to set token:', error);
    }
  },

  /**
   * 清除访问令牌
   */
  clearToken(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('Failed to clear token:', error);
    }
  },

  /**
   * 获取刷新令牌（预留）
   */
  getRefreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('Failed to get refresh token:', error);
      return null;
    }
  },

  /**
   * 设置刷新令牌（预留）
   */
  setRefreshToken(token: string): void {
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch (error) {
      console.error('Failed to set refresh token:', error);
    }
  },

  /**
   * 检查是否有有效 Token
   */
  hasToken(): boolean {
    return !!this.getToken();
  },
};
