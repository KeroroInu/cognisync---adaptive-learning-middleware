import { CheckCircle2, RotateCcw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

import {
  DEFAULT_BLUEPRINT_SCAFFOLD_LEVELS,
  getBlueprintScaffoldLevels,
} from '../lib/projectBlueprint';
import type {
  BlueprintScaffoldLevel,
  BlueprintStage,
  ProjectBlueprintConfig,
} from '../types';

interface ResearchBlueprintScaffoldsProps {
  config: ProjectBlueprintConfig;
  selectedStage: BlueprintStage;
  onSelectStage: (stage: BlueprintStage) => void;
  onMutate: (mutate: (draft: ProjectBlueprintConfig) => void) => void;
}

const STAGES: Array<{ id: BlueprintStage; index: string; label: string; evidence: string }> = [
  { id: 'observe', index: '01', label: '观察', evidence: '运行证据与观察卡' },
  { id: 'decompose', index: '02', label: '拆功能', evidence: '功能卡与输入输出' },
  { id: 'model', index: '03', label: '理关系', evidence: '功能内部流程图' },
  { id: 'plan', index: '04', label: '定路径', evidence: '系统关系与实现顺序' },
  { id: 'build', index: '05', label: '再建构', evidence: '当前代码、测试和运行结果' },
  { id: 'transfer', index: '06', label: '迁移反思', evidence: '新旧任务比较与学习反思' },
];

const LEVEL_TITLES = ['情境澄清', '概念提示', '策略提示', '最小补全'];
const LEVEL_BOUNDARIES = [
  '只聚焦现象、目标和当前卡点',
  '只提供一个相关概念或检查角度',
  '允许给出局部步骤、检查顺序或伪代码',
  '只补足阻塞推进的一处，不给完整方案',
];

export const ResearchBlueprintScaffolds = ({
  config,
  selectedStage,
  onSelectStage,
  onMutate,
}: ResearchBlueprintScaffoldsProps) => {
  const stage = STAGES.find(item => item.id === selectedStage) ?? STAGES[0];
  const levels = getBlueprintScaffoldLevels(config.scaffoldPolicy, stage.id);
  const configuredLevels = config.scaffoldPolicy.stageLevels[stage.id] ?? [];
  const completeStageCount = STAGES.filter(item => {
    const levelIds = new Set((config.scaffoldPolicy.stageLevels[item.id] ?? []).map(level => level.level));
    return [0, 1, 2, 3].every(level => levelIds.has(level));
  }).length;

  const updateLevel = (level: number, mutate: (item: BlueprintScaffoldLevel) => void) => {
    onMutate(draft => {
      const normalized = getBlueprintScaffoldLevels(draft.scaffoldPolicy, stage.id);
      const target = normalized.find(item => item.level === level);
      if (target) mutate(target);
      draft.scaffoldPolicy.stageLevels[stage.id] = normalized;
    });
  };

  const resetStage = () => {
    onMutate(draft => {
      draft.scaffoldPolicy.stageLevels[stage.id] = DEFAULT_BLUEPRINT_SCAFFOLD_LEVELS[stage.id]
        .map(level => ({ ...level }));
    });
  };

  return (
    <section className="blueprint-scaffold-layout">
      <aside className="blueprint-scaffold-rail">
        <div className="blueprint-scaffold-rail__summary">
          <span><ShieldCheck /> SCAFFOLD POLICY</span>
          <strong>{completeStageCount}<small>/06</small></strong>
          <p>阶段已配置完整 L0–L3</p>
        </div>

        <div className="blueprint-scaffold-stage-list">
          {STAGES.map(item => {
            const levelIds = new Set((config.scaffoldPolicy.stageLevels[item.id] ?? []).map(level => level.level));
            const complete = [0, 1, 2, 3].every(level => levelIds.has(level));
            return (
              <button key={item.id} className={stage.id === item.id ? 'is-active' : ''} onClick={() => onSelectStage(item.id)}>
                <span>{item.index}</span>
                <div><strong>{item.label}</strong><small>{item.evidence}</small></div>
                {complete ? <CheckCircle2 /> : <TriangleAlert />}
              </button>
            );
          })}
        </div>

        <div className="blueprint-scaffold-global">
          <label className="blueprint-scaffold-switch">
            <input
              type="checkbox"
              checked={config.scaffoldPolicy.requireAttemptBeforeUpgrade}
              onChange={event => onMutate(draft => {
                draft.scaffoldPolicy.requireAttemptBeforeUpgrade = event.target.checked;
              })}
            />
            <span><strong>升级前要求学生先尝试</strong><small>“再具体一级”会追问修改或验证证据</small></span>
          </label>
          <label>
            <span>核心实现可用最高等级</span>
            <select
              value={config.scaffoldPolicy.coreImplementationMaxLevel}
              onChange={event => onMutate(draft => {
                draft.scaffoldPolicy.coreImplementationMaxLevel = Number(event.target.value);
              })}
            >
              {[0, 1, 2, 3].map(level => <option key={level} value={level}>L{level} · {LEVEL_TITLES[level]}</option>)}
            </select>
            <small>当设为 L3 时仍只允许最小补全，不得生成整个模块。</small>
          </label>
        </div>
      </aside>

      <div className="blueprint-scaffold-workbench">
        <header className="blueprint-scaffold-workbench__header">
          <div>
            <p className="blueprint-kicker">{stage.index} / {stage.id.toUpperCase()} SCAFFOLD</p>
            <h4>{stage.label}阶段的递进式支架</h4>
            <span>AI 先读取{stage.evidence}，学生画像只调节表达方式与步长。</span>
          </div>
          <button onClick={resetStage}><RotateCcw /> 恢复本阶段通用边界</button>
        </header>

        {configuredLevels.length < 4 && (
          <div className="blueprint-scaffold-default-note"><Sparkles /> 当前未完整保存本阶段策略，界面已补入通用默认值；修改任一字段即会写入蓝图。</div>
        )}

        <div className="blueprint-scaffold-levels">
          {levels.map(item => (
            <article key={item.level} className={`blueprint-scaffold-level is-level-${item.level}`}>
              <div className="blueprint-scaffold-level__number">
                <span>L{item.level}</span>
                <div><strong>{LEVEL_TITLES[item.level]}</strong><small>{LEVEL_BOUNDARIES[item.level]}</small></div>
              </div>
              <label>
                <span>本级目标</span>
                <input value={item.goalZh} onChange={event => updateLevel(item.level, level => { level.goalZh = event.target.value; })} />
              </label>
              <label>
                <span>AI 允许怎么帮</span>
                <textarea value={item.allowedHelpZh} onChange={event => updateLevel(item.level, level => { level.allowedHelpZh = event.target.value; })} />
              </label>
              <label className="blueprint-scaffold-code-limit">
                <span>最多可补全代码行数</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={item.maxCodeLines ?? 0}
                  onChange={event => updateLevel(item.level, level => {
                    level.maxCodeLines = Math.min(100, Math.max(0, Number(event.target.value) || 0));
                  })}
                />
                <small>{item.maxCodeLines ? `只能围绕当前阻塞片段补全 ${item.maxCodeLines} 行` : '不允许直接生成代码'}</small>
              </label>
            </article>
          ))}
        </div>

        <footer className="blueprint-scaffold-boundary">
          <ShieldCheck />
          <div><strong>通用边界</strong><span>L0 只澄清，L1 给概念，L2 给局部策略，L3 只补足一个阻塞点；每轮都要求学生运行、解释或修改。</span></div>
        </footer>
      </div>
    </section>
  );
};
