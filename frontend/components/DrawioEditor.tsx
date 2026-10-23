import { useEffect, useRef, useState, type MutableRefObject } from 'react';

export const EMPTY_DIAGRAM = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
export const MAX_DIAGRAM_LENGTH = 250000;
const EDITOR_PATH = '/drawio/index.html?embed=1&proto=json&spin=1&lang=zh&ui=sketch&libraries=1&noExitBtn=1&saveAndExit=0&configure=1&stealth=1&lockdown=1&plugins=0&pwa=0&gapi=0&od=0&gh=0&gl=0';

export function parseDrawioMessage(event: MessageEvent, source: Window | null, origin: string) {
  if (!source || event.source !== source || event.origin !== origin || typeof event.data !== 'string' || event.data.length > MAX_DIAGRAM_LENGTH * 3) return null;
  try {
    const data = JSON.parse(event.data);
    return data && typeof data === 'object' && typeof data.event === 'string' ? data as { event: string; xml?: string } : null;
  } catch { return null; }
}

export function DrawioEditor({ xml, onChange, onSave, disabled, saveRequest }: { xml: string; onChange: (xml: string) => void; onSave: (xml: string) => Promise<void>; disabled: boolean; saveRequest?: MutableRefObject<(() => void) | null> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ xml, onChange, onSave, disabled }); latest.current = { xml, onChange, onSave, disabled };
  const [available, setAvailable] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!saveRequest) return;
    saveRequest.current = ready ? () => frame.current?.contentWindow?.postMessage(JSON.stringify({ action: 'invokeAction', actionName: 'save' }), window.location.origin) : null;
    return () => { saveRequest.current = null; };
  }, [ready, saveRequest]);
  useEffect(() => {
    const controller = new AbortController(); setAvailable(false); setReady(false); setError('');
    void fetch('/drawio/sfls-vendor.json', { signal: controller.signal }).then(async response => {
      if (!response.ok || !(await response.json()).version) throw new Error('画板资源还没准备好，请联系老师。');
      if (!controller.signal.aborted) setAvailable(true);
    }).catch(() => { if (!controller.signal.aborted) setError('画板暂时无法加载，已保存的设计不会丢失。'); });
    const timer = setTimeout(() => { if (!controller.signal.aborted) setError('画板加载较慢，可以稍后重试。已保存的设计不会丢失。'); }, 20000);
    const receive = (event: MessageEvent) => {
      const data = parseDrawioMessage(event, frame.current?.contentWindow ?? null, window.location.origin);
      if (!data) return;
      const post = (message: unknown) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), window.location.origin);
      if (data.event === 'configure') post({ action: 'configure', config: { defaultLibraries: 'general;flowchart;uml', autosaveDelay: 500, compressXml: false, enabledLibraries: ['general', 'flowchart', 'uml'], defaultFonts: ['Helvetica', 'Arial'], enableCustomLibraries: false } });
      if (data.event === 'init') {
        post({ action: 'load', xml: latest.current.xml || EMPTY_DIAGRAM, autosave: 1, title: '我的设计', noExitBtn: 1, saveAndExit: 0 });
      }
      if (data.event === 'load') { clearTimeout(timer); setReady(true); setError(''); }
      if (data.event === 'save' || data.event === 'autosave') {
        if (typeof data.xml !== 'string' || data.xml.length > MAX_DIAGRAM_LENGTH) { setError('画图内容过大，请减少元素后再保存。'); return; }
        if (latest.current.disabled) return;
        latest.current.onChange(data.xml);
        if (data.event === 'save') void latest.current.onSave(data.xml);
      }
    };
    window.addEventListener('message', receive);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [attempt]);
  return <div className="drawio-host" aria-busy={!ready || disabled}>
    {!ready && !error && <p role="status">正在打开 draw.io 画板…</p>}
    {error && <div role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>重新打开画板</button></div>}
    {available && <iframe key={attempt} ref={frame} title="draw.io 设计画板" src={EDITOR_PATH} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer" style={{ visibility: ready ? 'visible' : 'hidden', pointerEvents: disabled ? 'none' : undefined }} />}
  </div>;
}
