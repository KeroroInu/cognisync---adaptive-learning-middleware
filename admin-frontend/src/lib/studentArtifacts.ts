import { apiClient } from './apiClient';

export interface StudentArtifactSummary {
  receipt_id: string;
  material_id: string;
  task_title: string;
  task_kind: string;
  created_at: string;
  filename: string;
  size: number;
  sha256: string;
  task_validation_status: string | null;
  manual_import: boolean;
  download_url: string;
}

export interface StudentArtifactList {
  items: StudentArtifactSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface StudentArtifactText {
  path: string;
  text: string;
  truncated: boolean;
}

export interface StudentArtifactDetail extends StudentArtifactSummary {
  readme: (StudentArtifactText & { is_template: boolean }) | null;
  code_files: StudentArtifactText[];
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    at: string | null;
    session_path: string;
    line: number;
    truncated?: boolean;
  }>;
  evidence: {
    has_events: boolean;
    has_sessions: boolean;
    code_file_count: number;
    message_count: number;
    displayed_message_count: number;
    truncated: boolean;
    message_count_is_lower_bound?: boolean;
    omitted_message_count?: number;
    message_selection?: string;
  };
  warnings: string[];
}

const userPath = (userId: string) => `/admin/users/${encodeURIComponent(userId)}/artifacts`;

export const studentArtifactsApi = {
  list(userId: string, page = 1, signal?: AbortSignal): Promise<StudentArtifactList> {
    return apiClient.get(`${userPath(userId)}?page=${page}&page_size=20`, { signal });
  },
  detail(userId: string, receiptId: string, signal?: AbortSignal): Promise<StudentArtifactDetail> {
    return apiClient.get(`${userPath(userId)}/${encodeURIComponent(receiptId)}`, { signal });
  },
  async archive(receiptId: string): Promise<Blob> {
    const token = localStorage.getItem('auth_token');
    let response: Response;
    try {
      response = await fetch(`/api/admin/classroom/receipts/${encodeURIComponent(receiptId)}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
    } catch { throw new Error('无法连接服务器，请检查网络后重试。'); }
    if (response.status === 401) {
      apiClient.setAuthToken(null);
      throw new Error('登录已过期，请重新登录。');
    }
    if (response.status === 403) throw new Error('没有下载权限。');
    if (!response.ok) throw new Error('作品包下载失败，请稍后重试。');
    return response.blob();
  },
};
