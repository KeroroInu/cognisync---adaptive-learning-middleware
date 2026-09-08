import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AssistantMessage } from '../components/AssistantMessage';

describe('助手消息只展示文本与可复制代码', () => {
  it('保留代码缩进，并将 HTML 当成文本，不执行模型输出', () => {
    const html = renderToStaticMarkup(<AssistantMessage language="zh" text={'先运行看看。\n```python\ndef f():\n    print(1)\n```\n<script>alert(1)</script>'} />);
    expect(html).toContain('复制代码');
    expect(html).toContain('    print(1)');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('不把未闭合代码截断丢失', () => {
    const html = renderToStaticMarkup(<AssistantMessage language="zh" text={'```python\nprint(1)'} />);
    expect(html).toContain('print(1)');
  });
});
