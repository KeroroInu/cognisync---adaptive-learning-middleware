import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectFactoryHeader, ProjectObservationStage } from '../components/ProjectFactory';
import type { SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';

const noop = () => {};
afterEach(() => vi.unstubAllGlobals());

describe('student workspace labels', () => {
  it('distinguishes the example from running student code and names icon buttons', () => {
    const html = renderToStaticMarkup(<ProjectFactoryHeader language="zh" experimentGroup="pdt"
      activeStage="observe" onStageChange={noop} onOpenProject={noop} onOpenAssistant={noop}
      onOpenClassTask={noop} onLogout={noop} saveLabel="已保存" />);
    expect(html).toContain('打开示例');
    expect(html).not.toContain('运行完整项目');
    expect(html).toContain('aria-label="打开示例游戏"');
    expect(html).toContain('aria-label="打开学习助手"');
    expect(html).toContain('role="status"');
    expect(html).toContain('已保存');
  });

  function observations(count: number, ran: boolean) {
    const cards = Array.from({ length: count }, (_, index) => ({
      id: `card-${index}`, evidenceId: 'run', evidenceText: '游戏开始了',
      observationText: `我的发现 ${index + 1}`, source: 'student', createdAt: '2026-09-14T01:00:00Z',
    }));
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify(cards) } });
    const evidence: SnakeRuntimeEvidence[] = ran
      ? [{ id: 'run', type: 'started', timestamp: '2026-09-14T01:00:00Z' }]
      : [];
    return renderToStaticMarkup(<ProjectObservationStage language="zh" storageScope="student:task"
      evidence={evidence} scaffoldCompletion={null} onOpenProject={noop}
      onContinue={noop} onCardCountChange={noop} />);
  }

  it('explains the remaining work instead of presenting a score-like fraction', () => {
    const html = observations(1, true);
    expect(html).toContain('已保存 1 条');
    expect(html).toContain('再保存 1 条发现');
    expect(html).not.toContain('/02');
    expect(html).toMatch(/<button type="button" disabled="">下一步：拆功能/);
  });

  it('keeps both existing continuation requirements: actual play and two observations', () => {
    const ready = observations(2, true);
    expect(ready).toContain('可以继续了');
    expect(ready).toMatch(/<button type="button">下一步：拆功能/);
    const notPlayed = observations(2, false);
    expect(notPlayed).toContain('先玩过游戏');
    expect(notPlayed).toMatch(/<button type="button" disabled="">下一步：拆功能/);
  });
});
