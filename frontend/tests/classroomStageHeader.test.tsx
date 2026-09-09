import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectFactoryHeader } from '../components/ProjectFactory';
import { executionEvidence } from '../utils/executionEvidence';

describe('两组阶段导航', () => {
  const noop = () => {};
  function header(experimentGroup: 'pdt' | 'ai_pbl') {
    return renderToStaticMarkup(<ProjectFactoryHeader language="zh" experimentGroup={experimentGroup}
      activeStage="build" onStageChange={noop} onOpenProject={noop} onOpenAssistant={noop}
      onOpenClassTask={noop} onLogout={noop} saveLabel="已保存" />);
  }
  it('常规 AI 不展示解构、系统关系或路径门槛', () => {
    const html = header('ai_pbl');
    expect(html).toContain('编程工作台');
    for (const label of ['拆功能', '观察', '理关系', '定路径', '画流程']) expect(html).not.toContain(label);
  });
  it('解构组仍保留单功能流程，不恢复旧系统关系与路径', () => {
    const html = header('pdt');
    expect(html).toContain('画流程');
    expect(html).toContain('拆功能');
    expect(html).not.toContain('理关系');
    expect(html).not.toContain('定路径');
  });
  it('整文件执行留痕不冒充功能通过，保留运行时的原代码', () => {
    const record = executionEvidence('print(1)', true, '', 120);
    expect(record.detail).not.toHaveProperty('passed');
    expect(record.detail.execution_completed).toBe(true);
    expect(record.artifacts[0].content).toEqual({ code: 'print(1)', verified: false });
    expect(executionEvidence('bad', false, 'SyntaxError', 2).detail.error).toBe('SyntaxError');
  });
});
