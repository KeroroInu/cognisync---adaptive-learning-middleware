import React, { useEffect, useMemo, useState } from 'react';
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
import type { FunctionMappingSuggestion, Language, UserProfile } from '../types';
import { createRequestId, functionCardArtifacts, type ReportKeyMoment } from '../services/stageEvents';
import type { FunctionDiscussionDraft } from '../data/functionDiscussion';
import { FunctionDiscussion } from './FunctionDiscussion';
import type { StudentObservationCard } from './ProjectFactory';
import './ProjectFunctionStage.css';

interface Props {
  language: Language;
  taskId: string;
  storageScope: string;
  userId: string;
  allowAI: boolean;
  onProfileUpdate: (profile: UserProfile) => void;
  onReportKeyMoment: ReportKeyMoment;
  onBack: () => void;
  onContinue: () => void;
  onCardCountChange?: (count: number) => void;
}

/**
 * 学生功能卡。
 *
 * 2026-08-24 裁定后，新建卡片只保留三项内容：引用的观察卡、学生命名的功能、
 * 实现步骤。现在通过卡内对话整理伪代码草稿，学生确认后保存；discussion 保留过程来源。
 * `input` / `output` / `knowledge` / `verification` /
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
  /** 学生确认的短句步骤/伪代码；旧卡可能没有 */
  implementation?: string;
  discussion?: FunctionDiscussionDraft;
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
  storageScope,
  userId,
  allowAI,
  onProfileUpdate,
  onReportKeyMoment,
  onBack,
  onContinue,
  onCardCountChange,
}) => {
  const isZh = language === 'zh';
  const observationStorageKey = `cognisync:project-observation-cards:v2:${storageScope}`;
  const functionStorageKey = `cognisync:project-function-cards:v1:${storageScope}`;
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationStorageKey));
  const [cards, setCards] = useState<StudentFunctionCard[]>(() => readStoredList(functionStorageKey));
  const [selectedObservationId, setSelectedObservationId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const draftStorageKey = `cognisync:function-discussions:v1:${storageScope}`;
  const [drafts, setDrafts] = useState<Record<string, FunctionDiscussionDraft>>(() => {
    try { return JSON.parse(localStorage.getItem(draftStorageKey) || '{}'); } catch { return {}; }
  });
  const [discussionBusy, setDiscussionBusy] = useState(false);
  const draftKey = editingId ?? selectedObservationId;
  const draft = drafts[draftKey];
  const responsibility = draft?.responsibility ?? '';
  const implementation = draft?.implementation ?? '';
  const updateDrafts = (next: Record<string, FunctionDiscussionDraft>) => {
    // Synchronous local snapshot lets stage navigation/close flush the latest discussion.
    localStorage.setItem(draftStorageKey, JSON.stringify(next));
    setDrafts(next);
  };
  const updateDraft = (next: FunctionDiscussionDraft) => updateDrafts({ ...drafts, [draftKey]: next });
  const selectObservation = (id: string) => {
    if (discussionBusy) return;
    setEditingId(null);
    setSelectedObservationId(id);
    if (!drafts[id]) updateDrafts({ ...drafts, [id]: { id: createRequestId(), responsibility: '', implementation: '', messages: [] } });
  };
  const [situationIndex, setSituationIndex] = useState(0);
  const situations = isZh ? ['不按任何键，蛇也会继续向前走。这需要游戏不断做什么？', '重新开始一局时，哪些东西应该回到起点？', '吃到一个食物后，下一个食物应该出现在哪里？'] : ['Without pressing a key, the snake keeps moving. What repeats?', 'What should return to its starting state when restarting?', 'Where should the next food appear after eating?'];

  useEffect(() => {
    window.localStorage.setItem(functionStorageKey, JSON.stringify(cards));
    onCardCountChange?.(cards.length);
  }, [cards, functionStorageKey, onCardCountChange]);

  const selectedObservation = useMemo(
    () => observations.find(item => item.id === selectedObservationId),
    [observations, selectedObservationId],
  );

  const canSave = Boolean(selectedObservation && responsibility.trim() && implementation.trim() && !discussionBusy);

  const resetDraft = () => {
    setEditingId(null);
    setSelectedObservationId('');
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
      source: draft?.acceptedDraftRequestId ? 'ai-assisted' : (existing?.source ?? 'student'),
      discussion: draft,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextCards = editingId
      ? cards.map(item => (item.id === editingId ? nextCard : item))
      : [...cards, nextCard].slice(-12);
    setCards(nextCards);
    localStorage.setItem(functionStorageKey, JSON.stringify(nextCards));
    const nextDrafts = { ...drafts };
    delete nextDrafts[draftKey];
    updateDrafts(nextDrafts);
    void onReportKeyMoment({ stage: 'decompose', eventType: 'structure_change',
      detail: { action: editingId ? 'function_card_updated' : 'function_card_created', cardId: nextCard.id, discussionId: draft?.id, acceptedDraftRequestId: draft?.acceptedDraftRequestId },
      artifacts: functionCardArtifacts([nextCard], 'structure_edit'),
    });
    resetDraft();
  };

  const editCard = (card: StudentFunctionCard) => {
    if (discussionBusy) return;
    setEditingId(card.id);
    setSelectedObservationId(card.observationId);
    updateDrafts({ ...drafts, [card.id]: drafts[card.id] ?? { ...card.discussion, id: card.discussion?.id ?? createRequestId(), responsibility: card.responsibility, implementation: card.implementation ?? '', messages: card.discussion?.messages ?? [] } });
    window.requestAnimationFrame(() => {
      document.querySelector('.function-card-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const removeCard = (id: string) => {
    const nextCards = cards.filter(item => item.id !== id);
    setCards(nextCards);
    if (editingId === id) resetDraft();
  };

  return (
    <section className="project-function-stage">
      <header className="function-stage-heading">
        <div>
          <h3>{isZh ? '这个功能叫什么？' : 'Name this function'}</h3>
          <p>
            {isZh
              ? '从发现出发，用自己的话命名、说步骤。一条观察也能拆出几个功能。'
              : 'Pick one of your observations, name the function behind it, and describe in one sentence how it works.'}
          </p>
        </div>
        <strong>{String(cards.length).padStart(2, '0')}<small>{isZh ? ' 张卡' : ' cards'}</small></strong>
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
                <p><strong>{isZh ? '从一个发现出发' : 'Start from an observation'}</strong><small>{isZh ? '可以再次选择同一条，想到别的功能' : 'Reuse an observation for another function'}</small></p>
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
                      onClick={() => selectObservation(observation.id)}
                      disabled={discussionBusy}
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
              <div className="function-evidence-quote">
                <Eye size={15} />
                <span>{selectedObservation?.observationText ?? (isZh ? '请先从左侧选择一张观察卡' : 'Choose an observation on the left')}</span>
              </div>

              <label className="function-field is-responsibility">
                <span>{isZh ? '功能名称' : 'Function name'}<small>{responsibility.length}/32</small></span>
                <input
                  value={responsibility}
                  onChange={event => { if (draft) updateDraft({ ...draft, responsibility: event.target.value }); }}
                  disabled={!draft || discussionBusy}
                  maxLength={32}
                  placeholder={isZh ? '例如：吃到果实后变长并加分' : 'e.g. grow and score after eating'}
                />
              </label>

              {draft && selectedObservation && <FunctionDiscussion key={draft.id}
                language={language} taskId={taskId} userId={userId} allowAI={allowAI}
                observation={selectedObservation.observationText} draft={draft} onChange={updateDraft}
                onProfileUpdate={onProfileUpdate} onBusyChange={setDiscussionBusy} />}

              <div className="function-composer-actions">
                {editingId && <button type="button" disabled={discussionBusy} onClick={resetDraft}>{isZh ? '取消修改' : 'Cancel'}</button>}
                <button type="button" className="is-primary" disabled={!canSave} onClick={saveCard}>
                  <Save size={15} />
                  {editingId ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '形成一张功能卡' : 'Create function card')}
                </button>
              </div>
            </article>
          </div>

          <div className="function-results-panel">
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
                        <button type="button" disabled={discussionBusy} onClick={() => removeCard(card.id)} aria-label={isZh ? '删除功能卡' : 'Delete function card'}><Trash2 size={14} /></button>
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
              <div><HelpCircle size={15} /><strong>{isZh ? '换个情境想一想' : 'Try another situation'}</strong></div>
            </header>

            <p>{situations[situationIndex]}</p>
            <button type="button" onClick={() => setSituationIndex(i => (i + 1) % situations.length)}><RotateCcw size={13}/>{isZh ? '再想一个情境' : 'Another situation'}</button>
            <p className="function-coverage-note">
              {isZh
                ? '不用凑齐七张卡。开始写代码前，再和老师一起对照本课的实现方案。'
                : 'No need to make seven cards. Compare with the lesson implementation before coding.'}
            </p>
          </section>
          </div>
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
