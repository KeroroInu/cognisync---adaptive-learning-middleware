import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi';
import type { LlmRoleConfig } from '../types';

const DEFAULT: LlmRoleConfig = { provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };

export function StudentAssistantConfig() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<LlmRoleConfig>(DEFAULT);
  const [saved, setSaved] = useState<LlmRoleConfig | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    if (!open) { setKey(''); return; }
    let active = true;
    setReady(false); setError(''); setMessage('');
    void adminApi.getLlmConfig().then(result => {
      if (!active) return;
      setSaved(result.chat);
      setConfig(result.chat.provider === 'mock' ? DEFAULT : result.chat);
      setReady(true);
    }).catch(() => { if (active) setError('配置读取失败，请收起后重新打开。'); });
    return () => { active = false; };
  }, [open]);

  const save = async (disable = false) => {
    if (lock.current || !ready) return;
    if (disable && !window.confirm('停用并清除网页助手的 API key？学生电脑上的 SFLS 不受影响。')) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await adminApi.saveLlmConfig('chat', disable
        ? { provider: 'mock', base_url: '', model: '', clear_api_key: true }
        : { ...config, api_key: key.trim() || undefined });
      setKey('');
      const result = await adminApi.getLlmConfig();
      setSaved(result.chat);
      setMessage(disable ? '已停用并清除 key。' : '配置已保存，将用于接下来的网页对话；尚未验证模型连接。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { lock.current = false; setBusy(false); }
  };

  return <section className="classroom-panel student-assistant-config">
    <button className="assistant-config-toggle" aria-expanded={open} aria-controls="student-assistant-settings" disabled={busy} onClick={() => setOpen(!open)}>
      <strong>学生平台 AI 助手</strong><span>{open ? '收起' : '配置 API key'}</span>
    </button>
    {open && <div id="student-assistant-settings" className="assistant-config-body">
      <p>两班共用，仅供网页助手使用。给本地 SFLS 发 key 请用“通知”。</p>
      {ready && <p>当前：{saved?.provider === 'mock' ? '未启用真实模型' : `${saved?.model} · ${saved?.has_api_key ? 'key 已设置' : '未设置 key'}`}</p>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy || !ready}>
          <label htmlFor="student-assistant-key">API key<input id="student-assistant-key" type="password" autoComplete="new-password" spellCheck={false} value={key} maxLength={4096} onChange={event => setKey(event.target.value)} placeholder={saved?.has_api_key ? '粘贴新 key；留空保留现有 key' : '粘贴 API key'} /></label>
          <details><summary>模型与接口</summary><div className="assistant-model-fields">
            <label>服务<select value={config.provider} onChange={event => setConfig({ provider: event.target.value, base_url: event.target.value === 'deepseek' ? DEFAULT.base_url : 'https://api.openai.com/v1', model: event.target.value === 'deepseek' ? DEFAULT.model : '' })}>
              <option value="deepseek">DeepSeek</option><option value="openai">OpenAI 兼容接口</option>
              {['ollama', 'lmstudio'].includes(config.provider) && <option value={config.provider}>{config.provider}</option>}
            </select></label>
            <label>模型名称<input value={config.model || ''} onChange={event => setConfig({ ...config, model: event.target.value })} /></label>
            <label>API 地址<input type="url" value={config.base_url || ''} onChange={event => setConfig({ ...config, base_url: event.target.value })} /></label>
          </div></details>
          {typeof window !== 'undefined' && window.location.protocol === 'http:' && <p className="assistant-key-warning">当前网站使用 HTTP，传输未加密。建议用短期、限额 key，课后撤销。</p>}
          <div className="classroom-actions">
            <button type="submit" className="classroom-primary">{busy ? '保存中…' : '保存助手配置'}</button>
            {saved && saved.provider !== 'mock' && <button type="button" className="classroom-danger" onClick={() => void save(true)}>停用并清除 key</button>}
            <Link to="/config">高级配置</Link>
          </div>
        </fieldset>
      </form>
      {!ready && !error && <p role="status">正在读取配置…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="classroom-error">{error}</p>}
    </div>}
  </section>;
}
