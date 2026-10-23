import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClassroomTaskBrief } from '../components/ClassroomTaskBrief';
import { Dashboard } from '../views/Dashboard';

describe('体验组独立任务文案', () => {
  it('任务说明不套用贪吃蛇或两个研究班的教学路线', () => {
    const html = renderToStaticMarkup(<ClassroomTaskBrief open language="zh" experimentGroup="experience" onClose={() => {}} />);
    expect(html).toContain('体验组');
    expect(html).toContain('老师发布的任务要求');
    expect(html).toContain('提交作品');
    for (const label of ['贪吃蛇', '拆功能', '七个函数', '课堂讲授组', '常规 AI 协作组']) expect(html).not.toContain(label);
  });
  it('无任务回退页说明下载与提交，不要求进入解构工作区', () => {
    const html = renderToStaticMarkup(<Dashboard profile={{ cognition: 0, affect: 0, behavior: 0, lastUpdate: '' }}
      onNavigate={() => {}} language="zh" theme="light" experimentGroup="experience" />);
    expect(html).toContain('AI 编程体验平台');
    expect(html).toContain('查看课堂任务');
    expect(html).toContain('下载到自己的电脑');
    expect(html).not.toContain('贪吃蛇');
    expect(html).not.toContain('开始项目解构');
  });
  it('英文体验说明也不使用解构教学路线', () => {
    const html = renderToStaticMarkup(<Dashboard profile={{ cognition: 0, affect: 0, behavior: 0, lastUpdate: '' }}
      onNavigate={() => {}} language="en" theme="light" experimentGroup="experience" />);
    expect(html).toContain('Turn an idea into a project.');
    expect(html).not.toContain('deconstruction');
  });
});
