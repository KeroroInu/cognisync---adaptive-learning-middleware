/**
 * API Client - 统一 HTTP 请求客户端
 * 自动处理认证、响应格式、错误处理
 */

import { tokenStorage } from './tokenStorage';

// API 基础 URL（从环境变量读取）
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// 标准响应格式
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// 请求配置
export interface RequestConfig extends Omit<RequestInit, 'body'> {
  skipAuth?: boolean; // 是否跳过自动添加 Authorization 头
  skipErrorHandling?: boolean; // 是否跳过统一错误处理
}

// API 错误类
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string = 'UNKNOWN_ERROR',
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 防止 401 重定向死循环
let isRedirecting = false;

/**
 * 统一请求方法
 */
async function request<T = any>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<T> {
  const { skipAuth = false, skipErrorHandling = false, ...fetchConfig } = config;

  // 构建完整 URL
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  // 构建请求头
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(fetchConfig.headers || {}),
  };

  // 自动添加 Authorization 头
  if (!skipAuth) {
    const token = tokenStorage.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchConfig,
      headers,
    });

    // 处理 401 Unauthorized
    if (response.status === 401 && !skipErrorHandling && !isRedirecting) {
      isRedirecting = true;
      tokenStorage.clearToken();

      // 触发全局事件通知应用
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));

      // 延迟重置标志，避免多个并发请求重复重定向
      setTimeout(() => {
        isRedirecting = false;
      }, 1000);

      throw new ApiError('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // 解析 JSON 响应
    const data: ApiResponse<T> = await response.json();

    // 检查业务层面的成功状态
    if (!response.ok || !data.success) {
      throw new ApiError(
        data.error?.message || `HTTP error! status: ${response.status}`,
        data.error?.code || 'REQUEST_FAILED',
        response.status,
        data.error?.details
      );
    }

    return data.data as T;
  } catch (error) {
    // 如果已经是 ApiError，直接抛出
    if (error instanceof ApiError) {
      throw error;
    }

    // 网络错误或其他异常
    console.error('API request failed:', error);
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error',
      'NETWORK_ERROR'
    );
  }
}

/**
 * GET 请求
 */
export function get<T = any>(endpoint: string, config?: RequestConfig): Promise<T> {
  return request<T>(endpoint, { ...config, method: 'GET' });
}

/**
 * POST 请求
 */
export function post<T = any>(
  endpoint: string,
  data?: unknown,
  config?: RequestConfig
): Promise<T> {
  return request<T>(endpoint, {
    ...config,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * PUT 请求
 */
export function put<T = any>(
  endpoint: string,
  data?: unknown,
  config?: RequestConfig
): Promise<T> {
  return request<T>(endpoint, {
    ...config,
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * PATCH 请求
 */
export function patch<T = any>(
  endpoint: string,
  data?: unknown,
  config?: RequestConfig
): Promise<T> {
  return request<T>(endpoint, {
    ...config,
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * DELETE 请求
 */
export function del<T = any>(endpoint: string, config?: RequestConfig): Promise<T> {
  return request<T>(endpoint, { ...config, method: 'DELETE' });
}

/**
 * 导出统一的 API 客户端对象
 */
export const apiClient = {
  get,
  post,
  put,
  patch,
  delete: del,
  BASE_URL,
};
