/**
 * API 客户端
 * 用于用户认证和业务 API 调用
 */

export const resolveApiBaseUrl = (
  _isProduction: boolean,
  _configuredUrl?: string,
): string => {
  // 管理端始终走同源 /api。开发环境的后端地址由 Vite 代理控制，
  // 避免本机 .env 中的绝对 URL 绕过代理并触发 CORS 配置漂移。
  return '/api';
};

const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env.PROD,
  import.meta.env.VITE_API_BASE_URL,
);

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

function responseErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return;
  const payload = result as { detail?: unknown; error?: unknown };
  if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail;
  for (const value of [payload.detail, payload.error]) {
    if (value && typeof value === 'object' && 'message' in value
      && typeof value.message === 'string' && value.message.trim()) return value.message;
  }
}

class ApiClient {
  private getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  setAuthToken(token: string | null): void {
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options.headers) {
      Object.assign(headers, options.headers as Record<string, string>);
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });
    } catch {
      if (options.signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
      throw new Error('无法连接服务器，请检查网络后重试。');
    }

    if (response.status === 401) this.setAuthToken(null);

    // Only JSON decoding belongs in this catch. Business errors must escape it.
    let result: ApiResponse<T> | null = null;
    try { result = await response.json(); }
    catch { /* A reverse proxy may return an HTML error page. */ }
    const message = responseErrorMessage(result);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(message || (endpoint.endsWith('/login') ? '学号或密码错误，请检查后重试。' : '登录已过期，请重新登录。'));
      }
      if (response.status === 403) {
        throw new Error(message || '没有操作权限，请联系管理员。');
      }
      const fallback = response.status === 503 ? '服务暂时繁忙，请稍后再试。'
        : response.status >= 500 ? '服务器暂时无法响应，请稍后再试。' : '请求未完成，请检查后重试。';
      throw new Error(message || fallback);
    }

    if (!result || typeof result !== 'object') throw new Error('服务器响应异常，请刷新后重试。');
    if (!result.success) throw new Error(message || '操作未完成，请稍后再试。');

    return result.data;
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async patch<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
}

export const apiClient = new ApiClient();
