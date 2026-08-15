import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  Boxes,
  Check,
  ClipboardList,
  Eye,
  Link2,
  PencilLine,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { FunctionMappingSuggestion, Language } from '../types';
import { suggestResearchFunctionMapping } from '../services/api';
import type { StudentObservationCard } from './ProjectFactory';
import './ProjectFunctionStage.css';

interface Props {
  language: Language;
  taskId: string;
  onBack: () => void;
  onContinue: () => void;
  onCardCountChange?: (count: number) => void;
}

export interface StudentFunctionCard {
  id: string;
  observationId: string;
  evidenceId?: string;
  observationText: string;
  responsibility: string;
  input: string;
  output: string;
  knowledge: string[];
  verification: string;
  boundaryReason?: string;
  responsibilityOwner?: 'student-core' | 'ai-supported';
  mappingDecision?: {
    status: 'pending' | 'accepted' | 'rejected' | 'unmapped';
    blueprintVersionId?: string;
    suggestions: FunctionMappingSuggestion[];
    acceptedNodeIds: string[];
    suggestedAt?: string;
    decidedAt?: string;
  };
  source: 'student' | 'ai-assisted';
  createdAt: string;
  updatedAt: string;
}

const KNOWLEDGE_OPTIONS = {
  zh: ['变量', '列表', '条件判断', '循环', '函数', '坐标', '随机数', '布尔值'],
  en: ['Variables', 'Lists', 'Conditionals', 'Loops', 'Functions', 'Coordinates', 'Random values', 'Booleans'],
};

const VERIFICATION_OPTIONS = {
  zh: ['运行后观察变化', '给定输入比较输出', '测试边界情况', '重复运行检查稳定性'],
  en: ['Observe after running', 'Compare output for a given input', 'Test edge cases', 'Repeat to check stability'],
};

const BOUNDARY_REASON_OPTIONS = {
  zh: [
    '它有独立的输入和输出',
    '它有单独的判断或状态变化',
    '它可以单独运行和验证',
    '它会被其他功能重复使用',
  ],
  en: [
    'It has independent inputs and outputs',
    'It owns a separate decision or state change',
    'It can be run and verified independently',
    'Other functions reuse it',
  ],
};

const readStoredList = <T,>(key: string): T[] => {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const ProjectFunctionStage: React.FC<Props> = ({
  language,
  taskId,
  onBack,
  onContinue,
  onCardCountChange,
}) => {
  const isZh = language === 'zh';
  const observationStorageKey = `cognisync:project-observation-cards:v2:${taskId}`;
  const functionStorageKey = `cognisync:project-function-cards:v1:${taskId}`;
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationStorageKey));
  const [cards, setCards] = useState<StudentFunctionCard[]>(() => readStoredList(functionStorageKey));
  const [selectedObservationId, setSelectedObservationId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [responsibility, setResponsibility] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [knowledge, setKnowledge] = useState<string[]>([]);
  const [verification, setVerification] = useState('');
  const [boundaryReason, setBoundaryReason] = useState('');
  const [responsibilityOwner, setResponsibilityOwner] = useState<'student-core' | 'ai-supported'>('student-core');
  const [mappingLoadingId, setMappingLoadingId] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState('');

  useEffect(() => {
    window.localStorage.setItem(functionStorageKey, JSON.stringify(cards));
    onCardCountChange?.(cards.length);
  }, [cards, functionStorageKey, onCardCountChange]);

  const selectedObservation = useMemo(
    () => observations.find(item => item.id === selectedObservationId),
    [observations, selectedObservationId],
  );

  const canSave = Boolean(
    selectedObservation
    && responsibility.trim()
    && input.trim()
    && output.trim()
    && knowledge.length
    && verification
    && boundaryReason.trim()
    && responsibilityOwner
  );

  const resetDraft = () => {
    setEditingId(null);
    setSelectedObservationId('');
    setResponsibility('');
    setInput('');
    setOutput('');
    setKnowledge([]);
    setVerification('');
    setBoundaryReason('');
    setResponsibilityOwner('student-core');
  };

  const toggleKnowledge = (item: string) => {
    setKnowledge(current => (
      current.includes(item)
        ? current.filter(value => value !== item)
        : [...current, item].slice(-4)
    ));
  };

  const requestMapping = async (card: StudentFunctionCard) => {
    setMappingLoadingId(card.id);
    setMappingError('');
    const requestedAt = new Date().toISOString();
    setCards(current => current.map(item => item.id === card.id ? {
      ...item,
      mappingDecision: {
        status: 'pending',
        suggestions: [],
        acceptedNodeIds: [],
        suggestedAt: requestedAt,
      },
    } : item));
    try {
      const result = await suggestResearchFunctionMapping(taskId, {
        observation_text: card.observationText,
        responsibility: card.responsibility,
        boundary_reason: card.boundaryReason ?? '',
        input_text: card.input,
        output_text: card.output,
        knowledge: card.knowledge,
      });
      setCards(current => current.map(item => item.id === card.id ? {
        ...item,
        mappingDecision: {
          status: result.suggestions.length ? 'pending' : 'unmapped',
          blueprintVersionId: result.blueprint_version_id,
          suggestions: result.suggestions,
          acceptedNodeIds: [],
          suggestedAt: requestedAt,
        },
        updatedAt: new Date().toISOString(),
      } : item));
    } catch {
      setCards(current => current.map(item => item.id === card.id ? {
        ...item,
        mappingDecision: {
          status: 'unmapped',
          suggestions: [],
          acceptedNodeIds: [],
          suggestedAt: requestedAt,
          decidedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      } : item));
      setMappingError(isZh
        ? '契约建议暂时未载入，功能卡已保存，可以稍后重试。'
        : 'Mapping suggestions are temporarily unavailable. The card is saved; retry later.');
    } finally {
      setMappingLoadingId(null);
    }
  };

  const saveCard = () => {
    if (!canSave || !selectedObservation) return;
    const now = new Date().toISOString();
    const nextCard: StudentFunctionCard = {
      id: editingId ?? `function-${Date.now()}`,
      observationId: selectedObservation.id,
      evidenceId: selectedObservation.evidenceId,
      observationText: selectedObservation.observationText,
      responsibility: responsibility.trim(),
      input: input.trim(),
      output: output.trim(),
      knowledge,
      verification,
      boundaryReason: boundaryReason.trim(),
      responsibilityOwner,
      mappingDecision: {
        status: 'pending',
        suggestions: [],
        acceptedNodeIds: [],
        suggestedAt: now,
      },
      source: 'student',
      createdAt: editingId
        ? cards.find(item => item.id === editingId)?.createdAt ?? now
        : now,
      updatedAt: now,
    };

    setCards(current => {
      if (editingId) {
        return current.map(item => item.id === editingId ? nextCard : item);
      }
      return [...current, nextCard].slice(-10);
    });
    resetDraft();
    void requestMapping(nextCard);
  };

  const editCard = (card: StudentFunctionCard) => {
    setEditingId(card.id);
    setSelectedObservationId(card.observationId);
    setResponsibility(card.responsibility);
    setInput(card.input);
    setOutput(card.output);
    setKnowledge(card.knowledge);
    setVerification(card.verification);
    setBoundaryReason(card.boundaryReason ?? '');
    setResponsibilityOwner(card.responsibilityOwner ?? 'student-core');
    window.requestAnimationFrame(() => {
      document.querySelector('.function-card-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const removeCard = (id: string) => {
    setCards(current => current.filter(item => item.id !== id));
    if (editingId === id) resetDraft();
  };

  const toggleMappedNode = (cardId: string, nodeId: string) => {
    setCards(current => current.map(card => {
      if (card.id !== cardId || !card.mappingDecision) return card;
      const selected = card.mappingDecision.acceptedNodeIds;
      return {
        ...card,
        mappingDecision: {
          ...card.mappingDecision,
          status: 'pending',
          acceptedNodeIds: selected.includes(nodeId)
            ? selected.filter(id => id !== nodeId)
            : [...selected, nodeId],
          decidedAt: undefined,
        },
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const decideMapping = (
    cardId: string,
    status: 'pending' | 'accepted' | 'rejected' | 'unmapped',
  ) => {
    setCards(current => current.map(card => {
      if (card.id !== cardId || !card.mappingDecision) return card;
      const acceptedNodeIds = status === 'accepted' || status === 'pending'
        ? card.mappingDecision.acceptedNodeIds
        : [];
      if (status === 'accepted' && acceptedNodeIds.length === 0) return card;
      return {
        ...card,
        mappingDecision: {
          ...card.mappingDecision,
          status,
          acceptedNodeIds,
          decidedAt: status === 'pending' ? undefined : new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const knowledgeOptions = KNOWLEDGE_OPTIONS[language];
  const verificationOptions = VERIFICATION_OPTIONS[language];
  const boundaryReasonOptions = BOUNDARY_REASON_OPTIONS[language];

  return (
    <section className="project-function-stage">
      <header className="function-stage-heading">
        <div>
          <span>02 / FUNCTION CARDS</span>
          <h3>{isZh ? '从自己的观察推测程序职责' : 'Infer program responsibilities from your observations'}</h3>
          <p>
            {isZh
              ? '先选择一条自己记录的现象，再说明程序需要承担什么职责。教师蓝图保持隐藏，系统只检查卡片是否完整。'
              : 'Choose one of your observations, then state what responsibility the program needs. The teacher blueprint remains hidden.'}
          </p>
        </div>
        <strong>{String(cards.length).padStart(2, '0')}<small>/02</small></strong>
      </header>

      {observations.length === 0 ? (
        <section className="function-stage-empty">
          <Eye size={32} />
          <h4>{isZh ? '还没有可引用的观察卡' : 'No observation cards yet'}</h4>
          <p>{isZh ? '先返回观察阶段，运行项目并形成至少两条自己的观察。' : 'Return to observation, run the project and save at least two observations.'}</p>
          <button type="button" onClick={onBack}>{isZh ? '返回观察阶段' : 'Return to observation'}</button>
        </section>
      ) : (
        <>
          <div className="function-stage-workspace">
            <aside className="function-observation-source">
              <div className="function-section-label">
                <span>01</span>
                <p><strong>{isZh ? '引用一张观察卡' : 'Choose an observation'}</strong><small>{isZh ? '这张卡是你推测功能的证据' : 'This is the evidence for your inference'}</small></p>
              </div>
              <div className="function-observation-list">
                {observations.map((observation, index) => {
                  const selected = selectedObservationId === observation.id;
                  return (
                    <button
                      key={observation.id}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      onClick={() => setSelectedObservationId(observation.id)}
                      aria-pressed={selected}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <p>{observation.observationText}</p>
                      <i>{selected ? <Check size={14} /> : <Eye size={14} />}</i>
                    </button>
                  );
                })}
              </div>
            </aside>

            <article className="function-card-composer">
              <div className="function-section-label">
                <span>02</span>
                <p>
                  <strong>{editingId ? (isZh ? '修改功能卡' : 'Edit function card') : (isZh ? '补全功能卡' : 'Complete the function card')}</strong>
                  <small>{isZh ? '短句即可，不需要写成长段说明' : 'Short phrases are enough'}</small>
                </p>
              </div>

              <div className="function-evidence-quote">
                <Eye size={15} />
                <span>{selectedObservation?.observationText ?? (isZh ? '请先从左侧选择一张观察卡' : 'Choose an observation on the left')}</span>
              </div>

              <label className="function-field is-responsibility">
                <span>{isZh ? '程序职责' : 'Program responsibility'}<small>{responsibility.length}/32</small></span>
                <input
                  value={responsibility}
                  onChange={event => setResponsibility(event.target.value)}
                  maxLength={32}
                  placeholder={isZh ? '程序需要完成什么事情？' : 'What must the program do?'}
                />
              </label>

              <fieldset className="function-choice-field is-boundary">
                <legend>
                  {isZh ? '为什么它应该成为一个独立功能？' : 'Why should this be a separate function?'}
                  <small>{boundaryReason.length}/64</small>
                </legend>
                <div>
                  {boundaryReasonOptions.map(item => (
                    <button
                      key={item}
                      type="button"
                      className={boundaryReason === item ? 'is-selected' : ''}
                      onClick={() => setBoundaryReason(item)}
                      aria-pressed={boundaryReason === item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <input
                  value={boundaryReason}
                  onChange={event => setBoundaryReason(event.target.value)}
                  maxLength={64}
                  placeholder={isZh ? '也可以用一句自己的话说明功能边界' : 'Or explain the boundary in your own words'}
                />
              </fieldset>

              <fieldset className="function-owner-field">
                <legend>
                  {isZh ? '这部分理解责任属于谁？' : 'Who owns the understanding?'}
                  <small>{isZh ? 'AI 可以协助，但不能替代判断' : 'AI may assist, but not replace judgment'}</small>
                </legend>
                <div>
                  <button
                    type="button"
                    className={responsibilityOwner === 'student-core' ? 'is-selected' : ''}
                    onClick={() => setResponsibilityOwner('student-core')}
                  >
                    <ShieldCheck size={15} />
                    <span><strong>{isZh ? '我必须理解' : 'I must understand'}</strong><small>{isZh ? '核心判断由我完成' : 'I make the core judgment'}</small></span>
                  </button>
                  <button
                    type="button"
                    className={responsibilityOwner === 'ai-supported' ? 'is-selected' : ''}
                    onClick={() => setResponsibilityOwner('ai-supported')}
                  >
                    <Bot size={15} />
                    <span><strong>{isZh ? '可以请 AI 协助' : 'AI may assist'}</strong><small>{isZh ? '我仍负责验证结果' : 'I still verify the result'}</small></span>
                  </button>
                </div>
              </fieldset>

              <div className="function-io-grid">
                <label className="function-field">
                  <span>{isZh ? '输入' : 'Input'}</span>
                  <input
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    maxLength={48}
                    placeholder={isZh ? '它需要接收哪些信息？' : 'What information does it receive?'}
                  />
                </label>
                <label className="function-field">
                  <span>{isZh ? '输出' : 'Output'}</span>
                  <input
                    value={output}
                    onChange={event => setOutput(event.target.value)}
                    maxLength={48}
                    placeholder={isZh ? '完成后产生什么变化？' : 'What change should it produce?'}
                  />
                </label>
              </div>

              <fieldset className="function-choice-field">
                <legend>{isZh ? '可能需要的知识' : 'Possible knowledge'}<small>{isZh ? '最多选 4 项' : 'Choose up to 4'}</small></legend>
                <div>
                  {knowledgeOptions.map(item => (
                    <button
                      key={item}
                      type="button"
                      className={knowledge.includes(item) ? 'is-selected' : ''}
                      onClick={() => toggleKnowledge(item)}
                      aria-pressed={knowledge.includes(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="function-choice-field is-verification">
                <legend>{isZh ? '我准备怎样验证' : 'How I will verify it'}</legend>
                <div>
                  {verificationOptions.map(item => (
                    <button
                      key={item}
                      type="button"
                      className={verification === item ? 'is-selected' : ''}
                      onClick={() => setVerification(item)}
                      aria-pressed={verification === item}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="function-composer-actions">
                {editingId && <button type="button" onClick={resetDraft}>{isZh ? '取消修改' : 'Cancel'}</button>}
                <button type="button" className="is-primary" disabled={!canSave} onClick={saveCard}>
                  <Save size={15} />
                  {editingId ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '形成一张功能卡' : 'Create function card')}
                </button>
              </div>
            </article>
          </div>

          <section className="saved-function-section">
            <div className="function-section-label">
              <span>03</span>
              <p><strong>{isZh ? '我的功能卡组' : 'My function cards'}</strong><small>{isZh ? '可以继续编辑；至少形成 2 张后进入关系建模' : 'Editable; create at least two before modeling relations'}</small></p>
            </div>

            {cards.length === 0 ? (
              <div className="saved-function-empty"><Boxes size={21} />{isZh ? '选择观察并补全右侧内容，第一张功能卡会出现在这里。' : 'Choose an observation and complete the form to create your first card.'}</div>
            ) : (
              <div className="saved-function-grid">
                {cards.map((card, index) => (
                  <article key={card.id}>
                    <header>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <button type="button" onClick={() => editCard(card)} aria-label={isZh ? '编辑功能卡' : 'Edit function card'}><PencilLine size={14} /></button>
                        <button type="button" onClick={() => removeCard(card.id)} aria-label={isZh ? '删除功能卡' : 'Delete function card'}><Trash2 size={14} /></button>
                      </div>
                    </header>
                    <h4>{card.responsibility}</h4>
                    <p className="saved-function-observation"><Eye size={12} />{card.observationText}</p>
                    <dl>
                      <div><dt>{isZh ? '输入' : 'IN'}</dt><dd>{card.input}</dd></div>
                      <div><dt>{isZh ? '输出' : 'OUT'}</dt><dd>{card.output}</dd></div>
                    </dl>
                    <div className="saved-function-boundary">
                      <ShieldCheck size={13} />
                      <span>{card.boundaryReason || (isZh ? '尚未说明功能边界' : 'Boundary not explained')}</span>
                      <strong>{card.responsibilityOwner === 'ai-supported'
                        ? (isZh ? 'AI 可协助' : 'AI assisted')
                        : (isZh ? '学生核心责任' : 'Student owned')}</strong>
                    </div>
                    <div className="saved-function-tags">{card.knowledge.map(item => <span key={item}>{item}</span>)}</div>
                    <footer><BookOpenCheck size={13} />{card.verification}</footer>
                    <section className={`function-mapping-panel is-${card.mappingDecision?.status ?? 'legacy'}`}>
                      <header>
                        <div><Link2 size={14} /><strong>{isZh ? '对应哪项教师契约？' : 'Which teacher contract fits?'}</strong></div>
                        {card.mappingDecision?.blueprintVersionId && <small>{card.mappingDecision.blueprintVersionId.slice(0, 8)}</small>}
                      </header>

                      {mappingLoadingId === card.id ? (
                        <p><Bot size={14} />{isZh ? '正在生成候选，不会直接替你决定。' : 'Finding candidates without deciding for you.'}</p>
                      ) : !card.mappingDecision || card.mappingDecision.status === 'rejected' || card.mappingDecision.status === 'unmapped' ? (
                        <div className="mapping-empty-state">
                          <span>{card.mappingDecision?.status === 'rejected'
                            ? (isZh ? '你拒绝了上一组建议。' : 'You rejected the previous suggestions.')
                            : (isZh ? '当前保持未映射，建构阶段不会自动猜测。' : 'Currently unmapped; the build stage will not guess.')}</span>
                          <button type="button" onClick={() => void requestMapping(card)}><RotateCcw size={13} />{isZh ? '重新获取建议' : 'Retry suggestions'}</button>
                        </div>
                      ) : card.mappingDecision.status === 'accepted' ? (
                        <div className="mapping-accepted-state">
                          <p><ShieldCheck size={14} />{isZh ? '已由你确认：' : 'Confirmed by you:'}</p>
                          <div>{card.mappingDecision.suggestions
                            .filter(item => card.mappingDecision?.acceptedNodeIds.includes(item.node_id))
                            .map(item => <span key={item.node_id}>{item.title_zh}</span>)}</div>
                          <button type="button" onClick={() => decideMapping(card.id, 'pending')}><RotateCcw size={13} />{isZh ? '重新判断' : 'Reconsider'}</button>
                        </div>
                      ) : (
                        <>
                          <p><Bot size={14} />{isZh ? '这是候选，不是答案；可以多选，也可以全部拒绝。' : 'These are candidates, not answers. Select multiple or reject all.'}</p>
                          <div className="mapping-suggestion-list">
                            {card.mappingDecision.suggestions.map(item => {
                              const selected = card.mappingDecision?.acceptedNodeIds.includes(item.node_id);
                              return (
                                <button key={item.node_id} type="button" className={selected ? 'is-selected' : ''} onClick={() => toggleMappedNode(card.id, item.node_id)}>
                                  <i>{selected ? <Check size={13} /> : <Unlink size={13} />}</i>
                                  <span><strong>{item.title_zh}</strong><small>{item.match_reasons.join(' · ')}</small></span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="mapping-decision-actions">
                            <button type="button" onClick={() => decideMapping(card.id, 'rejected')}>{isZh ? '都不符合' : 'Reject all'}</button>
                            <button type="button" onClick={() => decideMapping(card.id, 'unmapped')}>{isZh ? '暂不映射' : 'Leave unmapped'}</button>
                            <button type="button" className="is-primary" disabled={!card.mappingDecision.acceptedNodeIds.length} onClick={() => decideMapping(card.id, 'accepted')}>
                              <Link2 size={13} />{isZh ? '确认我的选择' : 'Confirm selection'}
                            </button>
                          </div>
                        </>
                      )}
                    </section>
                  </article>
                ))}
              </div>
            )}
            {mappingError && <p className="function-mapping-error">{mappingError}</p>}
          </section>
        </>
      )}

      <footer className="function-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回观察' : 'Back to observation'}</button>
        <div><ClipboardList size={15} /><span>{isZh ? '你的选择与修改会作为解构过程证据保存' : 'Your choices and edits are saved as process evidence'}</span></div>
        <button type="button" className="is-primary" disabled={cards.length < 2} onClick={onContinue}>
          {isZh ? '进入关系建模' : 'Continue to relations'}<ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
};
