/**
 * LLM Provider Interface
 * Abstract interface for different LLM providers (OpenAI, Anthropic, etc.)
 * This is a placeholder for future implementation
 */

/**
 * Message structure for LLM requests
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM completion request
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * LLM completion response
 */
export interface LLMCompletionResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Abstract LLM Provider interface
 * Implement this interface for each LLM provider (OpenAI, Anthropic, etc.)
 */
export interface ILLMProvider {
  /**
   * Get completion from LLM
   */
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;

  /**
   * Health check for provider availability
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Mock LLM Provider for development
 * Replace with actual implementation in production
 */
export class MockLLMProvider implements ILLMProvider {
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    // Mock implementation - returns a placeholder response
    const userMessage = request.messages.find((m) => m.role === 'user');
    return {
      content: `Mock response to: ${userMessage?.content ?? 'no message'}`,
      model: request.model ?? 'mock-model',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
