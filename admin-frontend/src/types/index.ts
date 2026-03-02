// Admin API Types

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface OverviewStats {
  users_count: number;
  sessions_count: number;
  messages_count: number;
  templates_count: number;
  responses_count: number;
}

export interface User {
  id: string;
  student_id: string;
  email: string | null;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
}

export interface UsersListResponse {
  users: User[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserDetail {
  id: string;
  student_id: string;
  email: string | null;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  messages_count: number;
  sessions_count: number;
  responses_count: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: Record<string, unknown>;
}

export interface MessagesListResponse {
  messages: ChatMessage[];
  total: number;
}

export interface ProfileSnapshot {
  id: string;
  user_id: string;
  cognition: number;
  affect: number;
  behavior: number;
  source: 'system' | 'user';
  created_at: string;
}

export interface ScaleTemplate {
  id: string;
  name: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  schema_json: Record<string, unknown>;
  scoring_json: Record<string, unknown>;
  mapping_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  responses_count?: number;
}

export interface ScalesListResponse {
  templates: ScaleTemplate[];
  total: number;
}

export interface ScaleResponse {
  id: string;
  user_id: string;
  user_name?: string;
  student_id?: string;
  template_id: string;
  template_name?: string;
  answers_json: Record<string, unknown>;
  scores_json: Record<string, unknown>;
  started_at?: string | null;
  created_at: string;
}

export interface TableInfo {
  table_name: string;
  row_count: number;
  description?: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_visible: boolean;
}

export interface TableRowsResponse {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionItem {
  id: string;
  user_id: string;
  user_email: string;
  message_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface SessionsListResponse {
  sessions: SessionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface SessionDetail {
  id: string;
  user_id: string;
  user_email: string;
  message_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface SessionMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: Record<string, unknown>;
}

export interface SessionMessagesResponse {
  messages: SessionMessageItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CalibrationLog {
  id: string;
  timestamp: string;
  dimension: 'cognition' | 'affect' | 'behavior';
  system_value: number;
  user_value: number;
  conflict_level: 'low' | 'medium' | 'high';
  user_comment: string | null;
  likert_trust: number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  category: string;
  mastery: number;
  frequency: number;
  is_flagged: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  rel_type: string;
  weight: number;
}

export interface UserGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ResearchTask {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  code_content: string;
  language: string;
  status: 'draft' | 'active' | 'archived';
  submissions_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchTaskSubmission {
  id: string;
  task_id: string;
  user_id: string;
  user_email?: string;
  code_submitted: string;
  is_completed: boolean;
  submitted_at: string | null;
  created_at: string;
}

export interface ResearchTasksResponse {
  tasks: ResearchTask[];
  total: number;
}

export interface ResearchSubmissionsResponse {
  submissions: ResearchTaskSubmission[];
  total: number;
}

export interface LlmRoleConfig {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
}

export interface LlmConfig {
  analysis: LlmRoleConfig;
  chat: LlmRoleConfig;
}

