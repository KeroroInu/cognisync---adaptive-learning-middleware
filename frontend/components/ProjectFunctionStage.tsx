import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Check,
  ClipboardList,
  Eye,
  HelpCircle,
  PencilLine,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type { FunctionCoverageResponse, FunctionMappingSuggestion, Language } from '../types';
import { checkResearchFunctionCoverage } from '../services/api';
import type { StudentObservationCard } from './ProjectFactory';
import './ProjectFunctionStage.css';

interface Props {
  language: Language;
  taskId: string;
  onBack: () => void;
  onContinue: () => void;
  onCardCountChange?: (count: number) => void;
}

/**
 * 学生功能卡。
 *
 * 2026-08-24 裁定后，新建卡片只保留三项内容：引用的观察卡、学生命名的功能、
 * 一句「这个功能如何实现」。`input` / `output` / `knowledge` / `verification` /
 * `boundaryReason` / `responsibilityOwner` / `mappingDecision` 是旧版字段，
 * **保留在类型里只为读取历史工作区和历史研究产物**，新流程不再采集，
 * 也不得通过迁移删除已有数据。
 */
export interface StudentFunctionCard {
  id: string;
  observationId: string;
  evidenceId?: string;
  observationText: string;
  /** 学生为这个现象命名的功能 */
  responsibility: string;
  /** 一句「这个功能如何实现」；旧卡可能没有 */
  implementation?: string;
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

/** 淡化模板：只给句式骨架，不规定内容 */
const IMPLEMENTATION_TEMPLATE = {
  zh: '先……；当……时……；最后……',
  en: 'First…; when…; finally…',
};

/** 少量快捷插入短语，点击后插入光标位置 */
const QUICK_PHRASES = {
  zh: ['读取按键', '判断条件', '更新坐标', '修改列表', '返回结果'],
  en: ['read the key', 'check a condition', 'update coordinates', 'change the list', 'return a result'],
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
  const [implementation, setImplementation] = useState('');
  const [coverage, setCoverage] = useState<FunctionCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState('');
  const implementationRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(functionStorageKey, JSON.stringify(cards));
    onCardCountChange?.(cards.length);
  }, [cards, functionStorageKey, onCardCountChange]);

  const selectedObservation = useMemo(
    () => observations.find(item => item.id === selectedObservationId),
    [observations, selectedObservationId],
  );

  const unreferencedObservationCount = useMemo(() => {
    const referenced = new Set(cards.map(card => card.observationId));
    return observations.filter(item => !referenced.has(item.id)).length;
  }, [cards, observations]);

  /**
   * 对照冻结蓝图检查七个基础功能的覆盖情况。
   *
   * 按规则匹配，不调用模型；只在学生保存/删除卡片或主动点击重新检查时请求一次，
   * 不随输入实时触发，避免 40—50 人课堂里形成持续写入。
   */
  const runCoverageCheck = useCallback(async (nextCards: StudentFunctionCard[]) => {
    if (nextCards.length === 0) {
      setCoverage(null);
      setCoverageError('');
      return;
    }
    setCoverageLoading(true);
    setCoverageError('');
    const referenced = new Set(nextCards.map(card => card.observationId));
    try {
      const result = await checkResearchFunctionCoverage(taskId, {
        cards: nextCards.map(card => ({
          card_id: card.id,
          responsibility: card.responsibility,
          implementation: card.implementation ?? '',
          observation_text: card.observationText,
        })),
        unreferenced_observation_count: observations.filter(item => !referenced.has(item.id)).length,
      });
      setCoverage(result);
    } catch {
      setCoverage(null);
      setCoverageError(isZh
        ? '功能覆盖检查暂时不可用，你的功能卡已经保存，可以稍后再检查。'
        : 'The coverage check is unavailable right now. Your cards are saved; retry later.');
    } finally {
      setCoverageLoading(false);
    }
  }, [isZh, observations, taskId]);

  const canSave = Boolean(selectedObservation && responsibility.trim() && implementation.trim());

  const resetDraft = () => {
    setEditingId(null);
    setSelectedObservationId('');
    setResponsibility('');
    setImplementation('');
  };

  /** 在光标位置插入快捷短语，不覆盖学生已经写下的内容 */
  const insertPhrase = (phrase: string) => {
    const field = implementationRef.current;
    if (!field) {
      setImplementation(current => `${current}${phrase}`);
      return;
    }
    const start = field.selectionStart ?? implementation.length;
    const end = field.selectionEnd ?? implementation.length;
    const next = `${implementation.slice(0, start)}${phrase}${implementation.slice(end)}`;
    setImplementation(next.slice(0, 120));
    window.requestAnimationFrame(() => {
      field.focus();
      const caret = Math.min(start + phrase.length, 120);
      field.setSelectionRange(caret, caret);
    });
  };

  const saveCard = () => {
    if (!canSave || !selectedObservation) return;
    const now = new Date().toISOString();
    const existing = editingId ? cards.find(item => item.id === editingId) : undefined;
    const nextCard: StudentFunctionCard = {
      // 旧字段保持原值：修改一张历史卡不应该清空它当时保存的内容
      ...existing,
      id: editingId ?? `function-${Date.now()}`,
      observationId: selectedObservation.id,
      evidenceId: selectedObservation.evidenceId,
      observationText: selectedObservation.observationText,
      responsibility: responsibility.trim(),
      implementation: implementation.trim(),
      input: existing?.input ?? '',
      output: existing?.output ?? '',
      knowledge: existing?.knowledge ?? [],
      verification: existing?.verification ?? '',
      source: 'student',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextCards = editingId
      ? cards.map(item => (item.id === editingId ? nextCard : item))
      : [...cards, nextCard].slice(-12);
    setCards(nextCards);
    resetDraft();
    void runCoverageCheck(nextCards);
  };

  const editCard = (card: StudentFunctionCard) => {
    setEditingId(card.id);
    setSelectedObservationId(card.observationId);
    setResponsibility(card.responsibility);
    setImplementation(card.implementation ?? '');
    window.requestAnimationFrame(() => {
      document.querySelector('.function-card-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const removeCard = (id: string) => {
    const nextCards = cards.filter(item => item.id !== id);
    setCards(nextCards);
    if (editingId === id) resetDraft();
    void runCoverageCheck(nextCards);
  };

  const quickPhrases = QUICK_PHRASES[language];

  return (
    <section className="project-function-stage">
      <header className="function-stage-heading">
        <div>
          <span>02 / FUNCTION CARDS</span>
          <h3>{isZh ? '把观察到的现象命名为功能' : 'Name the functions behind what you saw'}</h3>
          <p>
            {isZh
              ? '选一条自己记录的现象，给它命名一个功能，再用一句话说说这个功能大概怎么实现。写短句就够了。'
              : 'Pick one of your observations, name the function behind it, and describe in one sentence how it works.'}
          </p>
        </div>
        <strong>{String(cards.length).padStart(2, '0')}<small>/07</small></strong>
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
                <p><strong>{isZh ? '引用一张观察卡' : 'Choose an observation'}</strong><small>{isZh ? '这张卡是你命名功能的依据' : 'This is the evidence behind your naming'}</small></p>
              </div>
              <div className="function-observation-list">
                {observations.map((observation, index) => {
                  const selected = selectedObservationId === observation.id;
                  const used = cards.some(card => card.observationId === observation.id);
                  return (
                    <button
                      key={observation.id}
                      type="button"
                      className={`${selected ? 'is-selected' : ''} ${used ? 'is-used' : ''}`}
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
                  <strong>{editingId ? (isZh ? '修改功能卡' : 'Edit function card') : (isZh ? '写一张功能卡' : 'Write a function card')}</strong>
                  <small>{isZh ? '只需要一个名称和一句实现描述' : 'Only a name and one sentence'}</small>
                </p>
              </div>

              <div className="function-evidence-quote">
                <Eye size={15} />
                <span>{selectedObservation?.observationText ?? (isZh ? '请先从左侧选择一张观察卡' : 'Choose an observation on the left')}</span>
              </div>

              <label className="function-field is-responsibility">
                <span>{isZh ? '我给这个功能起的名字' : 'Function name'}<small>{responsibility.length}/32</small></span>
                <input
                  value={responsibility}
                  onChange={event => setResponsibility(event.target.value)}
                  maxLength={32}
                  placeholder={isZh ? '例如：吃到果实后变长并加分' : 'e.g. grow and score after eating'}
                />
              </label>

              <label className="function-field is-implementation">
                <span>{isZh ? '这个功能如何实现' : 'How this function works'}<small>{implementation.length}/120</small></span>
                <textarea
                  ref={implementationRef}
                  value={implementation}
                  onChange={event => setImplementation(event.target.value.slice(0, 120))}
                  maxLength={120}
                  rows={3}
                  placeholder={IMPLEMENTATION_TEMPLATE[language]}
                />
              </label>

              <div className="function-quick-phrases">
                <small>{isZh ? '可以点一下插入：' : 'Tap to insert:'}</small>
                <div>
                  {quickPhrases.map(phrase => (
                    <button key={phrase} type="button" onClick={() => insertPhrase(phrase)}>{phrase}</button>
                  ))}
                </div>
              </div>

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
              <p><strong>{isZh ? '我的功能卡组' : 'My function cards'}</strong><small>{isZh ? '可以继续修改；接下来会逐张画出内部流程' : 'Editable; next you will draw each function flow'}</small></p>
            </div>

            {cards.length === 0 ? (
              <div className="saved-function-empty"><Boxes size={21} />{isZh ? '选择一条观察并命名功能，第一张功能卡会出现在这里。' : 'Choose an observation and name a function to create your first card.'}</div>
            ) : (
              <div className="saved-function-grid is-simplified">
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
                    {card.implementation
                      ? <p className="saved-function-implementation">{card.implementation}</p>
                      : <p className="saved-function-implementation is-empty">
                          {isZh ? '这张旧卡还没有实现描述，可以点编辑补一句。' : 'This older card has no implementation sentence yet.'}
                        </p>}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="function-coverage-panel" aria-live="polite">
            <header>
              <div><HelpCircle size={15} /><strong>{isZh ? '还有哪些功能没被说到？' : 'Anything still missing?'}</strong></div>
              {coverage && (
                <small>{isZh
                  ? `已对应 ${coverage.covered_total} / ${coverage.required_total} 个基础功能`
                  : `${coverage.covered_total} / ${coverage.required_total} base functions matched`}</small>
              )}
            </header>

            {coverageLoading
              ? <p>{isZh ? '正在核对……' : 'Checking…'}</p>
              : coverageError
                ? <p className="function-coverage-error">{coverageError}</p>
                : coverage
                  ? <ul>{coverage.questions.map(question => <li key={question}>{question}</li>)}</ul>
                  : <p>{isZh ? '保存第一张功能卡后，这里会提示还缺哪些功能。' : 'Save your first card to see what is still missing.'}</p>}

            {cards.length > 0 && (
              <button type="button" onClick={() => void runCoverageCheck(cards)} disabled={coverageLoading}>
                <RotateCcw size={13} />{isZh ? '重新检查一次' : 'Check again'}
              </button>
            )}
            <p className="function-coverage-note">
              {isZh
                ? `提示只告诉你还差几个，不会直接给出功能名称。${unreferencedObservationCount > 0 ? `你还有 ${unreferencedObservationCount} 条观察没有被引用。` : ''}`
                : 'Hints only tell you how many are missing, never the names.'}
            </p>
          </section>
        </>
      )}

      <footer className="function-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回观察' : 'Back to observation'}</button>
        <div><ClipboardList size={15} /><span>{isZh ? '你的命名与修改会作为解构过程证据保存' : 'Your naming and edits are saved as process evidence'}</span></div>
        <button type="button" className="is-primary" disabled={cards.length < 2} onClick={onContinue}>
          {isZh ? '进入功能流程图' : 'Draw function flows'}<ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
};
