import { describe, expect, it } from 'vitest';
import { parseDrawioMessage, MAX_DIAGRAM_LENGTH } from '../components/DrawioEditor';
import { legacyDiagram } from '../components/TaskDesign';

describe('same-origin draw.io integration', () => {
  const source = {} as Window;
  const message = (patch: object = {}) => ({ source, origin: 'http://localhost:8003', data: JSON.stringify({ event: 'autosave', xml: '<mxGraphModel/>' }), ...patch } as MessageEvent);
  it('accepts only bounded messages from the actual editor window and origin', () => {
    expect(parseDrawioMessage(message(), source, 'http://localhost:8003')?.event).toBe('autosave');
    for (const invalid of [message({source: {}}), message({origin:'https://external.example'}), message({data:'not JSON'}), message({data:'x'.repeat(MAX_DIAGRAM_LENGTH * 3 + 1)})]) {
      expect(parseDrawioMessage(invalid, source, 'http://localhost:8003')).toBeNull();
    }
  });
  it('preserves legacy labels and positions without inserting raw XML', () => {
    const xml = legacyDiagram({revision:1,requirements:'',nodes:[{id:'a',title:'移动<&',purpose:'更新位置',x:12,y:34}],edges:[]});
    expect(xml).toContain('移动&lt;&amp;');
    expect(xml).toContain('x="12" y="34"');
    expect(legacyDiagram({revision:1,requirements:'',nodes:[],edges:[],drawio_xml:'original'})).toBe('original');
  });
});
