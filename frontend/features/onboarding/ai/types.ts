/**
 * AI Onboarding Types
 * AI 引导注册流程类型定义
 */

/**
 * AI 对话消息
 */
export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

/**
 * 已确认的信息摘要
 */
export interface ConfirmedInfo {
  key: string; // 信息类型（如 "学习目标"、"擅长领域"）
  value: string; // 信息内容
  confidence?: number; // 置信度（0-1）
}

/**
 * 草稿画像（过程中可能返回）
 */
export interface DraftProfile {
  cognition?: number;
  affect?: number;
  behavior?: number;
}

/**
 * 初始画像（最终）
 */
export interface InitialProfile {
  cognition: number; // 0-100
  affect: number; // 0-100
  behavior: number; // 0-100
}

/**
 * 用户属性（细粒度信息）
 */
export interface UserAttributes {
  learningGoals?: string[]; // 学习目标
  strengths?: string[]; // 优势领域
  weaknesses?: string[]; // 待提升领域
  interests?: string[]; // 兴趣方向
  preferredStyle?: string; // 偏好学习方式
  background?: string; // 背景信息
  [key: string]: any; // 可扩展
}

/**
 * 概念种子（用于后续知识图谱构建）
 */
export interface ConceptSeed {
  concept: string; // 概念名称
  category: string; // 类别
  importance: number; // 重要性（0-1）
  relatedConcepts?: string[]; // 相关概念
}

/**
 * 开始对话响应
 */
export interface AiStartResponse {
  sessionId: string; // 会话 ID
  question: string; // 第一个问题
  summary: ConfirmedInfo[]; // 已确认信息（初始为空）
}

/**
 * 单步对话请求
 */
export interface AiStepRequest {
  sessionId: string;
  answer: string; // 用户回答
}

/**
 * 单步对话响应
 */
export interface AiStepResponse {
  question: string | null; // 下一个问题（null 表示结束）
  summary: ConfirmedInfo[]; // 更新的已确认信息
  draftProfile?: DraftProfile; // 草稿画像（可选）
  status?: 'ongoing' | 'done'; // 状态
}

/**
 * 完成对话请求
 */
export interface AiFinishRequest {
  sessionId: string;
}

/**
 * 完成对话响应
 */
export interface AiFinishResponse {
  initialProfile: InitialProfile; // 最终三维画像
  attributes: UserAttributes; // 用户属性
  conceptSeeds: ConceptSeed[]; // 概念种子
  sessionId: string;
}

/**
 * 页面状态
 */
export type AiOnboardingStatus =
  | 'initializing' // 初始化中（调用 start）
  | 'chatting' // 对话中
  | 'finishing' // 结束中（调用 finish）
  | 'completed' // 已完成
  | 'error'; // 错误

/**
 * API 错误
 */
export interface AiApiError {
  code: string;
  message: string;
  details?: any;
}
