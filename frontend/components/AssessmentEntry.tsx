import React, { createContext, useContext, useEffect, useRef } from 'react';
import { ClipboardList } from 'lucide-react';
import './AssessmentEntry.css';

export const AssessmentAccess = createContext<{ pending: boolean; open: () => void } | null>(null);

export function AssessmentEntry() {
  const access = useContext(AssessmentAccess);
  if (!access) return null;
  return <button type="button" className="assessment-entry" onClick={access.open}>
    <ClipboardList size={16} aria-hidden="true" /><span>问卷与测试</span>
    {access.pending && <span className="assessment-entry-dot" role="img" aria-label="有待填写内容" />}
  </button>;
}

export function AssessmentStatus({ checking, error, onRetry, onClose }: {
  checking: boolean; error: string; onRetry: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="assessment-status" aria-labelledby="assessment-status-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <ClipboardList size={28} aria-hidden="true" />
    <h2 id="assessment-status-title">问卷与测试</h2>
    {checking ? <p role="status">正在查看老师的安排…</p> : error ? <p role="alert">{error}</p> : <>
      <p role="status">暂时没有需要填写的内容。</p><p className="assessment-status-hint">你已完成的不会重复出现。老师开放给本班后，这里会显示提示。</p>
    </>}
    <footer><button type="button" onClick={onClose}>返回课堂</button><button type="button" disabled={checking} onClick={onRetry}>{error ? '重试' : '重新检查'}</button></footer>
  </dialog>;
}
