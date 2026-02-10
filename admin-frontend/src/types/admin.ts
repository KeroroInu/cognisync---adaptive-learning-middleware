export interface TableInfo {
  name: string;
  rowCount: number;
  canView: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface TableSchema {
  table: string;
  columns: ColumnInfo[];
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TableData {
  table: string;
  rows: Record<string, any>[];
  pagination: PaginationInfo;
}

export interface UserSummary {
  id: string;
  email: string;
  created_at: string;
  message_count: number;
  last_active: string | null;
}

export interface SystemOverview {
  totalUsers: number;
  totalMessages: number;
  totalConcepts: number;
  avgMessagesPerUser: number;
  activeUsersLast7Days: number;
}

export interface UserActivity {
  date: string;
  activeUsers: number;
  totalMessages: number;
}
