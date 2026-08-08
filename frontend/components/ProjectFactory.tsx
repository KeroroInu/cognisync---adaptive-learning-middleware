import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Blocks,
  Check,
  CircleDot,
  Code2,
  Eye,
  Gamepad2,
  GitBranch,
  ListChecks,
  MousePointer2,
  Play,
  Save,
  Sparkles,
} from 'lucide-react';
import type { Language, User } from '../types';
import './ProjectFactory.css';

export type ProjectStage = 'observe' | 'decompose' | 'model' | 'plan' | 'build';

interface FactoryHeaderProps {
  language: Language;
  taskTitle: string;
  experimentGroup: User['experimentGroup'];
  activeStage: ProjectStage;
  onStageChange: (stage: ProjectStage) => void;
  onOpenProject: () => void;
  saveLabel: string;
}

interface ObservationStageProps {
  language: Language;
  taskId: string;
  onOpenProject: () => void;
  onContinue: () => void;
}

interface StagePreviewProps {
  language: Language;
  stage: Exclude<ProjectStage, 'observe' | 'build'>;
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

const OBSERVATIONS = [
  { id: 'direction', categoryZh: '输入', categoryEn: 'INPUT', zh: '方向键会改变蛇头的移动方向', en: 'Direction keys change the head movement' },
  { id: 'food', categoryZh: '对象', categoryEn: 'OBJECT', zh: '食物会出现在网格中的不同位置', en: 'Food appears at different grid positions' },
  { id: 'grow', categoryZh: '状态', categoryEn: 'STATE', zh: '吃到食物后，蛇身长度会增加', en: 'The snake grows after eating food' },
  { id: 'score', categoryZh: '反馈', categoryEn: 'FEEDBACK', zh: '吃到食物时，分数会同步变化', en: 'The score changes when food is eaten' },
  { id: 'collision', categoryZh: '规则', categoryEn: 'RULE', zh: '碰到边界或自己，运行会结束', en: 'Boundary or self collision ends the run' },
  { id: 'reset', categoryZh: '控制', categoryEn: 'CONTROL', zh: '重新开始会恢复初始状态', en: 'Restart restores the initial state' },
];

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
  onStageChange,
  onOpenProject,
  saveLabel,
}) => {
  const isZh = language === 'zh';
  const groupLabel = GROUP_LABELS[experimentGroup] ?? GROUP_LABELS.unassigned;

  return (
    <header className="project-factory-header">
      <div className="project-factory-heading">
        <span className="project-factory-index">PROJECT_001</span>
        <div>
          <p>{isZh ? groupLabel.zh : groupLabel.en}</p>
          <h2>{isZh ? '贪吃蛇项目工厂' : 'Snake project factory'}</h2>
          <span title={taskTitle}>{taskTitle}</span>
        </div>
      </div>

      <nav className="project-stage-rail" aria-label={isZh ? '项目阶段' : 'Project stages'}>
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          const active = stage.id === activeStage;
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
              <strong>{isZh ? stage.shortZh : stage.shortEn}</strong>
            </button>
          );
        })}
      </nav>

      <div className="project-factory-tools">
        <span className="project-save-indicator"><Save size={13} />{saveLabel}</span>
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
  onOpenProject,
  onContinue,
}) => {
  const isZh = language === 'zh';
  const storageKey = `cognisync:project-observations:${taskId}`;
  const openedStorageKey = `${storageKey}:opened`;
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [hasOpenedProject, setHasOpenedProject] = useState(() => {
    try {
      return window.localStorage.getItem(openedStorageKey) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(selected));
  }, [selected, storageKey]);

  useEffect(() => {
    window.localStorage.setItem(openedStorageKey, String(hasOpenedProject));
  }, [hasOpenedProject, openedStorageKey]);

  const selectedItems = useMemo(
    () => OBSERVATIONS.filter(item => selected.includes(item.id)),
    [selected],
  );

  const toggleObservation = (id: string) => {
    setSelected(current => current.includes(id)
      ? current.filter(item => item !== id)
      : [...current, id]);
  };

  const openProject = () => {
    setHasOpenedProject(true);
    onOpenProject();
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
              ? '用方向键控制贪吃蛇，尝试得分、碰撞和重新开始。你只需要点选看到的现象，系统会把它们整理成第一份解构证据。'
              : 'Control the snake, score, collide and restart. Select what you observe and the system will form the first deconstruction record.'}
          </span>
        </div>

        <button type="button" className="project-run-card" onClick={openProject}>
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
            <span>{isZh ? '改变一次输入，观察状态、规则和反馈发生了什么。' : 'Change one input and notice the resulting state, rule and feedback.'}</span>
          </p>
        </div>
      </article>

      <article className="observation-capture-card">
        <header>
          <div>
            <span>OBSERVATION CAPTURE</span>
            <h3>{isZh ? '我在运行中发现了……' : 'During the run, I noticed…'}</h3>
          </div>
          <strong>{String(selected.length).padStart(2, '0')}<small>/06</small></strong>
        </header>

        <p className="observation-capture-hint">
          {isZh ? '点击符合你观察结果的卡片，可随时取消。至少确认 3 项。' : 'Select matching observations. Confirm at least three.'}
        </p>

        <div className="observation-option-grid">
          {OBSERVATIONS.map(item => {
            const active = selected.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'is-selected' : ''}
                onClick={() => toggleObservation(item.id)}
                aria-pressed={active}
              >
                <span>{isZh ? item.categoryZh : item.categoryEn}</span>
                <p>{isZh ? item.zh : item.en}</p>
                <i>{active ? <Check size={14} /> : <span />}</i>
              </button>
            );
          })}
        </div>

        <div className="observation-evidence-strip">
          <div>
            <Sparkles size={17} />
            <p>
              <strong>{isZh ? '第一份过程证据' : 'FIRST PROCESS EVIDENCE'}</strong>
              <span>
                {selectedItems.length === 0
                  ? (isZh ? '等待你确认观察结果' : 'Waiting for your observations')
                  : selectedItems.map(item => isZh ? item.categoryZh : item.categoryEn).join(' · ')}
              </span>
            </p>
          </div>
          <button type="button" disabled={!hasOpenedProject || selected.length < 3} onClick={onContinue}>
            {isZh ? '形成观察记录' : 'Create record'}
            <ArrowRight size={17} />
          </button>
        </div>
      </article>
    </section>
  );
};

const PREVIEW_CONTENT = {
  decompose: {
    code: '02 / FUNCTION CARDS',
    zhTitle: '把现象变成功能卡片',
    enTitle: 'Turn observations into function cards',
    zhBody: '从已确认的观察中选择功能，合并重复项并命名模块。',
    enBody: 'Choose functions from observations, merge duplicates and name modules.',
    itemsZh: ['移动控制', '食物生成', '身体增长', '碰撞检测', '计分反馈'],
    itemsEn: ['Movement', 'Food spawn', 'Growth', 'Collision', 'Score'],
  },
  model: {
    code: '03 / RELATION MAP',
    zhTitle: '把功能、对象和数据连起来',
    enTitle: 'Connect functions, objects and data',
    zhBody: '通过连线表达蛇、食物、地图与分数之间的依赖。',
    enBody: 'Connect the snake, food, grid and score to express dependencies.',
    itemsZh: ['蛇头位置', '方向输入', '食物坐标', '身体列表', '得分状态'],
    itemsEn: ['Head position', 'Direction', 'Food position', 'Body list', 'Score'],
  },
  plan: {
    code: '04 / BUILD PLAN',
    zhTitle: '为每个模块确定实现路径',
    enTitle: 'Define an implementation path for each module',
    zhBody: '确认输入、处理规则、输出和验证方式，再进入编码。',
    enBody: 'Confirm inputs, rules, outputs and tests before coding.',
    itemsZh: ['输入', '处理规则', '输出', '测试方式', '人机责任'],
    itemsEn: ['Input', 'Rule', 'Output', 'Test', 'Responsibility'],
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
        <span>{isZh ? '当前为界面结构预览，后续接入真实过程记录。' : 'Interface preview; process persistence comes next.'}</span>
        <button type="button" className="is-primary" onClick={onContinue}>
          {isZh ? '进入下一阶段' : 'Next stage'}<ArrowRight size={16} />
        </button>
      </footer>
    </section>
  );
};
