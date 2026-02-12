/**
 * Scale Onboarding Types
 * 量表注册流程类型定义
 */

/**
 * Likert 选项（1-5）
 */
export type LikertValue = 1 | 2 | 3 | 4 | 5;

/**
 * Likert 选项标签
 */
export interface LikertOption {
  value: LikertValue;
  label: string;
}

/**
 * 题目类型
 */
export interface ScaleItem {
  id: string;
  text: string;
  subscale?: string; // 可选：所属分量表
  required?: boolean; // 是否必填（默认 true）
  reversed?: boolean; // 是否反向计分
}

/**
 * 分量表定义
 */
export interface Subscale {
  id: string;
  name: string;
  description?: string;
  itemIds: string[]; // 包含的题目 ID
}

/**
 * 量表模板 Schema
 */
export interface ScaleTemplateSchema {
  title: string;
  description?: string;
  items: ScaleItem[];
  subscales?: Subscale[]; // 可选：分量表分组
  likertOptions: LikertOption[]; // Likert 选项（通常 1-5）
}

/**
 * 量表模板（从后端返回）
 */
export interface ScaleTemplate {
  id: string;
  name: string;
  description: string;
  schema_json: ScaleTemplateSchema;
  version: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 用户答案（提交格式）
 */
export interface ScaleAnswers {
  [itemId: string]: LikertValue;
}

/**
 * 提交请求
 */
export interface ScaleSubmitRequest {
  answers: ScaleAnswers;
}

/**
 * 分量表得分
 */
export interface SubscaleScore {
  subscaleId: string;
  subscaleName: string;
  score: number;
  maxScore: number;
  percentage: number;
}

/**
 * 初始画像（三维）
 */
export interface InitialProfile {
  cognition: number; // 0-100
  affect: number; // 0-100
  behavior: number; // 0-100
}

/**
 * 提交响应
 */
export interface ScaleSubmitResponse {
  success: boolean;
  scores: SubscaleScore[]; // 各分量表得分
  totalScore: number; // 总分
  maxScore: number; // 满分
  initialProfile: InitialProfile; // 初始三维画像
  responseId: string; // 提交记录 ID
}

/**
 * API 错误
 */
export interface ScaleApiError {
  code: string;
  message: string;
  details?: any;
}

/**
 * 页面状态
 */
export type OnboardingStatus =
  | 'loading'       // 加载模板中
  | 'filling'       // 填写中
  | 'submitting'    // 提交中
  | 'completed'     // 已完成
  | 'error';        // 错误

/**
 * 表单验证错误
 */
export interface ValidationError {
  itemId: string;
  message: string;
}
