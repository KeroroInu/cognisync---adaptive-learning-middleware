import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SflsGuide, copySflsCommand } from '../components/SflsGuide';
import { ClassroomMaterials } from '../components/ClassroomMaterials';
import { TaskInstructions } from '../components/TaskInstructions';

afterEach(() => vi.unstubAllGlobals());
describe('学生 SFLS 指令指南', () => {
  it('has a guide entry even before a task is published', () => {
    const html = renderToStaticMarkup(<ClassroomMaterials embedded userId="student" />);
    expect(html).toContain('使用指南');
    expect(html).not.toContain('<details class="sfls-guide" open');
  });
  it('separates terminal commands from agent commands and explains safe submission', () => {
    const html = renderToStaticMarkup(<SflsGuide />);
    for (const text of ['在电脑终端输入', '进入 SFLS 后输入', '/submit', '/pack', 'sfls model', 'sfls run --resume', 'sfls login', 'sfls logout', 'sfls doctor', '不会删除本机作品或模型密钥', '不要关闭安全防护']) expect(html).toContain(text);
    expect(html).not.toContain('sfls uninstall --yes');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('copies exactly the command, without explanation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copySflsCommand('/submit')).toBe('已复制');
    expect(writeText).toHaveBeenCalledWith('/submit');
  });
  it('explains automatic task identity, classroom keys and offline setup without another login step', () => {
    const html = renderToStaticMarkup(<SflsGuide />);
    for (const text of ['自动核对身份', '不必再输入学号和密码', '每节课使用老师当堂发放的 key', '老师已停用旧 key', '任务环境会从本机自动准备', '不必另装 pip', '旧任务包备用', '新下载的本人任务包不用执行']) expect(html).toContain(text);
    expect(html).not.toContain('首次按提示登录');
    expect(html).toContain('不要借用上一位同学的文件夹');
  });
  it('distinguishes a generated submission ZIP from an uploaded folder or original task package', () => {
    const html = renderToStaticMarkup(<SflsGuide />);
    for (const text of ['只生成 ZIP、不上传', 'submissions 文件夹里生成的 ZIP 文件', '再点“上传作品”', '不要上传整个文件夹或原任务包', '看到成功提示才算交好']) expect(html).toContain(text);
  });
  it('explains worksheet timing without imposing classroom scaffolding on assessments', () => {
    const practice = renderToStaticMarkup(<TaskInstructions practice hasWorksheet />);
    for (const text of ['README', '根据对话', '想做什么', '具体要求', '实际结果', '不用重新填表', '未验证']) expect(practice).toContain(text);
    const assessment = renderToStaticMarkup(<TaskInstructions practice={false} hasWorksheet={false} />);
    expect(assessment).not.toContain('任务单填什么'); expect(assessment).not.toContain('至少记一次');
    expect(assessment).toContain('按任务要求完成作品');
    const guide = renderToStaticMarkup(<SflsGuide />);
    for (const text of ['/play', '/stop', '0.1.5', '看不到字符', '输入 y', '不要反复重装']) expect(guide).toContain(text);
  });
  it('offers manual copying when clipboard access is unavailable or denied', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copySflsCommand('sfls')).toContain('请选中命令复制');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect(await copySflsCommand('sfls')).toContain('请选中命令复制');
  });
});
