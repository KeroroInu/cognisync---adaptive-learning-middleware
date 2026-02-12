export type Dimension = 'Cognition' | 'Affect' | 'Behavior';
export type Language = 'zh' | 'en';

export interface UserProfile {
  cognition: number;
  affect: number;
  behavior: number;
  lastUpdate: string;
}

export interface Node {
  id: string;
  name: string;
  mastery: number; // 0-100
  frequency: number; // 1-10 (size)
  description: string;
  x?: number;
  y?: number;
  isFlagged?: boolean; // If user has disputed it
}

export interface Edge {
  source: string;
  target: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: {
    intent: string;
    emotion: string;
    detectedConcepts: string[];
    delta: Partial<UserProfile>;
  };
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
  email: string;
  name: string;
  createdAt: string;
  hasCompletedOnboarding: boolean;
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
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  mode: 'scale' | 'ai';
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
  answers: ScaleAnswer[];
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

export interface AIOnboardingSession {
  sessionId: string;
  question: string;
  summary: string;
  draftProfile?: Partial<UserProfile>;
  isComplete: boolean;
}

export interface AIOnboardingStartResponse {
  success: boolean;
  data?: {
    sessionId: string;
    question: string;
    summary: string;
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
    summary: string;
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