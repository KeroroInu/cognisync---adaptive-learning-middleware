import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { windowsInstaller, StudentInstaller } from '../components/StudentInstaller';
import { ClassroomMaterials } from '../components/ClassroomMaterials';

const win = { platform: 'windows', file: 'SFLS-0.1.13-offline-windows.zip', bytes: 111536187, sha256: 'a'.repeat(64) };
const manifest = { kind: 'offline', version: '0.1.13', files: [win, { ...win, platform: 'mac', file: 'SFLS-0.1.13-offline-mac.zip' }] };
describe('学生 Windows 安装入口', () => {
  it('accepts the current manifest but exposes only the Windows archive', () => {
    expect(windowsInstaller(manifest).file).toBe(win.file);
    expect(windowsInstaller({ ...manifest, version: '0.1.14', files: [{ ...win, file: 'SFLS-0.1.14-offline-windows.zip' }] }).file).toContain('0.1.14');
  });
  it('rejects absent, duplicate, mismatched or unsafe download targets', () => {
    for (const data of [null, {}, { ...manifest, files: [] }, { ...manifest, files: [win, win] }, ...['../private.zip', 'https://evil.test/a.zip', 'SFLS-0.1.12-offline-windows.zip'].map(file => ({ ...manifest, files: [{ ...win, file }] })), { ...manifest, files: [{ ...win, bytes: -1 }] }, { ...manifest, files: [{ ...win, sha256: '' }] }]) expect(() => windowsInstaller(data)).toThrow();
  });
  it('is available before a teacher publishes a task and does not display a Mac installer', () => {
    expect(renderToStaticMarkup(<ClassroomMaterials embedded />)).toContain('安装 SFLS · Windows');
    const html = renderToStaticMarkup(<StudentInstaller />);
    expect(html).toContain('disabled');expect(html).not.toContain('Mac');expect(html).not.toContain('github');
  });
});
