/**
 * AI Onboarding API
 * AI 引导注册流程 API 调用
 */

import { apiClient } from '../../../lib/apiClient';
import type {
  AiStartResponse,
  AiStepRequest,
  AiStepResponse,
  AiFinishRequest,
  AiFinishResponse,
} from './types';

/**
 * 开始 AI 引导对话
 * POST /api/onboarding/ai/start
 */
export async function startAiOnboarding(): Promise<AiStartResponse> {
  try {
    const response = await apiClient.post<AiStartResponse>(
      '/api/onboarding/ai/start',
      {}
    );

    return response;
  } catch (error: any) {
    throw new AiOnboardingError(
      'START_FAILED',
      '启动 AI 引导失败，请稍后重试',
      error
    );
  }
}

/**
 * 提交单步回答
 * POST /api/onboarding/ai/step
 *
 * @param data - { sessionId, answer }
 * @returns 下一个问题和更新的摘要
 */
export async function stepAiOnboarding(
  data: AiStepRequest
): Promise<AiStepResponse> {
  try {
    const response = await apiClient.post<AiStepResponse>(
      '/api/onboarding/ai/step',
      data
    );

    return response;
  } catch (error: any) {
    if (error.code === 'INVALID_SESSION') {
      throw new AiOnboardingError(
        'INVALID_SESSION',
        '会话无效或已过期，请重新开始',
        error
      );
    }

    throw new AiOnboardingError(
      'STEP_FAILED',
      '提交回答失败，请稍后重试',
      error
    );
  }
}

/**
 * 完成 AI 引导，生成最终画像
 * POST /api/onboarding/ai/finish
 *
 * @param data - { sessionId }
 * @returns 最终画像、属性、概念种子
 */
export async function finishAiOnboarding(
  data: AiFinishRequest
): Promise<AiFinishResponse> {
  try {
    const response = await apiClient.post<AiFinishResponse>(
      '/api/onboarding/ai/finish',
      data
    );

    return response;
  } catch (error: any) {
    if (error.code === 'INVALID_SESSION') {
      throw new AiOnboardingError(
        'INVALID_SESSION',
        '会话无效或已过期',
        error
      );
    }

    if (error.code === 'INSUFFICIENT_DATA') {
      throw new AiOnboardingError(
        'INSUFFICIENT_DATA',
        '信息不足，无法生成画像',
        error
      );
    }

    throw new AiOnboardingError(
      'FINISH_FAILED',
      '完成引导失败，请稍后重试',
      error
    );
  }
}

/**
 * 自定义错误类
 */
export class AiOnboardingError extends Error {
  code: string;
  details?: any;

  constructor(code: string, message: string, details?: any) {
    super(message);
    this.name = 'AiOnboardingError';
    this.code = code;
    this.details = details;
  }
}
