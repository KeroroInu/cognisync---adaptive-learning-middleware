import React, { useState } from 'react';

// Keep generated text inert: no HTML rendering, link execution or editor mutation.
export function AssistantMessage({ text, language }: { text: string; language: 'zh' | 'en' }) {
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const pieces = text.split(/```[^\n]*\n([\s\S]*?)```/g);
  async function copy(code: string, index: number) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(index); setError(false);
    } catch { setError(true); }
  }
  return <div className="assistant-message-content">
    {pieces.map((piece, index) => index % 2
      ? <div className="assistant-code-block" key={index}>
          <button type="button" onClick={() => void copy(piece, index)}>{copied === index ? (language === 'zh' ? '已复制' : 'Copied') : (language === 'zh' ? '复制代码' : 'Copy code')}</button>
          <pre><code>{piece}</code></pre>
        </div>
      : piece.trim() ? <p key={index}>{piece}</p> : null)}
    {error && <p role="status">{language === 'zh' ? '没能自动复制，请选中代码复制。' : 'Select the code and copy it manually.'}</p>}
  </div>;
}
