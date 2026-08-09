import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleDot,
  GitBranch,
  Link2,
  ListChecks,
  Route,
  Unlink,
} from 'lucide-react';
import type { Language } from '../types';
import {
  buildTopologicalOrder,
  createInitialPathPlan,
  inferBlueprintNode,
  readStoredList,
  readStoredObject,
  type StudentPathPlan,
} from '../data/projectPath';
import type { StudentObservationCard } from './ProjectFactory';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import './ProjectPathStage.css';

interface Props {
  language: Language;
  taskId: string;
  stage: 'model' | 'plan';
  onBack: () => void;
  onContinue: () => void;
}

const mergePlanWithCards = (stored: StudentPathPlan, cards: StudentFunctionCard[]): StudentPathPlan => {
  const cardIds = new Set(cards.map(card => card.id));
  const orderedCardIds = stored.orderedCardIds.filter(id => cardIds.has(id));
  cards.forEach(card => {
    if (!orderedCardIds.includes(card.id)) orderedCardIds.push(card.id);
  });

  return {
    ...stored,
    orderedCardIds,
    prerequisites: Object.fromEntries(
      Object.entries(stored.prerequisites)
        .filter(([id]) => cardIds.has(id))
        .map(([id, dependencies]) => [id, dependencies.filter(dep => cardIds.has(dep) && dep !== id)]),
    ),
  };
};

export const ProjectPathStage: React.FC<Props> = ({
  language,
  taskId,
  stage,
  onBack,
  onContinue,
}) => {
  const isZh = language === 'zh';
  const functionKey = `cognisync:project-function-cards:v1:${taskId}`;
  const observationKey = `cognisync:project-observation-cards:v2:${taskId}`;
  const pathKey = `cognisync:project-path-plan:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationKey));
  const [plan, setPlan] = useState<StudentPathPlan>(() => {
    const initial = createInitialPathPlan(readStoredList<StudentFunctionCard>(functionKey));
    return mergePlanWithCards(readStoredObject(pathKey, initial), readStoredList(functionKey));
  });
  const [selectedId, setSelectedId] = useState(() => plan.orderedCardIds[0] ?? '');

  useEffect(() => {
    window.localStorage.setItem(pathKey, JSON.stringify(plan));
  }, [pathKey, plan]);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const orderedCards = useMemo(
    () => plan.orderedCardIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, plan.orderedCardIds],
  );
  const selectedCard = cardsById.get(selectedId) ?? orderedCards[0];
  const topology = useMemo(() => buildTopologicalOrder(cards, plan), [cards, plan]);
  const buildOrder = topology.orderedIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card));
  const relationCount = (Object.values(plan.prerequisites) as string[][]).reduce((count, ids) => count + ids.length, 0);

  const moveCard = (id: string, offset: -1 | 1) => {
    setPlan(current => {
      const index = current.orderedCardIds.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.orderedCardIds.length) return current;
      const next = [...current.orderedCardIds];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, orderedCardIds: next, confirmedAt: undefined };
    });
  };

  const togglePrerequisite = (cardId: string, prerequisiteId: string) => {
    setPlan(current => {
      const active = current.prerequisites[cardId] ?? [];
      const next = active.includes(prerequisiteId)
        ? active.filter(id => id !== prerequisiteId)
        : [...active, prerequisiteId];
      return {
        ...current,
        prerequisites: { ...current.prerequisites, [cardId]: next },
        confirmedAt: undefined,
      };
    });
  };

  const continueFromPlan = () => {
    setPlan(current => ({
      ...current,
      orderedCardIds: topology.orderedIds,
      confirmedAt: new Date().toISOString(),
    }));
    onContinue();
  };

  if (cards.length === 0) {
    return (
      <section className="project-path-stage is-empty">
        <GitBranch size={34} />
        <h3>{isZh ? '还没有可建模的功能卡' : 'No function cards to model yet'}</h3>
        <p>{isZh ? '先从观察中形成功能卡，这里才会出现你自己的项目路径。' : 'Create function cards from your observations before building a project path.'}</p>
        <button type="button" onClick={onBack}>{isZh ? '返回功能拆解' : 'Back to functions'}</button>
      </section>
    );
  }

  if (stage === 'plan') {
    return (
      <section className="project-path-stage is-plan">
        <header className="path-stage-heading">
          <div>
            <span>04 / BUILD ROUTE</span>
            <h3>{isZh ? '把关系图变成自己的建构路径' : 'Turn relations into your build route'}</h3>
            <p>{isZh ? '系统只为你已提出的功能卡准备安全函数接口；没有提出的功能不会被自动补齐。' : 'Only your own cards receive safe function contracts. Missing functions are not added automatically.'}</p>
          </div>
          <div className={`path-validity ${topology.hasCycle ? 'has-error' : 'is-valid'}`}>
            {topology.hasCycle ? <GitBranch size={18} /> : <Check size={18} />}
            <span>{topology.hasCycle ? (isZh ? '关系中出现了循环' : 'Cycle detected') : (isZh ? '路径可执行' : 'Route executable')}</span>
          </div>
        </header>

        <div className="build-route-strip">
          {buildOrder.map((card, index) => {
            const node = inferBlueprintNode(card, observations);
            return (
              <React.Fragment key={card.id}>
                <article>
                  <header><span>{String(index + 1).padStart(2, '0')}</span><Route size={16} /></header>
                  <p>{card.responsibility}</p>
                  <div><small>{isZh ? '接入函数' : 'FUNCTION CONTRACT'}</small><code>{node.functionTemplate}</code></div>
                  <footer>{(isZh ? node.knowledgeZh : node.knowledgeEn).slice(0, 3).map(item => <span key={item}>{item}</span>)}</footer>
                </article>
                {index < buildOrder.length - 1 && <ArrowRight className="build-route-arrow" size={22} />}
              </React.Fragment>
            );
          })}
        </div>

        <section className="route-boundary-note">
          <CircleDot size={18} />
          <div>
            <strong>{isZh ? '平台负责的部分' : 'Provided by the platform'}</strong>
            <span>{isZh ? '画面绘制、键盘监听、定时运行和模块装配已锁定，学生只实现自己规划的功能。' : 'Rendering, keyboard events, timing and module assembly are locked; students implement only their planned functions.'}</span>
          </div>
        </section>

        <footer className="path-stage-footer">
          <button type="button" onClick={onBack}>{isZh ? '返回关系图' : 'Back to relations'}</button>
          <span>{isZh ? '缺失的功能将在综合运行中表现为可观察的问题' : 'Missing functions become observable problems during integration.'}</span>
          <button type="button" className="is-primary" disabled={topology.hasCycle} onClick={continueFromPlan}>
            {isZh ? '按此路径开始建构' : 'Build this route'}<ArrowRight size={17} />
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="project-path-stage is-model">
      <header className="path-stage-heading">
        <div>
          <span>03 / RELATION MAP</span>
          <h3>{isZh ? '把功能卡连成你理解的系统' : 'Connect your cards into a system'}</h3>
          <p>{isZh ? '选中一张卡，点选它开始前必须已经完成的功能。没有前置的卡可以作为起点或并行任务。' : 'Select a card and mark what must already be complete. A card without prerequisites can start or run in parallel.'}</p>
        </div>
        <div className={`path-validity ${topology.hasCycle ? 'has-error' : relationCount > 0 ? 'is-valid' : ''}`}>
          <Link2 size={18} />
          <span>{isZh ? `${relationCount} 条关系` : `${relationCount} relations`}</span>
        </div>
      </header>

      <div className="relation-workspace">
        <section className="relation-canvas">
          <div className="relation-canvas-label"><GitBranch size={15} /><span>{isZh ? '我的功能关系图' : 'MY FUNCTION MAP'}</span></div>
          <div className="relation-card-grid">
            {orderedCards.map((card, index) => {
              const dependencies = plan.prerequisites[card.id] ?? [];
              const selected = selectedCard?.id === card.id;
              return (
                <article key={card.id} className={selected ? 'is-selected' : ''} onClick={() => setSelectedId(card.id)}>
                  <header>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <button type="button" onClick={event => { event.stopPropagation(); moveCard(card.id, -1); }} disabled={index === 0} aria-label={isZh ? '前移' : 'Move left'}><ArrowLeft size={14} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); moveCard(card.id, 1); }} disabled={index === orderedCards.length - 1} aria-label={isZh ? '后移' : 'Move right'}><ArrowRight size={14} /></button>
                    </div>
                  </header>
                  <h4>{card.responsibility}</h4>
                  <p><span>IN</span>{card.input}</p>
                  <p><span>OUT</span>{card.output}</p>
                  <footer>
                    {dependencies.length === 0
                      ? <><CircleDot size={13} />{isZh ? '起点 / 可并行' : 'Start / parallel'}</>
                      : <><Link2 size={13} />{isZh ? `依赖 ${dependencies.length} 张卡` : `${dependencies.length} prerequisites`}</>}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="relation-inspector">
          <div className="relation-canvas-label"><ListChecks size={15} /><span>{isZh ? '设置前置关系' : 'SET PREREQUISITES'}</span></div>
          {selectedCard && (
            <>
              <blockquote>{selectedCard.responsibility}</blockquote>
              <p>{isZh ? '这张卡开始前，必须先有哪些结果？' : 'What must exist before this card can start?'}</p>
              <div className="prerequisite-options">
                {orderedCards.filter(card => card.id !== selectedCard.id).map(card => {
                  const active = (plan.prerequisites[selectedCard.id] ?? []).includes(card.id);
                  return (
                    <button key={card.id} type="button" className={active ? 'is-active' : ''} onClick={() => togglePrerequisite(selectedCard.id, card.id)}>
                      {active ? <Check size={14} /> : <CircleDot size={14} />}
                      <span>{card.responsibility}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relation-meaning">
                {(plan.prerequisites[selectedCard.id] ?? []).length === 0 ? <Unlink size={16} /> : <Link2 size={16} />}
                <span>{(plan.prerequisites[selectedCard.id] ?? []).length === 0
                  ? (isZh ? '当前无前置，它会成为起点或与其他任务并行。' : 'No prerequisite: this becomes a start or parallel task.')
                  : (isZh ? '连线表示“先有前置卡的输出，再完成当前卡”。' : 'A link means the prerequisite output must exist first.')}</span>
              </div>
            </>
          )}
        </aside>
      </div>

      {topology.hasCycle && <div className="relation-cycle-warning"><GitBranch size={17} />{isZh ? '出现了循环依赖：A 等 B，B 又等 A。请取消其中一条关系。' : 'Circular dependency detected. Remove one of the links.'}</div>}

      <footer className="path-stage-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to functions'}</button>
        <span>{isZh ? '这里保留的是你的关系判断，不会自动改成教师答案' : 'Your relations are preserved; they are not replaced by the teacher answer.'}</span>
        <button type="button" className="is-primary" disabled={topology.hasCycle} onClick={onContinue}>
          {isZh ? '生成实现路径' : 'Generate build route'}<ArrowRight size={17} />
        </button>
      </footer>
    </section>
  );
};
