import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  CircleDot,
  ClipboardList,
  Code2,
  Eye,
  Gamepad2,
  GitBranch,
  Lightbulb,
  ListChecks,
  MousePointer2,
  PencilLine,
  Play,
  Radio,
  Save,
  Trash2,
} from 'lucide-react';
import type { Language, User } from '../types';
import {
  formatSnakeEvidence,
  type ProjectStage,
  type SnakeRuntimeEvidence,
} from '../data/snakeProjectBlueprint';
import type { ScaffoldCompletion } from './ProjectScaffoldAssistant';
import './ProjectFactory.css';

export type { ProjectStage } from '../data/snakeProjectBlueprint';

interface FactoryHeaderProps {
  language: Language;
  taskTitle: string;
  experimentGroup: User['experimentGroup'];
  activeStage: ProjectStage;
  onExit: () => void;
  onStageChange: (stage: ProjectStage) => void;
  onOpenProject: () => void;
  onOpenAssistant: () => void;
  saveLabel: string;
}

interface ObservationStageProps {
  language: Language;
  taskId: string;
  evidence: SnakeRuntimeEvidence[];
  scaffoldCompletion: ScaffoldCompletion | null;
  onOpenProject: () => void;
  onContinue: () => void;
  onCardCountChange: (count: number) => void;
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
}

const GROUP_LABELS: Record<User['experimentGroup'], { zh: string; en: string }> = {
  pdt: { zh: '项目解构工作台', en: 'Project deconstruction workspace' },
  ai_pbl: { zh: 'AI 项目学习工作台', en: 'AI project workspace' },
  lecture: { zh: '项目实践工作台', en: 'Project practice workspace' },
  unassigned: { zh: '项目学习工作台', en: 'Project workspace' },
};

export const ProjectFactoryHeader: React.FC<FactoryHeaderProps> = ({
  language,
  taskTitle,
  experimentGroup,
  activeStage,
  onExit,
  onStageChange,
  onOpenProject,
  onOpenAssistant,
  saveLabel,
}) => {
  const isZh = language === 'zh';
  const groupLabel = GROUP_LABELS[experimentGroup] ?? GROUP_LABELS.unassigned;
  const visibleStages = experimentGroup === 'pdt'
    ? STAGES.filter(stage => PDT_STAGE_IDS.has(stage.id))
    : STAGES;

  return (
    <header className="project-factory-header">
      <button
        type="button"
        className="project-factory-back"
        onClick={onExit}
        aria-label={isZh ? '返回学习首页' : 'Back to learning home'}
      >
        <ArrowLeft size={20} />
        <span>{isZh ? '返回' : 'Back'}</span>
      </button>

      <div className="project-factory-heading">
        <span className="project-factory-index">PROJECT_001</span>
        <div>
          <p>{isZh ? groupLabel.zh : groupLabel.en}</p>
          <h2>{isZh ? '贪吃蛇项目工厂' : 'Snake project factory'}</h2>
          <span title={taskTitle}>{taskTitle}</span>
        </div>
      </div>

      <nav
        className="project-stage-rail"
        aria-label={isZh ? '项目阶段' : 'Project stages'}
        style={{ '--project-stage-count': visibleStages.length } as React.CSSProperties}
      >
        {visibleStages.map((stage, index) => {
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
              <span className="project-stage-number">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={15} />
              <strong>{isFunctionFlow ? (isZh ? '画流程' : 'Flow') : (isZh ? stage.shortZh : stage.shortEn)}</strong>
            </button>
          );
        })}
      </nav>

      <div className="project-factory-tools">
        <span className="project-save-indicator"><Save size={13} />{saveLabel}</span>
        <button type="button" className="project-hint-button" onClick={onOpenAssistant}>
          <Lightbulb size={17} />
          <span>{isZh ? '提示一下' : 'Hint'}</span>
        </button>
        <button type="button" className="project-demo-button" onClick={onOpenProject}>
          <Gamepad2 size={17} />
          <span>{isZh ? '运行完整项目' : 'Run complete project'}</span>
        </button>
      </div>
    </header>
  );
};

export const ProjectObservationStage: React.FC<ObservationStageProps> = ({
  language,
  taskId,
  evidence,
  scaffoldCompletion,
  onOpenProject,
  onContinue,
  onCardCountChange,
}) => {
  const isZh = language === 'zh';
  const storageKey = `cognisync:project-observation-cards:v2:${taskId}`;
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
  }, [scaffoldCompletion]);

  const hasOpenedProject = evidence.some(item => item.type === 'opened');
  const visibleEvidence = useMemo(() => evidence.slice(-8).reverse(), [evidence]);
  const selectedEvidence = evidence.find(item => item.id === selectedEvidenceId);

  const selectEvidence = (id: string) => {
    setSelectedEvidenceId(id);
    setDraftSource('student');
  };

  const resetDraft = () => {
    setEditingId(null);
    setSelectedEvidenceId('');
    setDraft('');
    setDraftSource('student');
  };

  const editObservation = (card: StudentObservationCard) => {
    setEditingId(card.id);
    setSelectedEvidenceId(card.evidenceId);
    setDraft(card.observationText);
    setDraftSource(card.source);
    window.requestAnimationFrame(() => {
      document.querySelector('.observation-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const saveObservation = () => {
    const text = draft.trim();
    if (!selectedEvidence || !text) return;
    const card: StudentObservationCard = {
      id: editingId ?? `observation-${Date.now()}`,
      evidenceId: selectedEvidence.id,
      evidenceText: formatSnakeEvidence(selectedEvidence, language),
      observationText: text,
      source: draftSource,
      createdAt: editingId
        ? cards.find(item => item.id === editingId)?.createdAt ?? new Date().toISOString()
        : new Date().toISOString(),
    };
    setCards(current => editingId
      ? current.map(item => item.id === editingId ? card : item)
      : [...current, card].slice(-8));
    resetDraft();
  };

  return (
    <section className="project-observation-stage">
      <article className="project-brief-card">
        <div className="project-brief-kicker">
          <span>MISSION_01 / OBSERVE</span>
          <span className={hasOpenedProject ? 'is-complete' : ''}>
            <CircleDot size={11} />
            {hasOpenedProject ? (isZh ? '已运行' : 'Opened') : (isZh ? '等待运行' : 'Not opened')}
          </span>
        </div>

        <div className="project-brief-copy">
          <p>{isZh ? '第一个任务' : 'FIRST MISSION'}</p>
          <h3>{isZh ? '先让它跑起来，别急着看代码。' : 'Run it before reading the code.'}</h3>
          <span>
            {isZh
              ? '自由操作贪吃蛇。系统只记录按键、位置和结果等客观变化，不会替你判断功能；你需要从证据中形成自己的观察。'
              : 'Operate the snake freely. The system captures objective actions and changes without naming functions; you form the observation.'}
          </span>
        </div>

        <button type="button" className="project-run-card" onClick={onOpenProject}>
          <span className="project-run-icon"><Play size={25} fill="currentColor" /></span>
          <span>
            <small>{isZh ? '完整项目 / 可交互' : 'COMPLETE BUILD / LIVE'}</small>
            <strong>{isZh ? '打开贪吃蛇' : 'Open Snake'}</strong>
          </span>
          <ArrowRight size={22} />
        </button>

        <div className="project-observe-method">
          <MousePointer2 size={17} />
          <p>
            <strong>{isZh ? '操作提示' : 'HOW TO OBSERVE'}</strong>
            <span>{isZh ? '改变一个操作，比较前后变化；同一证据也可以产生不同解释。' : 'Change one action and compare before and after. The same evidence may support different interpretations.'}</span>
          </p>
        </div>
      </article>

      <article className="observation-capture-card">
        <header>
          <div>
            <span>RUNTIME EVIDENCE → MY NOTE</span>
            <h3>{isZh ? '从证据形成自己的观察' : 'Turn evidence into your observation'}</h3>
          </div>
          <strong>{String(cards.length).padStart(2, '0')}<small>/02</small></strong>
        </header>

        <p className="observation-capture-hint">
          {isZh ? '选择一条系统运行记录，再用一句短话写下你真正观察到的变化。至少形成 2 张卡片。' : 'Choose one runtime record, then write the change you actually observed. Create at least two cards.'}
        </p>

        <section className="runtime-evidence-section">
          <div className="runtime-evidence-heading">
            <span><Radio size={14} />{isZh ? '系统运行证据' : 'Runtime evidence'}</span>
            <small>{isZh ? '仅记录发生了什么' : 'What happened, without interpretation'}</small>
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
                <span>{isZh ? '先打开项目，开始、转向、得分或碰撞后，这里会留下运行记录。' : 'Open the project and start, turn, score or collide to create runtime records.'}</span>
              </div>
            )}
          </div>
        </section>

        <section className="observation-composer">
          <div className="observation-composer-title">
            <span><PencilLine size={14} />{isZh ? '我的空白观察卡' : 'My blank observation card'}</span>
            {draftSource === 'ai-assisted' && <small>{isZh ? 'AI辅助草稿' : 'AI-assisted draft'}</small>}
          </div>
          <div className="observation-source-line">
            <strong>{isZh ? '引用证据' : 'Evidence'}</strong>
            <span>{selectedEvidence ? formatSnakeEvidence(selectedEvidence, language) : (isZh ? '请先选择上方的一条运行记录' : 'Choose one runtime record above')}</span>
          </div>
          <label>
            <span>{isZh ? '我观察到' : 'I observed'}</span>
            <textarea
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                if (draftSource === 'ai-assisted') setDraftSource('ai-assisted');
              }}
              maxLength={100}
              rows={2}
              placeholder={isZh ? '用一句短话写下变化，不需要解释原因……' : 'Write the change in one short sentence; do not explain it yet…'}
            />
          </label>
          <div className="observation-composer-actions">
            <small>{draft.length}/100</small>
            <div>
              {editingId && <button type="button" className="is-secondary" onClick={resetDraft}>{isZh ? '取消修改' : 'Cancel'}</button>}
              <button type="button" disabled={!selectedEvidence || !draft.trim()} onClick={saveObservation}>
                {editingId ? (isZh ? '保存修改' : 'Save changes') : (isZh ? '保存观察卡' : 'Save observation')}<ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>

        {cards.length > 0 && (
          <section className="saved-observation-list">
            <div className="runtime-evidence-heading">
              <span><ClipboardList size={14} />{isZh ? '已形成的观察卡' : 'Saved observations'}</span>
              <small>{isZh ? '后续由你继续推测功能与机制' : 'You will infer functions and mechanisms next'}</small>
            </div>
            <div>
              {cards.map((card, index) => (
                <article key={card.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{card.observationText}</p>
                  {card.source === 'ai-assisted' && <small>{isZh ? 'AI辅助' : 'AI-assisted'}</small>}
                  <div className="saved-observation-actions">
                    <button type="button" onClick={() => editObservation(card)} aria-label={isZh ? '修改观察卡' : 'Edit observation'}><PencilLine size={13} /></button>
                    <button type="button" onClick={() => setCards(current => current.filter(item => item.id !== card.id))} aria-label={isZh ? '删除观察卡' : 'Delete observation'}><Trash2 size={13} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="observation-evidence-strip">
          <div>
            <CircleDot size={17} />
            <p>
              <strong>{isZh ? '阶段完成条件' : 'STAGE COMPLETION'}</strong>
              <span>
                {isZh ? '运行过项目，并形成至少 2 张自己的观察卡' : 'Run the project and create at least two observation cards'}
              </span>
            </p>
          </div>
          <button type="button" disabled={!hasOpenedProject || cards.length < 2} onClick={onContinue}>
            {isZh ? '进入功能拆解' : 'Continue to functions'}
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
