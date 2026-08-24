export type Dimension = 'Cognition' | 'Affect' | 'Behavior' | 'CT' | 'SE' | 'LM' | 'CPS' | 'PA' | 'AIL' | string;
export type Language = 'zh' | 'en';

export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface EmotionDetail {
  code: string;
  name: string;
  intensity: 'low' | 'medium' | 'high';
  legacyEmotion?: string;
  confidence: number;
  arousal: number;
  valence: number;
  evidence?: string[];
}

export interface ProfileChange {
  dimension: string;
  change: number;
  timestamp: string;
  trend: 'up' | 'down' | 'stable';
  emotionDetail?: EmotionDetail;
}

export interface Node {
  id: string;
  name: string;
  mastery: number; // 0-100
  frequency: number; // 1-10 (size)
  description: string;
  category?: string; // domain/subject area
  x?: number;
  y?: number;
  isFlagged?: boolean; // If user has disputed it
}

export interface Edge {
  source: string;
  target: string;
  relType?: string; // "co_occurred" | "prerequisite" | "related"
  weight?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: {
    intent: string;
    emotion: string;
    emotionDetail?: EmotionDetail;
    detectedConcepts: string[];
    delta: Partial<UserProfile>;
    scaffoldContext?: ProjectScaffoldMetadata;
  };
}

export interface ProjectScaffoldMetadata {
  requestId: string;
  taskId: string;
  taskTitle?: string;
  stage: 'observe' | 'decompose' | 'model' | 'plan' | 'build';
  level: 0 | 1 | 2 | 3;
  trigger: 'hint_button' | 'student_message' | 'level_up' | 'minimum_completion' | 'l3_confirmed';
  l3Confirmed?: boolean;
  artifactSummary?: string;
  currentModule?: string;
  testFeedback?: string;
  profileSnapshot?: Pick<UserProfile, 'cognition' | 'affect' | 'behavior'>;
}

export interface CalibrationLog {
  id: string;
  timestamp: string;
  type: 'Profile' | 'Node';
  targetId?: string; // Node ID if type is Node
  modelValue: number | UserProfile;
  userValue: number | UserProfile;
  reason: string;
  disagreementIndex: number; // Absolute difference
  likertTrust?: number; // 1-5
}

export interface AppState {
  profile: UserProfile;
  nodes: Node[];
  edges: Edge[];
  messages: ChatMessage[];
  logs: CalibrationLog[];
  isResearchMode: boolean;
  language: Language;
  user: User | null;
  token: string | null;
}

// ============================================
//  认证相关类型
// ============================================

export interface User {
  id: string;
  student_id: string;
  email?: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
  onboardingMode?: 'scale' | 'ai';
  className?: string;
  experimentGroup: 'unassigned' | 'pdt' | 'ai_pbl' | 'lecture';
}

export interface AuthResponse {
  success: boolean;
  data?: {
    token: string;
    user: User;
    initialProfile?: UserProfile;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface LoginRequest {
  student_id: string;
  password: string;
}

export interface RegisterRequest {
  student_id: string;
  name: string;
  password: string;
  email?: string;
  mode: 'scale' | 'ai';
  className?: string;
}

// ============================================
//  量表注册相关类型
// ============================================

export interface ScaleQuestion {
  id: string;
  text: string;
  dimension: Dimension;
}

export interface ScaleTemplate {
  id: string;
  name: string;
  description: string;
  questions: ScaleQuestion[];
}

export interface ScaleAnswer {
  questionId: string;
  value: number; // 1-5 Likert
}

export interface ScaleSubmitRequest {
  answers: Record<string, number>; // {"item_1": 5, "item_2": 3, ...}
  started_at?: string;  // ISO 8601 字符串，开始填写时间
}

export interface ScaleSubmitResponse {
  success: boolean;
  data?: {
    scores: {
      cognition: number;
      affect: number;
      behavior: number;
    };
    initialProfile: UserProfile;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
//  AI 引导注册相关类型
// ============================================

export interface ConfirmedInfo {
  key: string;
  value: string;
  confidence?: number;
}

export interface AIOnboardingSession {
  sessionId: string;
  question: string;
  summary: ConfirmedInfo[];
  draftProfile?: Partial<UserProfile>;
  isComplete: boolean;
}

export interface AIOnboardingStartResponse {
  success: boolean;
  data?: {
    sessionId: string;
    question: string;
    summary: ConfirmedInfo[];
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface AIOnboardingStepRequest {
  sessionId: string;
  answer: string;
}

export interface AIOnboardingStepResponse {
  success: boolean;
  data?: {
    sessionId: string;
    question?: string;
    summary: ConfirmedInfo[];
    draftProfile?: Partial<UserProfile>;
    isComplete: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface AIOnboardingFinishResponse {
  success: boolean;
  data?: {
    initialProfile: UserProfile;
    attributes: string[];
    conceptSeeds: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
//  量表列表相关类型
// ============================================

export interface ScaleListItem {
  id: string;
  name: string;
  description: string;
  question_count: number;
  is_completed: boolean;
}

// ============================================
//  研究任务相关类型
// ============================================

export interface ResearchTask {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  ai_prompt: string | null;
  code_content: string;
  language: string;
  target_group: 'all' | 'unassigned' | 'pdt' | 'ai_pbl' | 'lecture';
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at: string;
  // 当前用户的提交状态
  is_completed?: boolean;
  code_submitted?: string | null;
  workspace_data?: Record<string, unknown> | null;
  blueprint_version_id?: string | null;
}

export interface FunctionMappingSuggestion {
  node_id: string;
  title_zh: string;
  match_reasons: string[];
  score: number;
}

export interface FunctionMappingSuggestionResponse {
  blueprint_version_id: string;
  suggestions: FunctionMappingSuggestion[];
}

/**
 * 七个基础功能的覆盖检查结果。
 * 后端只回传数量、每张卡是否命中和不含蓝图文本的简短问题。
 */
export interface FunctionCoverageResponse {
  blueprint_version_id: string;
  required_total: number;
  covered_total: number;
  uncovered_total: number;
  unmatched_card_count: number;
  cards: { card_id: string; matched: boolean }[];
  questions: string[];
}
