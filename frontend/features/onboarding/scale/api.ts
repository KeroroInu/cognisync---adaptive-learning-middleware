/**
 * Scale Onboarding API
 * 量表注册流程 API 调用
 */

import { apiClient } from '../../../lib/apiClient';
import type {
  ScaleTemplate,
  ScaleSubmitRequest,
  ScaleSubmitResponse,
  ScaleApiError,
} from './types';

/**
 * 获取当前激活的量表模板
 * GET /api/forms/active
 */
export async function getActiveTemplate(): Promise<ScaleTemplate> {
  try {
    const response = await apiClient.get<ScaleTemplate>('/api/forms/active');
    return response;
  } catch (error: any) {
    // 处理特定错误
    if (error.code === 'NO_ACTIVE_TEMPLATE') {
      throw new ScaleError(
        'NO_ACTIVE_TEMPLATE',
        '当前没有激活的量表模板',
        error
      );
    }

    throw new ScaleError(
      'FETCH_TEMPLATE_FAILED',
      '获取量表模板失败，请稍后重试',
      error
    );
  }
}

/**
 * 提交量表答案
 * POST /api/forms/{templateId}/submit
 *
 * @param templateId - 量表模板 ID
 * @param answers - 用户答案
 * @returns 得分和初始画像
 */
export async function submitScaleAnswers(
  templateId: string,
  data: ScaleSubmitRequest
): Promise<ScaleSubmitResponse> {
  try {
    const response = await apiClient.post<ScaleSubmitResponse>(
      `/api/forms/${templateId}/submit`,
      data
    );

    return response;
  } catch (error: any) {
    // 处理特定错误
    if (error.code === 'INVALID_ANSWERS') {
      throw new ScaleError(
        'INVALID_ANSWERS',
        '答案格式不正确，请检查后重试',
        error
      );
    }

    if (error.code === 'TEMPLATE_NOT_FOUND') {
      throw new ScaleError(
        'TEMPLATE_NOT_FOUND',
        '量表模板不存在',
        error
      );
    }

    throw new ScaleError(
      'SUBMIT_FAILED',
      '提交失败，请稍后重试',
      error
    );
  }
}

/**
 * 自定义错误类
 */
export class ScaleError extends Error {
  code: string;
  details?: any;

  constructor(code: string, message: string, details?: any) {
    super(message);
    this.name = 'ScaleError';
    this.code = code;
    this.details = details;
  }
}
