import { describe, expect, it } from 'vitest';
import { receiptFilename } from './receiptFilename';

const id = '49f02d3e-d4c0-44a5-91ca-e238494cb4b9';

describe('teacher receipt download filenames', () => {
  it('shows the registered student and material title with the complete receipt ID', () => {
    expect(receiptFilename({ id, student_id: 'G20260001', name: '李同学' }, '第二课 · 完整贪吃蛇'))
      .toBe(`G20260001_李同学_第二课_完整贪吃蛇_${id}.zip`);
  });

  it('uses safe defaults when older receipts have missing display fields', () => {
    expect(receiptFilename({ id })).toBe(`未实名_未填写姓名_课堂任务_${id}.zip`);
    expect(receiptFilename({})).toBe('未实名_未填写姓名_课堂任务_未编号.zip');
  });

  it('removes path separators, controls, bidi marks and unsafe Windows punctuation', () => {
    const filename = receiptFilename({ id, student_id: '../G2026\\0001', name: '李\u202e同学\n\u0000"?*' }, '..\\第二课:<测试>/');
    expect(filename).not.toMatch(/[\\/:*?"<>|\u202e]/);
    expect([...filename].every(character => character.charCodeAt(0) >= 32)).toBe(true);
    expect(filename).not.toContain('..');
    expect(filename).toContain('李_同学');
    expect(filename).toMatch(new RegExp(`_${id}\\.zip$`));
  });

  it('handles Windows reserved names and trailing dots', () => {
    expect(receiptFilename({ id, student_id: 'CON', name: 'NUL.' }, 'LPT1.txt'))
      .toBe(`_CON__NUL__LPT1.txt_${id}.zip`);
  });

  it('limits long Unicode labels without truncating the UUID or breaking a character', () => {
    const filename = receiptFilename({ id, student_id: 'G'.repeat(300), name: '学生'.repeat(100) }, '贪吃蛇功能'.repeat(100));
    expect(new TextEncoder().encode(filename).byteLength).toBeLessThanOrEqual(200);
    expect(filename).toMatch(new RegExp(`_${id}\\.zip$`));
    expect(filename).not.toContain('\ufffd');
  });

  it('normalizes equivalent accents and removes labels made only of punctuation', () => {
    expect(receiptFilename({ id, student_id: '---', name: 'e\u0301' }, '...'))
      .toBe(`未实名_é_课堂任务_${id}.zip`);
  });

  it('never lets a malformed legacy receipt ID create a path or an unbounded filename', () => {
    const filename = receiptFilename({ id: '../../\\'.repeat(100) });
    expect(filename).toBe('未实名_未填写姓名_课堂任务_未编号.zip');
  });
});
