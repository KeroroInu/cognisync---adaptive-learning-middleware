/**
 * API Service - 后端 API 调用
 */

const API_BASE_URL = 'http://localhost:8000';

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
