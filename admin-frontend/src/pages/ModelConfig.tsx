import { useState, useEffect } from 'react';
import { Settings2, Save, RefreshCw, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { LlmRoleConfig } from '../types';

type Provider = 'openai' | 'deepseek' | 'ollama' | 'lmstudio' | 'mock';

const PROVIDERS: { value: Provider; label: string; needsKey: boolean; defaultUrl: string; defaultModel: string }[] = [
  { value: 'openai', label: 'OpenAI', needsKey: true, defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { value: 'deepseek', label: 'DeepSeek', needsKey: true, defaultUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { value: 'ollama', label: 'Ollama（本地）', needsKey: false, defaultUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.2' },
  { value: 'lmstudio', label: 'LM Studio（本地）', needsKey: false, defaultUrl: 'http://localhost:1234/v1', defaultModel: 'local-model' },
  { value: 'mock', label: 'Mock（测试用）', needsKey: false, defaultUrl: '', defaultModel: '' },
];

interface RoleCardProps {
  role: 'analysis' | 'chat';
  title: string;
  description: string;
  initial: LlmRoleConfig;
}

function RoleCard({ role, title, description, initial }: RoleCardProps) {
  const [form, setForm] = useState<LlmRoleConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const currentProvider = PROVIDERS.find(p => p.value === form.provider) ?? PROVIDERS[4];

  const handleProviderChange = (provider: Provider) => {
    const meta = PROVIDERS.find(p => p.value === provider)!;
    setForm(prev => ({
      ...prev,
      provider,
      base_url: prev.base_url || meta.defaultUrl,
      model: prev.model || meta.defaultModel,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      await adminApi.saveLlmConfig(role, form);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>

      {/* Provider selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">提供者</label>
        <select
          value={form.provider}
          onChange={e => handleProviderChange(e.target.value as Provider)}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {form.provider !== 'mock' && (
        <>
          {/* API Key */}
          {currentProvider.needsKey && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
              <input
                type="password"
                value={form.api_key}
                onChange={e => setForm(prev => ({ ...prev, api_key: e.target.value }))}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>
          )}

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Base URL</label>
            <input
              type="text"
              value={form.base_url}
              onChange={e => setForm(prev => ({ ...prev, base_url: e.target.value }))}
              placeholder={currentProvider.defaultUrl}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">模型名称</label>
            <input
              type="text"
              value={form.model}
              onChange={e => setForm(prev => ({ ...prev, model: e.target.value }))}
              placeholder={currentProvider.defaultModel}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>
        </>
      )}

      {/* Save button + feedback */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? '保存中...' : '保存'}
        </button>

        {status === 'success' && (
          <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle size={16} /> 已保存，立即生效
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1 text-sm text-red-500 dark:text-red-400">
            <AlertCircle size={16} /> {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}

const EMPTY_ROLE: LlmRoleConfig = { provider: 'mock', api_key: '', base_url: '', model: '' };

export const ModelConfig = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<LlmRoleConfig>(EMPTY_ROLE);
  const [chat, setChat] = useState<LlmRoleConfig>(EMPTY_ROLE);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const config = await adminApi.getLlmConfig();
      setAnalysis(config.analysis);
      setChat(config.chat);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
            <Settings2 size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold dark:text-white">模型配置</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">独立配置语义分析和 AI 对话使用的 LLM 接口</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-300"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader size={32} className="animate-spin text-indigo-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RoleCard
            role="analysis"
            title="语义分析模型"
            description="用于解析学生消息意图、情感状态和学习概念。要求支持 JSON 格式输出，推荐使用较低温度（temperature=0.3）的模型。"
            initial={analysis}
          />
          <RoleCard
            role="chat"
            title="AI 对话模型"
            description="用于生成 AI 助手的自然语言回复。对话连贯性和表达质量比 JSON 格式更重要，可使用较高温度（temperature=0.7）。"
            initial={chat}
          />
        </div>
      )}

      {/* Info note */}
      <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-300">
        <strong>提示：</strong>配置保存后立即在后端生效，无需重启服务。如果未配置将回退到服务器环境变量中的默认 LLM 设置。
      </div>
    </div>
  );
};
