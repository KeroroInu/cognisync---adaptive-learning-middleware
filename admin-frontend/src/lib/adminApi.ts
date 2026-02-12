import type {
  ApiResponse,
  OverviewStats,
  UsersListResponse,
  UserDetail,
  MessagesListResponse,
  ProfileSnapshot,
  ScaleTemplate,
  ScaleResponse,
  TableInfo,
  ColumnInfo,
  TableRowsResponse,
} from '../types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';
const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string) || '';

class AdminApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${BASE_URL}/admin${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-ADMIN-KEY': ADMIN_KEY,
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ApiResponse<T> = await response.json();
      
      if (!data.success) {
        throw new Error(data.error?.message || 'Request failed');
      }

      return data.data as T;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  // Overview
  async getOverview(): Promise<OverviewStats> {
    return this.request<OverviewStats>('/overview');
  }

  // Users
  async getUsers(page: number = 1, pageSize: number = 10, query?: string): Promise<UsersListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (query) params.append('query', query);
    
    return this.request<UsersListResponse>(`/users?${params}`);
  }

  async getUserDetail(userId: string): Promise<UserDetail> {
    return this.request<UserDetail>(`/users/${userId}`);
  }

  async getUserMessages(userId: string, limit: number = 50, offset: number = 0): Promise<MessagesListResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    return this.request<MessagesListResponse>(`/users/${userId}/messages?${params}`);
  }

  async getUserProfiles(userId: string): Promise<ProfileSnapshot[]> {
    return this.request<ProfileSnapshot[]>(`/users/${userId}/profiles`);
  }

  async getUserScaleResponses(userId: string): Promise<ScaleResponse[]> {
    return this.request<ScaleResponse[]>(`/users/${userId}/scale-responses`);
  }

  // Scales
  async getScales(): Promise<ScaleTemplate[]> {
    return this.request<ScaleTemplate[]>('/scales');
  }

  async uploadScale(data: FormData): Promise<ScaleTemplate> {
    const url = `${BASE_URL}/admin/scales/upload`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-ADMIN-KEY': ADMIN_KEY,
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result: ApiResponse<ScaleTemplate> = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Upload failed');
    }

    return result.data as ScaleTemplate;
  }

  async activateScale(scaleId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/scales/${scaleId}/activate`, {
      method: 'POST',
    });
  }

  async archiveScale(scaleId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/scales/${scaleId}/archive`, {
      method: 'POST',
    });
  }

  async getScaleResponses(scaleId: string): Promise<ScaleResponse[]> {
    return this.request<ScaleResponse[]>(`/scales/${scaleId}/responses`);
  }

  // Data Explorer
  async getTables(): Promise<TableInfo[]> {
    return this.request<TableInfo[]>('/db/tables');
  }

  async getTableColumns(tableName: string): Promise<ColumnInfo[]> {
    return this.request<ColumnInfo[]>(`/db/tables/${tableName}/columns`);
  }

  async getTableRows(
    tableName: string,
    limit: number = 50,
    offset: number = 0,
    orderBy?: string,
    order: 'asc' | 'desc' = 'desc',
    filters?: Record<string, unknown>
  ): Promise<TableRowsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (orderBy) params.append('order_by', orderBy);
    params.append('order', order);
    if (filters) params.append('filters', JSON.stringify(filters));

    return this.request<TableRowsResponse>(`/db/tables/${tableName}/rows?${params}`);
  }

  async exportTable(tableName: string, format: 'json' = 'json', filters?: Record<string, unknown>): Promise<unknown[]> {
    const params = new URLSearchParams({
      table: tableName,
      format,
    });
    if (filters) params.append('filters', JSON.stringify(filters));

    return this.request<unknown[]>(`/db/export?${params}`);
  }
}

export const adminApi = new AdminApiClient();
