import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

type WindowsInstaller = { file: string; bytes: number; sha256: string };
export function windowsInstaller(data: unknown): WindowsInstaller {
  const manifest = data as { version?: string; kind?: string; files?: Array<WindowsInstaller & { platform?: string }> } | null;
  if (!manifest || manifest.kind !== 'offline' || !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '') || !Array.isArray(manifest.files)) throw new Error('安装包清单不可用');
  const files = manifest.files.filter(file => file?.platform === 'windows');
  const file = files[0];
  if (files.length !== 1 || file.file !== `SFLS-${manifest.version}-offline-windows.zip` || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('安装包清单不可用');
  return { file: file.file, bytes: file.bytes, sha256: file.sha256 };
}

export function StudentInstaller() {
  const [file, setFile] = useState<WindowsInstaller | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 10000);
    setFailed(false);
    void fetch('/downloads/sfls/installers.json', { signal: controller.signal, cache: 'no-cache' })
      .then(async response => { if (!response.ok) throw new Error(); return windowsInstaller(await response.json()); })
      .then(value => { if (active) setFile(value); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [retry]);
  // Native download: do not load a 100+ MiB archive into the page's JS memory.
  if (file) return <a className="studio-installer" href={`/downloads/sfls/${file.file}`} download={file.file} title={`Windows 10/11 · x64 · ${Math.round(file.bytes / 1024 / 1024)} MiB。完整解压后双击 Install.cmd；只需安装一次。`}><Download size={16} aria-hidden="true" />安装 SFLS · Windows</a>;
  return <button className="studio-installer" disabled={!failed} onClick={() => setRetry(value => value + 1)} title={failed ? '安装包暂不可用，点击重试或联系老师。' : '正在读取安装包…'}><Download size={16} aria-hidden="true" />{failed ? '重试安装包下载' : '安装 SFLS · Windows'}</button>;
}
