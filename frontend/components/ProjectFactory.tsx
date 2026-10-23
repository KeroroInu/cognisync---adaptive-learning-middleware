import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Blocks,
  CircleDot,
  ClipboardList,
  Code2,
  Eye,
  Gamepad2,
  GitBranch,
  Lightbulb,
  ListChecks,
  PencilLine,
  Play,
  Radio,
  Save,
  Trash2,
} from 'lucide-react';
import type { Language, User } from '../types';
import {
  formatSnakeEvidence,
  hasProjectRun,
  type ProjectStage,
  type SnakeRuntimeEvidence,
} from '../data/snakeProjectBlueprint';
import type { ScaffoldCompletion } from './ProjectScaffoldAssistant';
import { createRequestId, observationArtifacts, type ReportKeyMoment } from '../services/stageEvents';
import './ProjectFactory.css';

export type { ProjectStage } from '../data/snakeProjectBlueprint';

interface FactoryHeaderProps {
  language: Language;
  experimentGroup: User['experimentGroup'];
  activeStage: ProjectStage;
  onStageChange: (stage: ProjectStage) => void;
  onOpenProject: () => void;
  onOpenAssistant: () => void;
  onOpenClassTask: () => void;
  onReturnToPreparation: () => void;
  saveLabel: string;
}

interface ObservationStageProps {
  language: Language;
  storageScope: string;
  evidence: SnakeRuntimeEvidence[];
  scaffoldCompletion: ScaffoldCompletion | null;
  onOpenProject: () => void;
  onContinue: () => void;
  onCardCountChange: (count: number) => void;
  onReportKeyMoment?: ReportKeyMoment;
}

interface StagePreviewProps {
  language: Language;
  stage: Extract<ProjectStage, 'model' | 'plan'>;
  onBack: () => void;
  onContinue: () => void;
}

const STAGES: Array<{
  id: ProjectStage;
  zh: string;
  en: string;
  shortZh: string;
  shortEn: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'observe', zh: '运行与观察', en: 'Run & observe', shortZh: '观察', shortEn: 'Observe', icon: Eye },
  { id: 'decompose', zh: '功能拆解', en: 'Decompose', shortZh: '拆功能', shortEn: 'Functions', icon: Blocks },
  { id: 'model', zh: '关系建模', en: 'Model relations', shortZh: '理关系', shortEn: 'Relations', icon: GitBranch },
  { id: 'plan', zh: '实现规划', en: 'Plan', shortZh: '定路径', shortEn: 'Plan', icon: ListChecks },
  { id: 'build', zh: '编码验证', en: 'Build & verify', shortZh: '再建构', shortEn: 'Build', icon: Code2 },
];

const PDT_STAGE_IDS = new Set<ProjectStage>(['observe', 'decompose', 'model', 'build']);

export interface StudentObservationCard {
  id: string;
  evidenceId: string;
  evidenceText: string;
  observationText: string;
  source: 'student' | 'ai-assisted';
  createdAt: string;
  updatedAt?: string;
  provenance?: {
    kind: 'runtime-record' | 'student-note' | 'ai-assisted';
    studentNote: string;
    aiRequestId?: string;
    originalAiDraft?: string;
    confirmedAt: string;
  };
}

export const ProjectFactoryHeader: React.FC<FactoryHeaderProps> = ({
  language,
  experimentGroup,
  activeStage,
  onStageChange,
  onOpenProject,
  onOpenAssistant,
  onOpenClassTask,
  onReturnToPreparation,
  saveLabel,
}) => {
  const isZh = language === 'zh';
  const visibleStages = experimentGroup === 'pdt'
    ? STAGES.filter(stage => PDT_STAGE_IDS.has(stage.id))
    : STAGES.filter(stage => stage.id === 'build');

  return (
    <header className="project-factory-header">
      <nav
        className="project-stage-rail"
        aria-label={isZh ? '项目阶段' : 'Project stages'}
        style={{ '--project-stage-count': visibleStages.length } as React.CSSProperties}
      >
        {visibleStages.map(stage => {
          const Icon = stage.icon;
          const active = stage.id === activeStage;
          const isFunctionFlow = experimentGroup === 'pdt' && stage.id === 'model';
          return (
            <button
              key={stage.id}
              type="button"
              className={active ? 'is-active' : ''}
              onClick={() => onStageChange(stage.id)}
              aria-current={active ? 'step' : undefined}
            >
              <Icon size={15} />
              <strong>{experimentGroup !== 'pdt' ? (isZh ? '编程工作台' : 'Coding workspace') : isFunctionFlow ? (isZh ? '画流程' : 'Flow') : (isZh ? stage.shortZh : stage.shortEn)}</strong>
            </button>
          );
        })}
      </nav>

      <div className="project-factory-tools">
        <span className="project-save-indicator" title={saveLabel} role="status">
          <Save size={16} />
          <span>{saveLabel}</span>
        </span>
        <button
          type="button"
          className="project-class-task-button"
          onClick={onOpenClassTask}
          title={isZh ? '查看课堂任务' : 'View class task'}
          aria-label={isZh ? '查看课堂任务' : 'View class task'}
        >
          <ClipboardList size={18} />
        </button>
        {experimentGroup !== 'lecture' && (
          <button type="button" className="project-hint-button" onClick={onOpenAssistant} aria-label={isZh ? '打开学习助手' : 'Open learning assistant'} title={isZh ? '打开学习助手' : 'Open learning assistant'}>
            <Lightbulb size={17} />
            <span>{isZh ? '问 AI' : 'Ask AI'}</span>
          </button>
        )}
        <button type="button" className="project-demo-button" onClick={onOpenProject} aria-label={isZh ? '打开示例游戏' : 'Open example game'} title={isZh ? '查看示例，不会运行或修改你的代码' : 'View the example without running or changing your code'}>
          <Gamepad2 size={17} />
          <span>{isZh ? '打开示例' : 'Open example'}</span>
        </button>
        <button
          type="button"
          className="project-return-button"
          onClick={onReturnToPreparation}
          title={isZh ? '返回准备区，不会退出登录' : 'Back to preparation without signing out'}
          aria-label={isZh ? '返回准备区' : 'Back to preparation'}
        >
          <ArrowLeft size={18} /><span>{isZh ? '返回' : 'Back'}</span>
        </button>
      </div>
    </header>
  );
};

export const ProjectObservationStage: React.FC<ObservationStageProps> = ({
  language,
  storageScope,
  evidence,
  scaffoldCompletion,
  onOpenProject,
  onContinue,
  onCardCountChange,
  onReportKeyMoment,
}) => {
  const isZh = language === 'zh';
  const storageKey = `cognisync:project-observation-cards:v2:${storageScope}`;
  const [cards, setCards] = useState<StudentObservationCard[]>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftSource, setDraftSource] = useState<'student' | 'ai-assisted'>('student');
  const [saving, setSaving] = useState(false);
  const [observationHint, setObservationHint] = useState<number | null>(null);
  const observationActions = isZh ? [
    ['转一次方向', '先向前走，再按另一个方向。哪些按键能改变方向？'],
    ['吃到一个食物', '看看蛇身、分数和食物的位置，各有什么变化。'],
    ['碰到边界', '蛇头到达边界时，游戏会怎样？'],
    ['重新开始', '对比重开前后：哪些东西变回去了？'],
  ] : [
    ['Try turning', 'Move forward, then try another direction. Which keys change it?'],
    ['Eat some food', 'Notice the snake length, score and food position.'],
    ['Reach an edge', 'What happens when the head reaches the edge?'],
    ['Restart', 'Compare before and after: what changes back?'],
  ];
  const [aiOrigin, setAiOrigin] = useState<{aiRequestId?: string; originalAiDraft?: string}>({});
  const consumedCompletionRef = useRef<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(cards));
    onCardCountChange(cards.length);
  }, [cards, onCardCountChange, storageKey]);

  useEffect(() => {
    if (!scaffoldCompletion || consumedCompletionRef.current === scaffoldCompletion.requestId) return;
    consumedCompletionRef.current = scaffoldCompletion.requestId;
    setSelectedEvidenceId(scaffoldCompletion.evidenceId ?? '');
    setDraft(scaffoldCompletion.text);
    setDraftSource('ai-assisted');
    setAiOrigin({aiRequestId: scaffoldCompletion.requestId, originalAiDraft: scaffoldCompletion.text});
  }, [scaffoldCompletion]);

  const hasOpenedProject = hasProjectRun(evidence);
  const visibleEvidence = useMemo(() => evidence.slice(-8).reverse(), [evidence]);
  const selectedEvidence = evidence.find(item => item.id === selectedEvidenceId);
  const editingCard = cards.find(item => item.id === editingId && item.evidenceId === selectedEvidenceId);
  // A saved citation stays editable after the rolling runtime buffer evicts its event.
  const selectedEvidenceText = selectedEvidence ? formatSnakeEvidence(selectedEvidence, language) : editingCard?.evidenceText;

  const selectEvidence = (id: string) => {
    setSelectedEvidenceId(id);
  };

  const resetDraft = () => {
    setEditingId(null);
    setSelectedEvidenceId('');
    setDraft('');
    setDraftSource('student');
    setAiOrigin({});
  };

  const editObservation = (card: StudentObservationCard) => {
    if (saving) return;
    setEditingId(card.id);
    setSelectedEvidenceId(card.evidenceId);
    setDraft(card.provenance?.studentNote ?? card.observationText);
    setDraftSource(card.source);
    setAiOrigin({aiRequestId: card.provenance?.aiRequestId, originalAiDraft: card.provenance?.originalAiDraft});
    window.requestAnimationFrame(() => {
      document.querySelector('.observation-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const saveObservation = async () => {
    const text = draft.trim();
    if (!selectedEvidenceText || saving) return;
    const now = new Date().toISOString();
    const origin = draftSource === 'ai-assisted' && text ? 'ai-assisted' : text ? 'student-note' : 'runtime-record';
    const card: StudentObservationCard = {
      id: editingId ?? `observation-${createRequestId()}`,
      evidenceId: selectedEvidenceId,
      evidenceText: selectedEvidenceText,
      observationText: text || selectedEvidenceText,
      source: origin === 'ai-assisted' ? 'ai-assisted' : 'student',
      updatedAt: now,
      provenance: {kind: origin, studentNote: text, ...(origin === 'ai-assisted' ? aiOrigin : {}), confirmedAt: now},
      createdAt: editingId
        ? cards.find(item => item.id === editingId)?.createdAt ?? new Date().toISOString()
        : now,
    };
    const next = editingId ? cards.map(item => item.id === editingId ? card : item) : [...cards, card];
    // Commit the local snapshot before the shared reporter flushes it to the server.
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setCards(next);
    setSaving(true);
    try {
      const recorded = await onReportKeyMoment?.({stage: 'observe', eventType: 'structure_change',
        detail: {action: editingId ? 'observation_revised' : 'observation_confirmed', cardId: card.id, provenance: origin},
        artifacts: observationArtifacts([card], 'structure_edit')});
      // Keep the card selected on a failed delivery, so retry uses the same stable artifact.
      if (recorded === false) setEditingId(card.id);
      else resetDraft();
    } finally { setSaving(false); }
  };

  const deleteObservation = async (card: StudentObservationCard) => {
    if (saving) return;
    setSaving(true);
    try {
      const artifacts = observationArtifacts([card], 'structure_edit').map(item => ({...item,
        content: {...item.content, deleted: true, deletedAt: new Date().toISOString()}}));
      const recorded = await onReportKeyMoment?.({stage: 'observe', eventType: 'structure_change',
        detail: {action: 'observation_deleted', cardId: card.id}, artifacts});
      if (recorded === false) return;
      setCards(current => current.filter(item => item.id !== card.id));
      if (editingId === card.id) resetDraft();
    } finally { setSaving(false); }
  };

  return (
    <section className="project-observation-stage">
      <div className="observation-work-column">
      <article className="project-brief-card">
        <div className="project-brief-kicker">
          <span>{isZh ? '贪吃蛇' : 'Snake'}</span>
          <span className={hasOpenedProject ? 'is-complete' : ''}>
            <CircleDot size={11} />
            {hasOpenedProject ? (isZh ? '已运行' : 'Opened') : (isZh ? '等待运行' : 'Not opened')}
          </span>
        </div>

        <div className="project-brief-copy">
          <h3>{isZh ? '先玩一局，找找变化。' : 'Play a round. Notice what changes.'}</h3>
          <span>
            {isZh
              ? '先发现变化，不用猜函数名称。可以挑一个操作试试。'
              : 'Try turning, eating food and restarting. What changes?'}
          </span>
        </div>

        <button type="button" className="project-run-card" onClick={onOpenProject}>
          <span className="project-run-icon"><Play size={25} fill="currentColor" /></span>
          <span>
            <strong>{isZh ? '开始游戏' : 'Start game'}</strong>
          </span>
          <ArrowRight size={22} />
        </button>

        <div className="observation-try-actions" aria-label={isZh?'可以试试':'Things to try'}>
          {observationActions.map(([label],index)=><button key={label} type="button" aria-pressed={observationHint===index} onClick={()=>setObservationHint(index)}>{label}</button>)}
          {observationHint!==null?<p role="status">{observationActions[observationHint][1]}</p>:null}
        </div>

      </article>

      <article className="observation-capture-card">
        <header>
          <div>
            <h3>{isZh ? '记下你的发现' : 'Your observations'}</h3>
          </div>
        </header>

        <p className="observation-capture-hint">
          {isZh ? '选一条记录直接保存，也可以加一句发现或疑问。' : 'Save a record directly, or add a thought or question.'}
        </p>

        <section className="runtime-evidence-section">
          <div className="runtime-evidence-heading">
            <span><Radio size={14} />{isZh ? '刚才发生了什么' : 'What just happened'}</span>
          </div>
          <div className="runtime-evidence-list">
            {visibleEvidence.length > 0 ? visibleEvidence.map(item => {
              const active = selectedEvidenceId === item.id;
              return (
              <button
                key={item.id}
                type="button"
                className={active ? 'is-selected' : ''}
                onClick={() => selectEvidence(item.id)}
                aria-pressed={active}
              >
                <span>{new Date(item.timestamp).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <p>{formatSnakeEvidence(item, language)}</p>
              </button>
              );
            }) : (
              <div className="runtime-evidence-empty">
                <Gamepad2 size={22} />
                <span>{isZh ? '玩过游戏后，这里会出现操作记录。' : 'Your game actions will appear here after you play.'}</span>
              </div>
            )}
          </div>
        </section>

        <section className="observation-composer">
          <div className="observation-composer-title">
            <span><PencilLine size={14} />{isZh ? '我的发现' : 'My observation'}</span>
            {draftSource === 'ai-assisted' && <small>{isZh ? 'AI辅助草稿' : 'AI-assisted draft'}</small>}
          </div>
          <div className="observation-source-line">
            <strong>{isZh ? '选中记录' : 'Selected record'}</strong>
            <span>{selectedEvidenceText || (isZh ? '请先选择上方的一条运行记录' : 'Choose one runtime record above')}</span>
          </div>
          <label>
            <span>{isZh ? '我的想法（选填）' : 'My thought (optional)'}</span>
            <textarea
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                if (draftSource === 'ai-assisted') setDraftSource('ai-assisted');
              }}
              maxLength={100}
              rows={2}
              placeholder={isZh ? '不用重复记录。有什么发现、猜想或想问的？' : 'No need to repeat the record. Any thought, prediction or question?'}
            />
          </label>
          <div className="observation-composer-actions">
            <small>{draft.length}/100</small>
            <div>
              {editingId && <button type="button" className="is-secondary" onClick={resetDraft}>{isZh ? '取消修改' : 'Cancel'}</button>}
              <button type="button" disabled={!selectedEvidenceText || saving || (!editingId && cards.length >= 40)} onClick={() => void saveObservation()}>
                {saving ? (isZh ? '正在保存…' : 'Saving…') : editingId ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '保存观察卡' : 'Save observation')}<ArrowRight size={15} />
              </button>
            </div>
          </div>
          {cards.length >= 40 && !editingId && <small>{isZh ? '已保存40张，可以修改或整理已有卡片。' : '40 cards saved. Edit or organize the existing cards.'}</small>}
        </section>

      </article>
      </div>

      <article className="observation-summary-card" aria-label={isZh ? '我的观察卡' : 'My observations'}>
        <header><h3><ClipboardList size={18} />{isZh ? '我的观察卡' : 'My observations'}</h3>
          <span className="observation-saved-count" role="status">{isZh ? `已保存 ${cards.length} 条` : `${cards.length} saved`}</span>
        </header>
        {cards.length > 0 ? (
          <section className="saved-observation-list">
            <div>
              {cards.map((card, index) => (
                <article key={card.id} aria-label={`${isZh ? '观察卡' : 'Observation'} ${index + 1}`}>
                  <span className="observation-card-rank">{String(index + 1).padStart(2, '0')}</span>
                  <p tabIndex={0}>{card.observationText}</p>
                  {card.source === 'ai-assisted' && <small>{isZh ? 'AI辅助' : 'AI-assisted'}</small>}
                  {card.provenance?.kind === 'runtime-record' && <small>{isZh ? '运行记录' : 'Runtime record'}</small>}
                  <span className="observation-card-rank observation-card-corner" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div className="saved-observation-actions">
                    <button type="button" disabled={saving} onClick={() => editObservation(card)} aria-label={isZh ? '修改观察卡' : 'Edit observation'}><PencilLine size={13} /></button>
                    <button type="button" disabled={saving} onClick={() => void deleteObservation(card)} aria-label={isZh ? '删除观察卡' : 'Delete observation'}><Trash2 size={13} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : <p className="observation-empty-summary">{isZh ? '保存后，你的发现会放在这里。' : 'Your saved observations will appear here.'}</p>}

        <div className="observation-evidence-strip">
          <div>
            <CircleDot size={17} />
            <p>
              <strong>{hasOpenedProject && cards.length >= 2 ? (isZh ? '可以继续了' : 'Ready to continue') : (isZh ? '接下来' : 'Next')}</strong>
              <span>
                {!hasOpenedProject
                  ? (isZh ? '先玩过游戏，再保存两条发现' : 'Play the game and save two observations')
                  : cards.length < 2
                    ? (isZh ? `再保存 ${2 - cards.length} 条发现` : `Save ${2 - cards.length} more observation(s)`)
                    : (isZh ? '从你的发现出发，想想游戏需要哪些功能' : 'Use your observations to identify the game’s functions')}
              </span>
            </p>
          </div>
          <button type="button" disabled={!hasOpenedProject || cards.length < 2} onClick={onContinue}>
            {isZh ? '下一步：拆功能' : 'Next: identify functions'}
            <ArrowRight size={17} />
          </button>
        </div>
      </article>
    </section>
  );
};

const PREVIEW_CONTENT = {
  model: {
    code: '03 / RELATION MAP',
    zhTitle: '用流程图表达你推测的实现关系',
    enTitle: 'Express your implementation hypothesis as a flow',
    zhBody: '只提供基础图形，不提供贪吃蛇的现成流程；由你连接处理、判断、循环和结果。',
    enBody: 'Only primitive shapes are provided; you connect processes, decisions, loops and results.',
    itemsZh: ['开始/结束', '输入/输出', '处理', '判断', '循环'],
    itemsEn: ['Start/end', 'Input/output', 'Process', 'Decision', 'Loop'],
  },
  plan: {
    code: '04 / BUILD PLAN',
    zhTitle: '把流程变成可验证的建构计划',
    enTitle: 'Turn the flow into a verifiable build plan',
    zhBody: '为每张功能卡确定函数契约、实现顺序和测试，AI只在你请求时逐级提示。',
    enBody: 'Define the function contract, build order and test for each card. AI scaffolds only when requested.',
    itemsZh: ['函数输入', '处理规则', '返回结果', '测试条件', '实现顺序'],
    itemsEn: ['Function input', 'Rule', 'Return value', 'Test condition', 'Build order'],
  },
};

export const ProjectStagePreview: React.FC<StagePreviewProps> = ({
  language,
  stage,
  onBack,
  onContinue,
}) => {
  const isZh = language === 'zh';
  const content = PREVIEW_CONTENT[stage];
  const items = isZh ? content.itemsZh : content.itemsEn;

  return (
    <section className={`project-stage-preview is-${stage}`}>
      <header>
        <span>{content.code}</span>
        <h3>{isZh ? content.zhTitle : content.enTitle}</h3>
        <p>{isZh ? content.zhBody : content.enBody}</p>
      </header>
      <div className="project-preview-board">
        {items.map((item, index) => (
          <article key={item} style={{ '--preview-index': index } as React.CSSProperties}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{item}</strong>
            <i><CircleDot size={15} /></i>
          </article>
        ))}
      </div>
      <footer>
        <button type="button" onClick={onBack}>{isZh ? '返回上一步' : 'Back'}</button>
        <span>{isZh ? '当前展示空白任务结构，不包含教师隐藏蓝图答案。' : 'This shows the blank task structure without hidden blueprint answers.'}</span>
        <button type="button" className="is-primary" onClick={onContinue}>
          {isZh ? '进入下一阶段' : 'Next stage'}<ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
};
