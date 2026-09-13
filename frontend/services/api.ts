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
  ScaleListItem,
  ScaleSubmitRequest,
  ScaleSubmitResponse,
  AIOnboardingStartResponse,
  AIOnboardingStepRequest,
  AIOnboardingStepResponse,
  AIOnboardingFinishResponse,
  ResearchTask,
  EmotionDetail,
  ProjectScaffoldMetadata,
  FunctionCoverageResponse,
  FunctionMappingSuggestionResponse,
} from '@/types';
import { classroomFetch as fetch } from './classroom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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
  currentCode?: string;
  taskPrompt?: string;
  scaffoldContext?: Omit<ProjectScaffoldMetadata, 'profileSnapshot'>;
}

export interface ChatAnalysis {
  intent: string;
  emotion: string;
  emotionDetail?: EmotionDetail;
  detectedConcepts: string[];
  delta: {
    cognition: number;
    affect: number;
    behavior: number;
  };
}

/**
 * 本轮实际生效的支架边界。
 *
 * 只有走项目工坊支架链路的回合才有值。除建构阶段已确认的 L3 例外外，
 * 教师蓝图仍可压低请求等级；界面必须按 appliedLevel 显示，避免感知等级与实际不符。
 */
export interface ChatScaffoldInfo {
  requestedLevel: number;
  appliedLevel: number;
  wasClamped: boolean;
  policySource: string;
  coreImplementationMaxLevel: number;
}

export interface ChatResponse {
  message: string;
  analysis: ChatAnalysis;
  updatedProfile: UserProfile;
  scaffold?: ChatScaffoldInfo | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface ProfileChangesResponse {
  changes: ProfileChange[];
}

export class ChatRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ChatRequestError';
  }
}

/**
 * 调用聊天接口
 */
export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const unavailable = request.language === 'zh'
    ? 'AI 暂时没有连上，请稍后重试。'
    : 'AI is temporarily unavailable. Please try again shortly.';
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      // A proxy may return HTML; the model queue returns structured detail.
      // Neither should become a JSON error or "[object Object]" in the chat.
      const error = parseAuthError(await response.json().catch(() => null), response.status);
      const queueMessages: Record<string, string> = request.language === 'zh'
        ? { AI_BUSY: '提问较多，请稍后再试。', AI_QUEUE_TIMEOUT: '等待 AI 超时，请稍后再试。' }
        : { AI_BUSY: 'AI is busy. Please try again shortly.', AI_QUEUE_TIMEOUT: 'The wait for AI timed out. Please try again shortly.' };
      const message = (error.code && queueMessages[error.code])
        || (response.status >= 500 ? unavailable : error.message);
      throw new ChatRequestError(message, response.status, error.code);
    }

    const result: ApiResponse<ChatResponse> | null = await response.json().catch(() => null);

    if (!result?.success || !result.data) {
      throw new ChatRequestError(unavailable, response.status, 'INVALID_RESPONSE');
    }

    return result.data;
  } catch (error) {
    // No automatic POST retry: a lost response does not prove that the model
    // request failed. ClassroomError must retain its closure semantics.
    if (error instanceof TypeError) {
      throw new ChatRequestError(request.language === 'zh'
        ? '网络没有连上，请检查连接后重试。'
        : 'Unable to connect. Check your network and try again.', 0, 'NETWORK_ERROR');
    }
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
 * 认证接口抛出的错误。`code` 来自后端结构化 detail，供 UI 分支使用
 * （例如「注册未完成」要给出去登录的入口，而不是让学生反复重填）。
 */
export class AuthError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 从 FastAPI 的错误响应里稳妥地取出可读信息与错误码。
 *
 * `detail` 有三种形态，此前代码一律写成 `throw new Error(result.detail)`：
 * 字符串没问题，但结构化对象会被字符串化成 `[object Object]` 直接怼到用户脸上，
 * Pydantic 的校验错误数组同样如此。三种都要处理。
 */
function parseAuthError(result: unknown, status: number): AuthError {
  const detail = (result as { detail?: unknown } | null)?.detail;

  if (typeof detail === 'string' && detail.trim()) {
    return new AuthError(detail, status);
  }

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const obj = detail as { message?: unknown; code?: unknown };
    const message = typeof obj.message === 'string' && obj.message.trim()
      ? obj.message
      : `请求失败（${status}）`;
    return new AuthError(message, status, typeof obj.code === 'string' ? obj.code : undefined);
  }

  // Pydantic 422：detail 是 [{loc, msg, type}, ...]
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: unknown };
    if (typeof first?.msg === 'string') return new AuthError(first.msg, status);
  }

  const fallback = (result as { error?: { message?: string } } | null)?.error?.message;
  return new AuthError(fallback || `请求失败（${status}）`, status);
}

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
      throw parseAuthError(result, response.status);
    }

    // 注意：token 的存储由调用方通过 setAuth() 统一处理，这里不存储

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
      throw parseAuthError(result, response.status);
    }

    // 注意：token 的存储由调用方通过 setAuth() 统一处理，这里不存储

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
 * 量表模式专用组合注册：原子性完成账号创建 + 量表提交
 * 只有量表答案成功提交后账号才真正入库
 */
export async function registerWithScale(data: {
  student_id: string;
  name: string;
  email?: string;
  password: string;
  template_id: string;
  answers: Record<string, number>;
  started_at?: string;
  className?: string;
}): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/register-with-scale`, {
      method: 'POST',
      headers: getHeaders(false),
      body: JSON.stringify({ ...data, mode: 'scale' }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw parseAuthError(result, response.status);
    }
    return { success: true, data: result } as AuthResponse;
  } catch (error) {
    console.error('Register with scale failed:', error);
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
      const error = new Error(`HTTP error! status: ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to fetch user data');
    }

    return result.data;
  } catch (error) {
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

export type CalibrationDimension = 'cognition' | 'affect' | 'behavior';

export interface CalibrationEntry {
  dimension: CalibrationDimension;
  systemValue: number;
  userValue: number;
  userComment?: string;
  likertTrust?: number;
}

/**
 * 上报一次自我校准（单个维度）。
 *
 * 身份由 JWT 决定，不传 userId：后端 `record_calibration` 用的是
 * `current_user.id`，客户端传什么都不会生效。
 *
 * 冲突等级（low/medium/high）由后端按 |系统值 − 自评值| 计算，前端不重复实现，
 * 避免两处阈值日后走样。
 */
export async function postCalibration(entry: CalibrationEntry): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/calibration`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({
      dimension: entry.dimension,
      // 后端限定 0–100 的整数，画像是浮点数，这里必须取整并夹紧，
      // 否则一个 100.4 会让整条记录被 422 拒掉。
      systemValue: clampScore(entry.systemValue),
      userValue: clampScore(entry.userValue),
      userComment: entry.userComment,
      likertTrust: entry.likertTrust,
    }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

async function readErrorDetail(response: Response): Promise<unknown> {
  try {
    const payload = await response.json();
    return payload?.detail ?? payload;
  } catch {
    // 响应体不是 JSON（例如网关返回的 HTML 错误页）。
    return null;
  }
}


// ============================================
//  知识图谱 & 问候 API
// ============================================

/**
 * 获取用户知识图谱
 */
export async function getKnowledgeGraph(userId: string): Promise<{ nodes: any[]; edges: any[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/knowledge-graph/${userId}`, {
      method: 'GET',
      headers: getHeaders(true),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to fetch knowledge graph');
    }

    const data = result.data || {};
    return { nodes: data.nodes || [], edges: data.edges || [] };
  } catch (error) {
    console.error('Failed to get knowledge graph:', error);
    return { nodes: [], edges: [] };
  }
}

/**
 * 获取个性化开场问候语
 */
export async function getChatGreeting(
  language: 'zh' | 'en' = 'zh'
): Promise<{ message: string; hasContext: boolean }> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/chat/greeting?language=${language}`,
      { method: 'GET', headers: getHeaders(true) }
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();
    return result.data || { message: '你好！我是你的学习伙伴。', hasContext: false };
  } catch (error) {
    console.error('Failed to get chat greeting:', error);
    return {
      message: language === 'zh' ? '你好！我是你的学习伙伴，有什么可以帮你的吗？' : 'Hello! How can I help you today?',
      hasContext: false,
    };
  }
}

export interface ChatSession {
  sessionStart: string;
  sessionEnd: string;
  title: string;
  preview: string;
  messageCount: number;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

/**
 * 获取用户历史对话会话列表
 */
export async function getChatSessions(): Promise<ChatSession[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/chat/sessions`,
      { method: 'GET', headers: getHeaders(true) }
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return result.data?.sessions || [];
  } catch (error) {
    console.error('Failed to get chat sessions:', error);
    return [];
  }
}

/**
 * 获取特定会话的消息记录
 */
export async function getSessionMessages(
  sessionStart: string,
  sessionEnd: string
): Promise<SessionMessage[]> {
  try {
    const params = new URLSearchParams({
      sessionStart,
      sessionEnd,
    });
    const response = await fetch(
      `${API_BASE_URL}/api/chat/sessions/messages?${params.toString()}`,
      { method: 'GET', headers: getHeaders(true) }
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return result.data?.messages || [];
  } catch (error) {
    console.error('Failed to get session messages:', error);
    return [];
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

// ============================================
//  研究任务 API
// ============================================

/**
 * 获取当前激活的研究任务（无任务返回 null）
 */
export async function getActiveResearchTask(): Promise<ResearchTask | null> {
  const response = await fetch(`${API_BASE_URL}/api/research/active-task`, {
    headers: getHeaders(true),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const result = await response.json();
  return (result.data ?? result) as ResearchTask;
}

/**
 * 自动保存学生代码进度
 */
export async function saveResearchProgress(
  taskId: string,
  code: string,
  startedAt?: string,
  options?: { keepalive?: boolean }
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/save-progress`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({ code_submitted: code, started_at: startedAt }),
    keepalive: options?.keepalive,
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
}

/**
 * 保存项目解构工作台：观察、功能、关系、路径与模块代码。
 */
export async function saveResearchWorkspace(
  taskId: string,
  workspaceData: Record<string, unknown>,
  options?: { keepalive?: boolean },
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/save-workspace`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({ workspace_data: workspaceData }),
    keepalive: options?.keepalive,
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
}

// ── 关键教学事件 ─────────────────────────────────────────────────────────────

export interface StageArtifactRequestPayload {
  artifact_type: string;
  artifact_key: string;
  content: Record<string, unknown>;
  change_source?: string;
  change_reason?: string;
}

export interface StageEventRequestBody {
  /** 幂等键。必须在同一次关键时刻的所有重试中保持不变，见 services/stageEvents.ts。 */
  request_id: string;
  stage: string;
  event_type: string;
  detail?: Record<string, unknown>;
  artifacts?: StageArtifactRequestPayload[];
}

export interface StageEventResponse {
  event_id: string;
  stage: string;
  event_type: string;
  blueprint_version_id: string | null;
  artifacts: Array<{
    artifact_id: string;
    artifact_type: string;
    artifact_key: string;
    version: number;
    version_created: boolean;
  }>;
  replayed: boolean;
}

export interface FinalSubmitRequestBody {
  /** 同一次最终提交的所有自动/手动重试必须复用此 ID。 */
  request_id: string;
  stage: 'build' | 'transfer' | 'reflect';
  code_submitted: string;
  started_at?: string;
  detail?: Record<string, unknown>;
  artifacts?: StageArtifactRequestPayload[];
}

export interface FinalSubmitResponse {
  event_id: string;
  stage: string;
  blueprint_version_id: string | null;
  artifacts: StageEventResponse['artifacts'];
  completed: boolean;
  submitted_at: string | null;
  replayed: boolean;
}

/** 携带状态码与结构化 detail 的接口错误，供上层区分 409/422/413 等终态。 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `HTTP error! status: ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 上报一次关键教学事件。
 *
 * 直接抛 `ApiError` 而不是笼统的 `Error`：调用方需要区分「可重试的网络故障」
 * 与「重试也没用的 409/422」。重试逻辑在 services/stageEvents.ts 中。
 */
export async function postStageEvent(
  taskId: string,
  body: StageEventRequestBody,
  options?: { keepalive?: boolean },
): Promise<StageEventResponse> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/stage-events`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify(body),
    keepalive: options?.keepalive,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }

  const result = await response.json();
  return (result.data ?? result) as StageEventResponse;
}

/**
 * 原子地写入最终产物版本、final_submit 事件和完成状态。
 *
 * 这三项不能拆成多个前端请求，否则任何一次断网都会留下
 * “已完成但没有证据”或“有提交事件但任务未完成”的半成品。
 */
export async function postFinalResearchSubmission(
  taskId: string,
  body: FinalSubmitRequestBody,
): Promise<FinalSubmitResponse> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/final-submit`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }

  const result = await response.json();
  return (result.data ?? result) as FinalSubmitResponse;
}

/**
 * 根据学生自己的功能卡表达，读取冻结蓝图中的安全契约建议。
 * 教师同义词、标准依赖、隐藏测试与函数模板不下发。
 */
export async function suggestResearchFunctionMapping(
  taskId: string,
  card: {
    observation_text: string;
    responsibility: string;
    boundary_reason: string;
    input_text: string;
    output_text: string;
    knowledge: string[];
  },
): Promise<FunctionMappingSuggestionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/blueprint/function-mapping-suggestions`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify(card),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const result = await response.json();
  return (result.data ?? result) as FunctionMappingSuggestionResponse;
}

/**
 * 检查学生的功能卡是否覆盖教师蓝图中的必做基础功能。
 * 只回传数量与简短问题，不下发契约名称、同义表达或隐藏测试。
 */
export async function checkResearchFunctionCoverage(
  taskId: string,
  payload: {
    cards: {
      card_id: string;
      responsibility: string;
      implementation: string;
      observation_text: string;
    }[];
    unreferenced_observation_count: number;
  },
): Promise<FunctionCoverageResponse> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/blueprint/function-coverage`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const result = await response.json();
  return (result.data ?? result) as FunctionCoverageResponse;
}

/**
 * 标记任务完成并保存最终代码
 */
export async function completeResearchTask(taskId: string, code: string, startedAt?: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({ code_submitted: code, started_at: startedAt }),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
}

export async function reopenResearchTask(taskId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/research/tasks/${taskId}/reopen`, {
    method: 'POST',
    headers: getHeaders(true),
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
}

// ============================================
//  量表列表 API（用户已登录后使用）
// ============================================

/**
 * 获取所有激活的量表，包含当前用户的完成状态
 */
export async function getAllActiveScales(): Promise<ScaleListItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/forms/list`, {
    headers: getHeaders(true),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const result = await response.json();
  return (result.data?.templates ?? []) as ScaleListItem[];
}

/**
 * 按 ID 获取量表模板（供用户端填写）
 */
export async function getScaleTemplateById(templateId: string): Promise<ScaleTemplate> {
  const response = await fetch(`${API_BASE_URL}/api/forms/templates/${templateId}`, {
    headers: getHeaders(false),
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const result = await response.json();
  return result.data.template as ScaleTemplate;
}
