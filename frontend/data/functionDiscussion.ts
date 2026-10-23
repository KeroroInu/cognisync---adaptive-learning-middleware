export interface FunctionDiscussionMessage {
  requestId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: string;
  action?: 'message' | 'idea_hint' | 'organize';
}

export interface FunctionDiscussionDraft {
  id: string;
  responsibility: string;
  implementation: string;
  messages: FunctionDiscussionMessage[];
  acceptedDraftRequestId?: string;
}

/** Only an explicitly marked steps block is a draft; never treat ordinary advice as one. */
export function parseFunctionDiscussion(text: string): { text: string; steps?: string } {
  // Historical offline analysis payloads stay stored, but are not student-facing advice.
  try {
    const payload = JSON.parse(text);
    if (payload && typeof payload === 'object' && 'intent' in payload && 'delta' in payload && 'detectedConcepts' in payload) {
      return { text: '这条旧回复是异常的内部分析，不是功能提示。请重新说说你的想法，或点“给我一点提示”。' };
    }
  } catch { /* Normal dialogue and steps are not JSON. */ }
  const block = /```steps\s*\n([\s\S]*?)\n```/.exec(text);
  const steps = block?.[1].trim();
  if (!block || !steps || steps.length > 800) return { text };
  return { text: text.replace(block[0], '').trim(), steps };
}

export function hasFunctionIdea(draft: FunctionDiscussionDraft): boolean {
  return Boolean(draft.implementation.trim() || draft.messages.some(m => m.role === 'user' && (!m.action || m.action === 'message') && m.text.trim()));
}

export function functionDiscussionSummary(observation: string, draft: FunctionDiscussionDraft): string {
  // The server loads scoped chat history; do not duplicate it inside artifact data.
  return JSON.stringify({
    observation: observation.slice(0, 500),
    functionName: draft.responsibility,
    studentSteps: draft.implementation,
    acceptedDraftRequestId: draft.acceptedDraftRequestId ?? null,
  });
}
