/**
 * Admin API 客户端
 * 所有请求自动携带 X-ADMIN-KEY Header
 */

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

class AdminApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-ADMIN-KEY': ADMIN_KEY,
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Invalid admin key. Please check your credentials.');
      }
      throw new Error(`API Error: ${response.statusText}`);
    }

    const result: ApiResponse<T> = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Unknown error');
    }

    return result.data;
  }

  // ============ 数据浏览器 API ============
  async listTables() {
    return this.request<any>('/api/admin/explorer/tables');
  }

  async getTableSchema(tableName: string) {
    return this.request<any>(`/api/admin/explorer/tables/${tableName}/schema`);
  }

  async getTableData(tableName: string, page: number, pageSize = 50) {
    return this.request<any>(
      `/api/admin/explorer/tables/${tableName}/data?page=${page}&page_size=${pageSize}`
    );
  }

  async exportTable(tableName: string) {
    const response = await fetch(
      `${API_BASE_URL}/api/admin/explorer/tables/${tableName}/export`,
      {
        headers: { 'X-ADMIN-KEY': ADMIN_KEY },
      }
    );
    return response.json();
  }

  // ============ 用户管理 API ============
  async listUsers(page: number, pageSize = 20) {
    return this.request<any>(`/api/admin/users?page=${page}&page_size=${pageSize}`);
  }

  // ============ 数据分析 API ============
  async getAnalyticsOverview() {
    return this.request<any>('/api/admin/analytics/overview');
  }
}

export const adminApi = new AdminApiClient();
