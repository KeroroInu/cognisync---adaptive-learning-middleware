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
}