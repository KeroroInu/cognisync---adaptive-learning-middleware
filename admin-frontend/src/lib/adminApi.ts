import type {
  ApiResponse,
  OverviewStats,
  UsersListResponse,
  UserDetail,
  MessagesListResponse,
  ProfileSnapshot,
  ScaleTemplate,
  ScalesListResponse,
  ScaleResponse,
  TableInfo,
  ColumnInfo,
  TableRowsResponse,
  SessionsListResponse,
  SessionDetail,
  SessionMessagesResponse,
  CalibrationLog,
  UserGraph,
  ResearchTask,
  ResearchTasksResponse,
  ResearchSubmissionsResponse,
  LlmConfig,
  LlmRoleConfig,
  EmotionExperimentResult,
  EmotionExperimentRunsResponse,
  EmotionCompareResult,
  EmotionDistributionResponse,
  EmotionTrendResponse,
  EmotionUserDetailResponse,
} from '../types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';

class AdminApiClient {
  private getAuthHeaders(includeJsonContentType: boolean = true): Record<string, string> {
    const token = localStorage.getItem('auth_token') || '';
    return includeJsonContentType
      ? {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      : {
          'Authorization': `Bearer ${token}`,
        };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${BASE_URL}/admin${endpoint}`;
    const isFormData = options.body instanceof FormData;
    const headers = {
      ...this.getAuthHeaders(!isFormData),
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message ||
          errorData.detail ||
          `HTTP ${response.status}: ${response.statusText}`
        );
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
    const result = await this.request<{ profiles: ProfileSnapshot[]; total: number }>(`/users/${userId}/profiles`);
    return result.profiles;
  }

  async getUserScaleResponses(userId: string): Promise<ScaleResponse[]> {
    const result = await this.request<{ responses: ScaleResponse[]; total: number }>(`/users/${userId}/scale-responses`);
    return result.responses;
  }

  async getUserCalibrationLogs(userId: string): Promise<CalibrationLog[]> {
    const result = await this.request<{ logs: CalibrationLog[]; total: number }>(`/users/${userId}/calibration-logs`);
    return result.logs;
  }

  async getUserGraph(userId: string): Promise<UserGraph> {
    return this.request<UserGraph>(`/users/${userId}/graph`);
  }

  async deleteUser(userId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/users/${userId}`, { method: 'DELETE' });
  }

  async updateUser(userId: string, data: { name?: string; is_active?: boolean }): Promise<{ id: string; email: string; name: string; is_active: boolean }> {
    return this.request(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<{ reset: boolean }> {
    return this.request<{ reset: boolean }>(`/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    });
  }

  // Scales
  async getScales(): Promise<ScalesListResponse> {
    return this.request<ScalesListResponse>('/scales');
  }

  async uploadScale(data: Record<string, unknown>): Promise<ScaleTemplate> {
    return this.request<ScaleTemplate>('/scales/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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

  async getScaleResponses(scaleId: string, limit: number = 2000): Promise<ScaleResponse[]> {
    const result = await this.request<{ responses: ScaleResponse[]; total: number } | ScaleResponse[]>(`/scales/${scaleId}/responses?limit=${limit}`);
    return Array.isArray(result) ? result : ((result as { responses: ScaleResponse[] }).responses ?? []);
  }

  async deleteScale(scaleId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/scales/${scaleId}`, { method: 'DELETE' });
  }

  async deleteScaleResponses(responseIds: string[]): Promise<{ deleted: boolean; count: number }> {
    return this.request<{ deleted: boolean; count: number }>('/scales/responses/batch', {
      method: 'DELETE',
      body: JSON.stringify(responseIds),
    });
  }

  // Sessions
  async getSessions(page: number = 1, pageSize: number = 10): Promise<SessionsListResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    return this.request<SessionsListResponse>(`/sessions?${params}`);
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/sessions/${sessionId}`);
  }

  async getSessionMessages(sessionId: string, limit: number = 100, offset: number = 0): Promise<SessionMessagesResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    return this.request<SessionMessagesResponse>(`/sessions/${sessionId}/messages?${params}`);
  }

  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/sessions/${sessionId}`, { method: 'DELETE' });
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

  async exportCsv(endpoint: string): Promise<Blob> {
    const url = `${BASE_URL}/admin${endpoint}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.blob();
  }

  // Research Tasks
  async getResearchTasks(): Promise<ResearchTasksResponse> {
    return this.request<ResearchTasksResponse>('/research/tasks');
  }

  async createResearchTask(data: {
    title: string;
    description?: string;
    instructions?: string;
    ai_prompt?: string;
    code_content: string;
    language: string;
  }): Promise<ResearchTask> {
    return this.request<ResearchTask>('/research/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateResearchTask(taskId: string, data: {
    title?: string;
    description?: string;
    instructions?: string;
    ai_prompt?: string;
    code_content?: string;
    language?: string;
  }): Promise<ResearchTask> {
    return this.request<ResearchTask>(`/research/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteResearchTask(taskId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/research/tasks/${taskId}`, { method: 'DELETE' });
  }

  async activateResearchTask(taskId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/research/tasks/${taskId}/activate`, { method: 'POST' });
  }

  async archiveResearchTask(taskId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/research/tasks/${taskId}/archive`, { method: 'POST' });
  }

  async getResearchTaskSubmissions(taskId: string, limit: number = 2000): Promise<ResearchSubmissionsResponse> {
    return this.request<ResearchSubmissionsResponse>(`/research/tasks/${taskId}/submissions?limit=${limit}`);
  }

  async deleteResearchSubmissions(submissionIds: string[]): Promise<{ deleted: boolean; count: number }> {
    return this.request<{ deleted: boolean; count: number }>('/research/submissions/batch', {
      method: 'DELETE',
      body: JSON.stringify(submissionIds),
    });
  }

  async getLlmConfig(): Promise<LlmConfig> {
    return this.request<LlmConfig>('/config/llm');
  }

  async saveLlmConfig(role: 'analysis' | 'chat', config: LlmRoleConfig): Promise<{ role: string; provider: string; model: string }> {
    return this.request('/config/llm', {
      method: 'PUT',
      body: JSON.stringify({ role, config }),
    });
  }

  async analyzeEmotionExperimentCsv(data: {
    file: File;
    textColumn: string;
    conversationIdColumn?: string;
    speakerColumn?: string;
    expectedLabelColumn?: string;
    expectedLabelColumnsJson?: string;
    positiveLabelValue?: string;
    profileKeyColumn?: string;
    labelMappingJson?: string;
    previewLimit?: number;
  }): Promise<EmotionExperimentResult> {
    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('text_column', data.textColumn);
    if (data.conversationIdColumn) formData.append('conversation_id_column', data.conversationIdColumn);
    if (data.speakerColumn) formData.append('speaker_column', data.speakerColumn);
    if (data.expectedLabelColumn) formData.append('expected_label_column', data.expectedLabelColumn);
    if (data.expectedLabelColumnsJson) formData.append('expected_label_columns_json', data.expectedLabelColumnsJson);
    if (data.positiveLabelValue) formData.append('positive_label_value', data.positiveLabelValue);
    if (data.profileKeyColumn) formData.append('profile_key_column', data.profileKeyColumn);
    if (data.labelMappingJson) formData.append('label_mapping_json', data.labelMappingJson);
    if (typeof data.previewLimit === 'number') formData.append('preview_limit', String(data.previewLimit));

    return this.request<EmotionExperimentResult>('/research/emotion-experiments/analyze-csv', {
      method: 'POST',
      body: formData,
    });
  }

  async analyzeEmotionCompareDataset(data: {
    file: File;
    labelMode: 'single_label' | 'multi_binary';
    textColumn: string;
    expectedLabelColumn?: string;
    expectedLabelColumnsJson?: string;
    positiveLabelValue?: string;
    sampleIdColumn?: string;
    conversationIdColumn?: string;
    speakerColumn?: string;
    profileKeyColumn?: string;
    labelMappingJson?: string;
    previewLimit?: number;
    datasetTemplate?: string;
  }): Promise<EmotionCompareResult> {
    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('label_mode', data.labelMode);
    formData.append('text_column', data.textColumn);
    if (data.expectedLabelColumn) formData.append('expected_label_column', data.expectedLabelColumn);
    if (data.expectedLabelColumnsJson) formData.append('expected_label_columns_json', data.expectedLabelColumnsJson);
    if (data.positiveLabelValue) formData.append('positive_label_value', data.positiveLabelValue);
    if (data.sampleIdColumn) formData.append('sample_id_column', data.sampleIdColumn);
    if (data.conversationIdColumn) formData.append('conversation_id_column', data.conversationIdColumn);
    if (data.speakerColumn) formData.append('speaker_column', data.speakerColumn);
    if (data.profileKeyColumn) formData.append('profile_key_column', data.profileKeyColumn);
    if (data.labelMappingJson) formData.append('label_mapping_json', data.labelMappingJson);
    if (typeof data.previewLimit === 'number') formData.append('preview_limit', String(data.previewLimit));
    if (data.datasetTemplate) formData.append('dataset_template', data.datasetTemplate);

    return this.request<EmotionCompareResult>('/research/emotion-compare/analyze-dataset', {
      method: 'POST',
      body: formData,
    });
  }

  async getEmotionExperimentRuns(limit: number = 20, offset: number = 0): Promise<EmotionExperimentRunsResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<EmotionExperimentRunsResponse>(`/research/emotion-experiments/runs?${params}`);
  }

  async getEmotionExperimentRunDetail(runId: string): Promise<EmotionExperimentResult> {
    return this.request<EmotionExperimentResult>(`/research/emotion-experiments/runs/${runId}`);
  }

  async getEmotionDistribution(days: number = 30, limit: number = 20): Promise<EmotionDistributionResponse> {
    const params = new URLSearchParams({
      days: String(days),
      limit: String(limit),
    });
    return this.request<EmotionDistributionResponse>(`/analytics/emotion?${params}`);
  }

  async getEmotionTrends(days: number = 14): Promise<EmotionTrendResponse> {
    const params = new URLSearchParams({
      days: String(days),
    });
    return this.request<EmotionTrendResponse>(`/analytics/emotion/trends?${params}`);
  }

  async getEmotionUserDetail(userId: string, limit: number = 50): Promise<EmotionUserDetailResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
    });
    return this.request<EmotionUserDetailResponse>(`/analytics/emotion/users/${userId}?${params}`);
  }
}

export const adminApi = new AdminApiClient();
