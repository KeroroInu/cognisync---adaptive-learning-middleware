import { useEffect, useMemo, useState } from 'react';
import { Archive, Bot, Check, ClipboardCheck, LoaderCircle, Play, Plus, Users, X } from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { ResearchTask } from '../types';
import './TestAssignments.css';

const STARTER_CODE = `def next_move(state):
    # 读取 state 中的 position、goal、walls、visited
    # 返回 'up' / 'down' / 'left' / 'right'
    return 'right'`;

const GROUPS: Array<{ value: ResearchTask['target_group']; label: string }> = [
  { value: 'all', label: '全部学生' },
  { value: 'pdt', label: '项目解构式教学组' },
  { value: 'ai_pbl', label: 'AI 项目式教学组' },
  { value: 'lecture', label: '普通讲授式教学组' },
  { value: 'unassigned', label: '未分组学生' },
];

const STATUS_LABEL = { draft: '草稿', active: '已发布', archived: '已归档' } as const;

export const TestAssignments = () => {
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '迷宫寻宝迁移测试',
    instructions: '让角色避开墙壁到达宝箱。你可以拆分并添加自己的函数。',
    target_group: 'all' as ResearchTask['target_group'],
    ai_enabled: true,
  });

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await adminApi.getResearchTasks();
      setTasks(result.tasks.filter(task => task.task_kind === 'transfer_test'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const activeGroups = useMemo(() => new Set(
    tasks.filter(task => task.status === 'active').map(task => task.target_group),
  ), [tasks]);

  const createTest = async () => {
    if (!form.title.trim()) return;
    try {
      setCreating(true);
      setError('');
      await adminApi.createResearchTask({
        title: form.title.trim(),
        description: '视觉化迷宫迁移任务',
        instructions: form.instructions.trim(),
        ai_prompt: form.ai_enabled
          ? '引导学生迁移已学会的函数化思维；根据当前函数、代码和测试结果给出支架。'
          : undefined,
        code_content: STARTER_CODE,
        language: 'python',
        target_group: form.target_group,
        task_kind: 'transfer_test',
        test_template: 'maze_treasure_v1',
        ai_enabled: form.ai_enabled,
      });
      setShowForm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (task: ResearchTask, action: 'activate' | 'archive') => {
    try {
      setError('');
      if (action === 'activate') await adminApi.activateResearchTask(task.id);
      else await adminApi.archiveResearchTask(task.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    }
  };

  return (
    <div className="test-assignment-page">
      <section className="test-assignment-hero">
        <div>
          <p className="test-assignment-kicker">TRANSFER TEST / CLASSROOM DISPATCH</p>
          <h2>布置测试</h2>
          <p>发布后，学生直接进入可视化任务和函数建构台。当前模板为“迷宫寻宝”。</p>
        </div>
        <button className="test-primary-button" type="button" onClick={() => setShowForm(true)}>
          <Plus size={18} /> 新建测试
        </button>
      </section>

      {error && <div className="test-error" role="alert">{error}</div>}

      <section className="test-overview-strip">
        <div><strong>{tasks.length}</strong><span>测试版本</span></div>
        <div><strong>{tasks.filter(task => task.status === 'active').length}</strong><span>正在进行</span></div>
        <div><strong>{activeGroups.size}</strong><span>已覆盖范围</span></div>
      </section>

      {loading ? (
        <div className="test-loading"><LoaderCircle className="animate-spin" /> 正在读取测试…</div>
      ) : tasks.length === 0 ? (
        <button className="test-empty" type="button" onClick={() => setShowForm(true)}>
          <ClipboardCheck size={30} />
          <strong>还没有迁移测试</strong>
          <span>先发一张迷宫地图，看看学生能否把函数思维带过去。</span>
        </button>
      ) : (
        <div className="test-card-grid">
          {tasks.map(task => (
            <article className={`test-card is-${task.status}`} key={task.id}>
              <div className="test-card-preview" aria-hidden="true">
                <span className="test-start">S</span><i /><i /><i /><span className="test-goal">◆</span>
              </div>
              <div className="test-card-body">
                <div className="test-card-meta">
                  <span>{STATUS_LABEL[task.status]}</span>
                  <span>{task.test_template === 'maze_treasure_v1' ? '迷宫寻宝 V1' : '测试模板'}</span>
                </div>
                <h3>{task.title}</h3>
                <p>{task.instructions || '暂无任务说明'}</p>
                <div className="test-card-facts">
                  <span><Users size={15} /> {GROUPS.find(group => group.value === task.target_group)?.label}</span>
                  <span><Bot size={15} /> AI {task.ai_enabled ? '开启' : '关闭'}</span>
                  <span><Check size={15} /> {task.submissions_count ?? 0} 份提交</span>
                </div>
                <div className="test-card-actions">
                  {task.status !== 'active' && (
                    <button type="button" onClick={() => void setStatus(task, 'activate')}>
                      <Play size={16} /> 发布测试
                    </button>
                  )}
                  {task.status === 'active' && (
                    <button type="button" onClick={() => void setStatus(task, 'archive')}>
                      <Archive size={16} /> 结束测试
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <div className="test-modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}>
          <section className="test-modal" role="dialog" aria-modal="true" aria-labelledby="test-create-title" onMouseDown={event => event.stopPropagation()}>
            <button className="test-modal-close" type="button" onClick={() => setShowForm(false)} aria-label="关闭"><X /></button>
            <p className="test-assignment-kicker">MAZE_TREASURE_V1</p>
            <h2 id="test-create-title">新建迷宫寻宝测试</h2>
            <label>测试名称<input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>
            <label>给学生的一句话<textarea rows={3} value={form.instructions} onChange={event => setForm(current => ({ ...current, instructions: event.target.value }))} /></label>
            <label>发布范围<select value={form.target_group} onChange={event => setForm(current => ({ ...current, target_group: event.target.value as ResearchTask['target_group'] }))}>{GROUPS.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}</select></label>
            <button className={`test-ai-switch ${form.ai_enabled ? 'is-on' : ''}`} type="button" role="switch" aria-checked={form.ai_enabled} onClick={() => setForm(current => ({ ...current, ai_enabled: !current.ai_enabled }))}>
              <span><Bot size={18} />允许学生使用 AI 学习助手</span><i>{form.ai_enabled ? '已开启' : '已关闭'}</i>
            </button>
            <div className="test-modal-note">发布后任务内容与 AI 开关冻结，避免同一轮实验中途改变条件。
            </div>
            <button className="test-primary-button is-wide" type="button" disabled={creating || !form.title.trim()} onClick={() => void createTest()}>
              {creating ? <LoaderCircle className="animate-spin" size={18} /> : <Plus size={18} />} 保存为草稿
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
