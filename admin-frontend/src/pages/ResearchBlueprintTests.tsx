import { useEffect, useMemo, useState } from 'react';
import { Braces, CheckCircle2, FlaskConical, Plus, Trash2, TriangleAlert } from 'lucide-react';

import { createBlueprintTestCase, parseBlueprintJson, toBlueprintKey } from '../lib/projectBlueprint';
import type { BlueprintNode, BlueprintTestCase, ProjectBlueprintConfig } from '../types';

interface ResearchBlueprintTestsProps {
  config: ProjectBlueprintConfig;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onMutate: (mutate: (draft: ProjectBlueprintConfig) => void) => void;
}

const TEST_CATEGORY_LABELS: Record<BlueprintTestCase['category'], string> = {
  example: '示例行为',
  edge: '边界情况',
  rule: '规则约束',
};

const jsonText = (value: unknown): string => JSON.stringify(value, null, 2) ?? 'null';

export const ResearchBlueprintTests = ({
  config,
  selectedNodeId,
  onSelectNode,
  onMutate,
}: ResearchBlueprintTestsProps) => {
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const selectedNode = config.nodes.find(node => node.id === selectedNodeId) ?? config.nodes[0] ?? null;
  const selectedTest = selectedNode?.tests.find(test => test.id === selectedTestId) ?? selectedNode?.tests[0] ?? null;
  const testSummary = useMemo(() => ({
    total: config.nodes.reduce((sum, node) => sum + node.tests.length, 0),
    uncovered: config.nodes.filter(node => node.required && node.tests.length === 0).length,
  }), [config.nodes]);

  useEffect(() => {
    if (!selectedNode) {
      setSelectedTestId(null);
      return;
    }
    if (!selectedNode.tests.some(test => test.id === selectedTestId)) {
      setSelectedTestId(selectedNode.tests[0]?.id ?? null);
    }
    setFieldError('');
  }, [selectedNode, selectedTestId]);

  const updateNode = (mutate: (node: BlueprintNode) => void) => {
    if (!selectedNode) return;
    onMutate(draft => {
      const node = draft.nodes.find(item => item.id === selectedNode.id);
      if (node) mutate(node);
    });
  };

  const updateTest = (testId: string, mutate: (test: BlueprintTestCase) => void) => {
    updateNode(node => {
      const test = node.tests.find(item => item.id === testId);
      if (test) mutate(test);
    });
  };

  const addTest = () => {
    if (!selectedNode) return;
    let index = selectedNode.tests.length + 1;
    let next = createBlueprintTestCase(index);
    while (selectedNode.tests.some(test => test.id === next.id)) next = createBlueprintTestCase(++index);
    updateNode(node => { node.tests.push(next); });
    setSelectedTestId(next.id);
  };

  const parseJsonField = (testId: string, field: 'inputData' | 'expectedData', raw: string) => {
    try {
      const value = parseBlueprintJson(raw);
      updateTest(testId, test => { test[field] = value; });
      setFieldError('');
    } catch {
      setFieldError(`${field === 'inputData' ? '测试输入' : '预期结果'}不是有效 JSON，请检查引号、逗号和括号。`);
    }
  };

  if (!selectedNode) {
    return (
      <section className="blueprint-editor-section">
        <div className="blueprint-empty-callout">
          <FlaskConical />
          <strong>先在第 02 部分建立功能模块</strong>
          <span>每个需要学生建构的模块，都应有明确的函数入口与验证证据。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="blueprint-tests-layout">
      <aside className="blueprint-test-module-rail">
        <div className="blueprint-test-module-rail__summary">
          <span><FlaskConical /> TEST EVIDENCE</span>
          <strong>{testSummary.total}</strong>
          <p>条模块验证证据</p>
          {testSummary.uncovered > 0
            ? <small className="is-warning"><TriangleAlert /> {testSummary.uncovered} 个必需模块尚无测试</small>
            : <small><CheckCircle2 /> 必需模块均有验证证据</small>}
        </div>
        <div className="blueprint-test-module-list">
          {config.nodes.map((node, index) => (
            <button
              key={node.id}
              className={selectedNode.id === node.id ? 'is-active' : ''}
              onClick={() => { setFieldError(''); onSelectNode(node.id); }}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{node.titleZh}</strong><small>{node.tests.length ? `${node.tests.length} 条验证证据` : '尚未配置测试'}</small></div>
              <em>{node.tests.length}</em>
            </button>
          ))}
        </div>
      </aside>

      <div className="blueprint-build-contract">
        <div className="blueprint-build-contract__heading">
          <div><p className="blueprint-kicker">BUILD CONTRACT</p><h4>{selectedNode.titleZh}</h4></div>
          <span>{selectedNode.required ? '完整项目必需' : '可选扩展模块'}</span>
        </div>
        <div className="blueprint-build-contract__fields">
          <label>
            <span>学生函数入口</span>
            <textarea
              className="is-code"
              value={selectedNode.contract.functionTemplate}
              onChange={event => updateNode(node => { node.contract.functionTemplate = event.target.value; })}
              placeholder="def move_snake(snake, direction):"
            />
            <small>只提供函数签名与必要注释，不在模板中写出核心实现。</small>
          </label>
          <label>
            <span>可视化行为标识</span>
            <input
              value={selectedNode.visualizationBehaviorKey ?? ''}
              onChange={event => updateNode(node => { node.visualizationBehaviorKey = event.target.value || null; })}
              placeholder="snake.movement"
            />
            <small>把测试通过后的结构化输出映射到左侧项目画面；留空表示只验证数据。</small>
          </label>
        </div>
        <div className="blueprint-build-contract__trace">
          <div><span>IN</span><p>{selectedNode.contract.inputs.join(' · ') || '第 02 部分尚未定义输入'}</p></div>
          <div><span>OUT</span><p>{selectedNode.contract.outputs.join(' · ') || '第 02 部分尚未定义输出'}</p></div>
          <div><span>DONE</span><p>{selectedNode.contract.postconditions.join(' · ') || '第 02 部分尚未定义完成条件'}</p></div>
        </div>
      </div>

      <div className="blueprint-test-workbench">
        <div className="blueprint-test-list-panel">
          <div className="blueprint-subsection__heading">
            <div><strong>验证证据</strong><span>示例、边界与规则共同决定模块是否真正完成</span></div>
            <button onClick={addTest}><Plus /> 添加测试</button>
          </div>
          <div className="blueprint-test-list">
            {selectedNode.tests.map((test, index) => (
              <button key={test.id} className={selectedTest?.id === test.id ? 'is-active' : ''} onClick={() => { setFieldError(''); setSelectedTestId(test.id); }}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{test.labelZh}</strong><small>{TEST_CATEGORY_LABELS[test.category]} · {test.hidden ? '学生不可见' : '可作为示例'}</small></div>
              </button>
            ))}
            {selectedNode.tests.length === 0 && (
              <button className="blueprint-test-empty" onClick={addTest}><FlaskConical /><strong>添加第一条验证证据</strong><span>优先覆盖核心行为，再补充边界和规则。</span></button>
            )}
          </div>
        </div>

        <div className="blueprint-test-editor">
          {selectedTest ? (
            <>
              <div className="blueprint-test-editor__topline">
                <div><Braces /><span>TEST CASE / {selectedTest.id}</span></div>
                <button onClick={() => {
                  updateNode(node => { node.tests = node.tests.filter(test => test.id !== selectedTest.id); });
                  setSelectedTestId(null);
                }}><Trash2 /> 删除</button>
              </div>
              {fieldError && <div className="blueprint-inline-error"><TriangleAlert /> {fieldError}</div>}
              <div className="blueprint-form-grid">
                <label className="span-2"><span>验证目标</span><input value={selectedTest.labelZh} onChange={event => updateTest(selectedTest.id, test => { test.labelZh = event.target.value; })} /></label>
                <label><span>测试标识</span><input key={selectedTest.id} defaultValue={selectedTest.id} onBlur={event => {
                  const normalized = toBlueprintKey(event.target.value, selectedTest.id);
                  if (selectedNode.tests.some(test => test.id !== selectedTest.id && test.id === normalized)) {
                    setFieldError(`测试标识“${normalized}”已存在。`);
                    event.currentTarget.value = selectedTest.id;
                    return;
                  }
                  updateTest(selectedTest.id, test => { test.id = normalized; });
                  setSelectedTestId(normalized);
                  setFieldError('');
                }} /></label>
                <label><span>证据类别</span><select value={selectedTest.category} onChange={event => updateTest(selectedTest.id, test => { test.category = event.target.value as BlueprintTestCase['category']; })}>
                  {Object.entries(TEST_CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label><span>测试输入（JSON）</span><textarea className="is-code is-json" key={`${selectedNode.id}-${selectedTest.id}-input`} defaultValue={jsonText(selectedTest.inputData)} onBlur={event => parseJsonField(selectedTest.id, 'inputData', event.target.value)} /></label>
                <label><span>预期结果（JSON）</span><textarea className="is-code is-json" key={`${selectedNode.id}-${selectedTest.id}-expected`} defaultValue={jsonText(selectedTest.expectedData)} onBlur={event => parseJsonField(selectedTest.id, 'expectedData', event.target.value)} /></label>
              </div>
              <label className="blueprint-test-visibility">
                <input type="checkbox" checked={selectedTest.hidden} onChange={event => updateTest(selectedTest.id, test => { test.hidden = event.target.checked; })} />
                <span><strong>对学生隐藏输入与预期结果</strong><small>关闭后可在未来作为公开示例，但仍不会自动展示完整实现代码。</small></span>
              </label>
            </>
          ) : (
            <div className="blueprint-test-editor__empty"><FlaskConical /><strong>选择或添加一条验证证据</strong><span>系统只返回可观察的通过/失败信息，不向学生泄露隐藏数据。</span></div>
          )}
        </div>
      </div>
    </section>
  );
};
