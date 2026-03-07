import { useState, useEffect } from 'react';
import { Settings2, RefreshCw, CheckCircle, AlertCircle, Loader, Save, X, Edit2, Cpu, MessageSquare } from 'lucide-react';
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

// 使用 CSS 变量而非 Tailwind dark: 前缀，兼容 data-theme 而非 prefers-color-scheme
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--glass-border)',
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
};

const EMPTY_ROLE: LlmRoleConfig = { provider: 'mock', api_key: '', base_url: '', model: '' };

// 只读摘要卡片，展示当前配置
function RoleDisplayCard({ title, description, config, icon, onEdit }: {
  title: string;
  description: string;
  config: LlmRoleConfig;
  icon: React.ReactNode;
  onEdit: () => void;
}) {
  const providerMeta = PROVIDERS.find(p => p.value === config.provider) ?? PROVIDERS[4];
  const isConfigured = config.provider !== 'mock';

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            {icon}
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-light)' }}>{description}</p>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 flex-shrink-0 ml-3"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}
        >
          <Edit2 size={14} />
          编辑
        </button>
      </div>

      {/* Config rows */}
      <div className="space-y-0 pt-1">
        <div className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-light)' }}>提供者</span>
          <span
            className="text-xs font-medium px-2.5 py-1 rounded-full"
            style={{
              background: isConfigured ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
              color: isConfigured ? '#6366f1' : 'var(--text-light)',
            }}
          >
            {providerMeta.label}
          </span>
        </div>

        {isConfigured ? (
          <>
            <div className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
              <span className="text-xs" style={{ color: 'var(--text-light)' }}>模型</span>
              <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
                {config.model || '（未设置）'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
              <span className="text-xs" style={{ color: 'var(--text-light)' }}>Base URL</span>
              <span className="text-xs font-mono truncate max-w-[180px]" style={{ color: 'var(--text-secondary)' }}>
                {config.base_url || '（默认）'}
              </span>
            </div>
            {providerMeta.needsKey && (
              <div className="flex items-center justify-between py-2.5">
                <span className="text-xs" style={{ color: 'var(--text-light)' }}>API Key</span>
                <span className="text-sm" style={{ color: config.api_key ? '#10b981' : 'rgba(239,68,68,0.8)' }}>
                  {config.api_key ? '● ● ● ● ● 已设置' : '未配置'}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="py-4 text-center">
            <p className="text-sm" style={{ color: 'var(--text-light)' }}>
              尚未配置，将使用服务器默认设置
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// 弹出编辑框
function EditModal({ role, title, initial, onSave, onClose }: {
  role: 'analysis' | 'chat';
  title: string;
  initial: LlmRoleConfig;
  onSave: (config: LlmRoleConfig) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<LlmRoleConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

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
      setTimeout(() => {
        onSave(form);
        onClose();
      }, 800);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
      setStatus('error');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card rounded-2xl w-full max-w-md p-6 space-y-5">
        {/* Modal header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            配置 {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-opacity hover:opacity-60"
            style={{ color: 'var(--text-light)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Provider selector */}
        <div>
          <label className="block text-sm font-medium mb-1" style={labelStyle}>提供者</label>
          <select
            value={form.provider}
            onChange={e => handleProviderChange(e.target.value as Provider)}
            className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={fieldStyle}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {form.provider !== 'mock' && (
          <>
            {currentProvider.needsKey && (
              <div>
                <label className="block text-sm font-medium mb-1" style={labelStyle}>API Key</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={e => setForm(prev => ({ ...prev, api_key: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  style={fieldStyle}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1" style={labelStyle}>Base URL</label>
              <input
                type="text"
                value={form.base_url}
                onChange={e => setForm(prev => ({ ...prev, base_url: e.target.value }))}
                placeholder={currentProvider.defaultUrl}
                className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                style={fieldStyle}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={labelStyle}>模型名称</label>
              <input
                type="text"
                value={form.model}
                onChange={e => setForm(prev => ({ ...prev, model: e.target.value }))}
                placeholder={currentProvider.defaultModel}
                className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                style={fieldStyle}
              />
            </div>
          </>
        )}

        {/* Feedback */}
        {status === 'success' && (
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle size={16} /> 已保存，立即生效
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle size={16} /> {errorMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl border text-sm transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            {saving ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ModelConfig = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<LlmRoleConfig>(EMPTY_ROLE);
  const [chat, setChat] = useState<LlmRoleConfig>(EMPTY_ROLE);
  const [editingRole, setEditingRole] = useState<'analysis' | 'chat' | null>(null);

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
      {/* 编辑弹框 */}
      {editingRole && (
        <EditModal
          role={editingRole}
          title={editingRole === 'analysis' ? '语义分析模型' : 'AI 对话模型'}
          initial={editingRole === 'analysis' ? analysis : chat}
          onSave={(config) => {
            if (editingRole === 'analysis') setAnalysis(config);
            else setChat(config);
          }}
          onClose={() => setEditingRole(null)}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
            <Settings2 size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>模型配置</h1>
            <p className="text-sm" style={{ color: 'var(--text-light)' }}>独立配置语义分析和 AI 对话使用的 LLM 接口</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm hover:opacity-80 transition-opacity"
          style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl text-sm text-red-500"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
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
          <RoleDisplayCard
            title="语义分析模型"
            description="用于解析学生消息意图、情感状态和学习概念"
            config={analysis}
            icon={<Cpu size={20} />}
            onEdit={() => setEditingRole('analysis')}
          />
          <RoleDisplayCard
            title="AI 对话模型"
            description="用于生成 AI 助手的自然语言回复"
            config={chat}
            icon={<MessageSquare size={20} />}
            onEdit={() => setEditingRole('chat')}
          />
        </div>
      )}

      {/* Info note */}
      <div className="p-4 rounded-xl text-sm"
        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--text-secondary)' }}>
        <strong>提示：</strong>配置保存后立即在后端生效，无需重启服务。如果未配置将回退到服务器环境变量中的默认 LLM 设置。
      </div>
    </div>
  );
};
