import { apiClient } from './apiClient';
import type { StudentArtifactSummary } from './studentArtifacts';

export type ConversationSource = 'artifacts' | 'web';
export type ArtifactVersions = 'latest' | 'all';
export interface ConversationIdentity {
  user_id: string;
  user_name: string | null;
  student_id: string | null;
  school_class: string | null;
  class_name: string | null;
}
export interface ArtifactConversation extends StudentArtifactSummary, ConversationIdentity { version_count: number }
export interface WebConversation extends ConversationIdentity {
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
}
export interface ConversationPage<T> { items: T[]; total: number; page: number; page_size: number }
export interface WebConversationMessage { id: string; role: string; text: string; timestamp: string | null }
export interface WebMessagePage { messages: WebConversationMessage[]; total: number; limit: number; offset: number }
export interface ConversationFilters { query: string; className: string; page: number; versions: ArtifactVersions }

function listParams(filters: ConversationFilters) {
  const params = new URLSearchParams({ page: String(filters.page), page_size: '30' });
  if (filters.query.trim()) params.set('query', filters.query.trim());
  if (filters.className.trim()) params.set('class_name', filters.className.trim());
  return params;
}
export function conversationDate(value: string | null): string {
  if (!value) return '时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN', { hour12: false });
}
export function conversationIdentity(item: ConversationIdentity): string {
  return item.user_name || item.student_id || '未命名学生';
}
/** Only public student/assistant turns are eligible for this read-only preview. */
export function publicMessages(messages: WebConversationMessage[]): WebConversationMessage[] {
  return messages.filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string');
}
export function appendMessages(previous: WebConversationMessage[], incoming: WebConversationMessage[]): WebConversationMessage[] {
  const seen = new Set(previous.map(message => message.id));
  return [...previous, ...publicMessages(incoming).filter(message => {
    if (seen.has(message.id)) return false;
    seen.add(message.id); return true;
  })];
}
export const conversationBrowserApi = {
  artifacts(filters: ConversationFilters, signal?: AbortSignal): Promise<ConversationPage<ArtifactConversation>> {
    const params = listParams(filters); params.set('versions', filters.versions);
    return apiClient.get(`/admin/conversations/artifacts?${params}`, { signal });
  },
  web(filters: ConversationFilters, signal?: AbortSignal): Promise<ConversationPage<WebConversation>> {
    return apiClient.get(`/admin/conversations/web?${listParams(filters)}`, { signal });
  },
  messages(userId: string, offset = 0, signal?: AbortSignal): Promise<WebMessagePage> {
    return apiClient.get(`/admin/conversations/web/${encodeURIComponent(userId)}/messages?${new URLSearchParams({ limit: '50', offset: String(offset) })}`, { signal });
  },
};
