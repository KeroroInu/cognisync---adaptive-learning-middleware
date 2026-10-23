import React, { useEffect, useRef, useState } from 'react';
import type { ClassroomNoticeData } from '../services/classroom';
import './ClassroomNotice.css';

export function ClassroomNotice({ notice: legacyNotice, notices, userId, onOpenChange }: {
  notice: ClassroomNoticeData | null; notices?: ClassroomNoticeData[]; userId: string; onOpenChange: (open: boolean) => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('sfls:notice-read:' + userId) || '[]');
      const old = sessionStorage.getItem('sfls:notice-dismissed:' + userId);
      return [...(Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []), ...(old ? [old] : [])];
    } catch { return []; }
  });
  const [focused, setFocused] = useState('');
  const [now, setNow] = useState(Date.now());
  const [copyMessage, setCopyMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLTextAreaElement>(null);
  const active = (notices ?? (legacyNotice ? [legacyNotice] : [])).filter(item => Date.parse(item.expires_at) > Math.max(now, Date.now()));
  const notice = active.find(item => item.id === focused) ?? active.find(item => !dismissed.includes(item.id));
  const visible = active.length > 0;
  const open = !!notice;
  const earliestExpiry = Math.min(...active.map(item => Date.parse(item.expires_at)));
  useEffect(() => {
    if (!Number.isFinite(earliestExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, earliestExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [earliestExpiry]);
  useEffect(() => {
    setCopyMessage('');
  }, [notice?.id]);
  useEffect(() => {
    onOpenChange(open);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) dialog.current?.close();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, [open, notice?.id, onOpenChange]);
  const dismiss = () => {
    if (!notice) return;
    const ids = [...new Set([...dismissed, notice.id])].slice(-200);
    setDismissed(ids); setFocused('');
    // Only IDs, never copyable content, are stored in the browser.
    try { sessionStorage.setItem('sfls:notice-read:' + userId, JSON.stringify(ids)); } catch { /* Memory fallback. */ }
  };
  async function copy() {
    if (!notice || Date.parse(notice.expires_at) <= Date.now()) return;
    try { await navigator.clipboard.writeText(notice.content); setCopyMessage('已复制'); }
    catch { content.current?.focus(); content.current?.select(); setCopyMessage('请按 Ctrl+C（Mac 用 ⌘C）复制所选内容'); }
  }
  if (!visible) return null;
  return <>
    {open ? <dialog className="classroom-notice" ref={dialog} aria-labelledby="classroom-notice-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
      <header><h2 id="classroom-notice-title">老师发来一条通知</h2><button aria-label="关闭通知" onClick={dismiss}>×</button></header>
      <textarea ref={content} aria-label="老师的通知" readOnly value={notice!.content} spellCheck={false} />
      {active.length > 1 && <nav className="notice-pages" aria-label="其他内容">{active.map((item, i) => <button key={item.id} aria-label={'查看第 ' + (i + 1) + ' 条内容'} aria-current={item.id === notice?.id ? 'true' : undefined} onClick={() => setFocused(item.id)}>{i + 1}</button>)}</nav>}
      <footer><span role="status">{copyMessage || '可以复制，关闭后也能再查看。'}</span><button className="classroom-primary" onClick={() => void copy()}>复制内容</button></footer>
    </dialog> : <button className="classroom-notice-reminder" onClick={() => { setFocused(active[0].id); setCopyMessage(''); }}>查看通知</button>}
  </>;
}
