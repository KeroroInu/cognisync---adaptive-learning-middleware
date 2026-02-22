/**
 * API Service - 后端 API 调用
 */

import type {
  User,
  UserProfile,
  ProfileChange,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  ScaleTemplate,
  ScaleSubmitRequest,
  ScaleSubmitResponse,
  AIOnboardingStartResponse,
  AIOnboardingStepRequest,
  AIOnboardingStepResponse,
  AIOnboardingFinishResponse,
} from '@/types';

const API_BASE_URL = 'http://localhost:8000';

// 获取存储的 token
function getAuthToken(): string | null {
  return localStorage.getItem('cognisync-token');
}

// 统一请求头
function getHeaders(includeAuth = true): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (includeAuth) {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
}

export interface ChatRequest {
  userId: string;
  message: string;
  language: 'zh' | 'en';
  isResearchMode: boolean;
}

export interface ChatAnalysis {
  intent: string;
  emotion: string;
  detectedConcepts: string[];
  delta: {
    cognition: number;
    affect: number;
    behavior: number;
  };
}

export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface ChatResponse {
  message: string;
  analysis: ChatAnalysis;
  updatedProfile: UserProfile;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface ProfileChangesResponse {
  changes: ProfileChange[];
}

/**
 * 调用聊天接口
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    const result: ApiResponse<ChatResponse> = await response.json();

    if (!result.success) {
      throw new Error('API returned unsuccessful response');
    }

    return result.data;
  } catch (error) {
    console.error('Failed to send chat message:', error);
    throw error;
  }
}

/**
 * 健康检查
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

// ============================================
//  认证 API
// ============================================

/**
 * 用户登录
 */
export async function login(credentials: LoginRequest): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: getHeaders(false),  // 登录请求不需要token
      body: JSON.stringify(credentials),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || result.error?.message || `HTTP error! status: ${response.status}`);
    }

    // 后端直接返回 {token, user} 格式
    // 存储 token
    if (result.token) {
      localStorage.setItem('cognisync-token', result.token);
    }

    // 兼容旧格式，包装成 {success, data}
    return {
      success: true,
      data: result
    } as AuthResponse;
  } catch (error) {
    console.error('Login failed:', error);
    throw error;
  }
}

/**
 * 用户注册
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: getHeaders(false),  // 注册请求不需要token
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || result.error?.message || `HTTP error! status: ${response.status}`);
    }

    // 后端直接返回 {token, user} 格式
    // 存储 token
    if (result.token) {
      localStorage.setItem('cognisync-token', result.token);
    }

    // 兼容旧格式，包装成 {success, data}
    return {
      success: true,
      data: result
    } as AuthResponse;
  } catch (error) {
    console.error('Registration failed:', error);
    throw error;
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<{ user: User; profile: UserProfile }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: getHeaders(true),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to fetch user data');
    }

    return result.data;
  } catch (error) {
    console.error('Failed to get current user:', error);
    throw error;
  }
}

/**
 * 登出
 */
export function logout(): void {
  localStorage.removeItem('cognisync-token');
}

/**
 * 获取用户画像的最近变化
 */
export async function getRecentChanges(userId: string, limit: number = 5): Promise<ApiResponse<ProfileChangesResponse>> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/profile/${userId}/recent-changes?limit=${limit}`, {
      method: 'GET',
      headers: getHeaders(true),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: ApiResponse<ProfileChangesResponse> = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to fetch recent changes');
    }

    return result;
  } catch (error) {
    console.error('Failed to get recent changes:', error);
    throw error;
  }
}


// ============================================
//  量表注册 API
// ============================================

/**
 * 获取激活的量表模板
 */
export async function getActiveScaleTemplate(): Promise<ScaleTemplate> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/forms/active`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to fetch scale template');
    }

    return result.data.template;
  } catch (error) {
    console.error('Failed to get scale template:', error);
    throw error;
  }
}

/**
 * 提交量表答案
 */
export async function submitScaleAnswers(
  templateId: string,
  data: ScaleSubmitRequest
): Promise<ScaleSubmitResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/forms/${templateId}/submit`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(data),
    });

    const result: ScaleSubmitResponse = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || `HTTP error! status: ${response.status}`);
    }

    return result;
  } catch (error) {
    console.error('Failed to submit scale answers:', error);
    throw error;
  }
}

// ============================================
//  AI 引导注册 API
// ============================================

/**
 * 开始 AI 引导注册
 */
export async function startAIOnboarding(): Promise<AIOnboardingStartResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/ai/start`, {
      method: 'POST',
      headers: getHeaders(true),
    });

    const result: AIOnboardingStartResponse = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || `HTTP error! status: ${response.status}`);
    }

    return result;
  } catch (error) {
    console.error('Failed to start AI onboarding:', error);
    throw error;
  }
}

/**
 * AI 引导注册 - 回答问题
 */
export async function stepAIOnboarding(
  data: AIOnboardingStepRequest
): Promise<AIOnboardingStepResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/ai/step`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(data),
    });

    const result: AIOnboardingStepResponse = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || `HTTP error! status: ${response.status}`);
    }

    return result;
  } catch (error) {
    console.error('Failed to step AI onboarding:', error);
    throw error;
  }
}

/**
 * AI 引导注册 - 完成
 */
export async function finishAIOnboarding(sessionId: string): Promise<AIOnboardingFinishResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/onboarding/ai/finish`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({ sessionId }),
    });

    const result: AIOnboardingFinishResponse = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || `HTTP error! status: ${response.status}`);
    }

    return result;
  } catch (error) {
    console.error('Failed to finish AI onboarding:', error);
    throw error;
  }
}
