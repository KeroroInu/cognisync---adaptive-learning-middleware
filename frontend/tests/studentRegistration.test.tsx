import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { registrationError, normalizeStudentId } from '../utils/studentRegistration';
import { Login } from '../views/Login';
import { RetroLearningTerminal } from '../components/RetroLearningTerminal';

const valid = { name: '测试同学', gender: 'female', className: '高一（1）班', studentId: 'G2026001234', password: 'test-only123' };
describe('classroom identity form', () => {
  it('accepts actual school classes without guessing school ID length', () => {
    expect(registrationError(valid)).toBe('');
    expect(registrationError({ ...valid, studentId: 'G200901234567890123', className: '高三（7）班' })).toBe('');
    expect(registrationError({ ...valid, className: '高一（8）班' })).not.toBe('');
  });
  it.each([{ name: ' ' }, { studentId: ' ' }, { studentId: 'G2026 01' }, { gender: null }, { className: '' }, { className: '讲授班' }, { password: '123' }, { password: '中'.repeat(25) }])('rejects incomplete or invalid fields: %o', (change) => {
    expect(registrationError({ ...valid, ...change })).not.toBe('');
  });
  it('standardizes school prefixes but preserves old test accounts', () => {
    expect(normalizeStudentId(' g20260001 ')).toBe('G20260001');
    expect(normalizeStudentId(' user1 ')).toBe('user1');
    expect(normalizeStudentId('OldAccount')).toBe('OldAccount');
  });
  it('uses one neutral login for both classes with a clear registration exit', () => {
    const html = renderToStaticMarkup(<Login language="zh" onLoginSuccess={() => {}} onNavigateToRegister={() => {}} />);
    expect(html).toContain('第一次来？创建账号');
    expect(html).toContain('显示密码');
    expect(html).not.toContain('PROJECT DECONSTRUCTION');
    expect(html).toContain('student-access-layout');
    // Server render has no viewport; the browser mounts desktop decoration only when needed.
    expect(html).not.toContain('retro-terminal');
  });
  it('keeps the restored computer neutral for both teaching groups', () => {
    const html = renderToStaticMarkup(<RetroLearningTerminal language="zh" />);
    expect(html).toContain('retro-computer');
    expect(html).toContain('贪吃蛇');
    expect(html).toContain('SFLS CODING CLASSROOM');
    expect(html).toContain('拖动电脑旋转 · 双击复位');
    expect(html).not.toMatch(/DECONSTRUCT|解构|结构探索者|画像/);
  });
});
