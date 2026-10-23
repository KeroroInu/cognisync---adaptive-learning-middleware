import { useEffect, useState } from 'react';
type Installer = { platform: 'windows' | 'mac'; file: string; bytes: number; sha256: string };
export function InstallerDownloads() {
  const [files, setFiles] = useState<Installer[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/downloads/sfls/installers.json', { signal: controller.signal, cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.files) || data.files.length !== 2 || !['windows', 'mac'].every(platform => data.files.some((file: Installer) => file.platform === platform)) || data.files.some((file: Installer) => !/^SFLS-[\d.]+-offline-(windows|mac)\.zip$/.test(file.file) || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error();
      setFiles(data.files);
    }).catch(() => { if (!controller.signal.aborted) setError('安装包暂不可用，请刷新重试。'); });
    return () => controller.abort();
  }, []);
  return <section className="classroom-panel installer-downloads" aria-label="SFLS 离线安装包">
    <div><strong>SFLS 离线安装包</strong><p>老师下载后通过学校平台分发。先解压，再运行 Install。</p></div>
    <div className="installer-download-actions">{files.map(file => <a key={file.platform} href={'/downloads/sfls/' + file.file} download={file.file}>
      <strong>{file.platform === 'windows' ? 'Windows 下载' : 'Mac 下载'}</strong>
      <span>{file.platform === 'windows' ? 'Windows 10/11 · x64' : 'Intel / Apple 芯片'} · {(file.bytes / 1024 / 1024).toFixed(0)} MB</span>
    </a>)}</div>
    {error ? <p role="alert">{error}</p> : !files.length && <p role="status">正在读取安装包…</p>}
    {!!files.length && <details><summary>包含内容与校验</summary><p>包含 SFLS、Node、Python 和 pygame。AI 对话仍需网络与 key；此离线新版请先在一台机房电脑复测。</p>{files.map(file => <p key={file.platform} className="installer-checksum">{file.platform} SHA-256：{file.sha256}</p>)}</details>}
  </section>;
}
