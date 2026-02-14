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
  email: string;
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
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  current_profile: {
    cognition: number;
    affect: number;
    behavior: number;
  };
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
  template_id: string;
  answers_json: Record<string, unknown>;
  scores_json: Record<string, unknown>;
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
