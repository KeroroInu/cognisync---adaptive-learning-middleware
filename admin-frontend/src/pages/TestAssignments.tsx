import { useEffect, useState } from 'react';
import {
  Archive,
  Bot,
  Check,
  ClipboardCheck,
  LoaderCircle,
  Play,
  Save,
  Users,
} from 'lucide-react';
import { adminApi } from '../lib/adminApi';
import type { ResearchTask } from '../types';
import './TestAssignments.css';

const GROUPS: Array<{ value: ResearchTask['target_group']; label: string }> = [
  { value: 'all', label: '全部学生' },
  { value: 'pdt', label: '项目解构式教学组' },
  { value: 'ai_pbl', label: 'AI 项目式教学组' },
  { value: 'lecture', label: '普通讲授式教学组' },
  { value: 'unassigned', label: '未分组学生' },
];

const STATUS_LABEL = { draft: '待发布', active: '测试中', archived: '已结束' } as const;

export const TestAssignments = () => {
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [targetGroup, setTargetGroup] = useState<ResearchTask['target_group']>('all');
  const [aiEnabled, setAiEnabled] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await adminApi.getResearchTasks();
      const fixedTask = result.tasks
        .filter(item => item.task_kind === 'transfer_test')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
      setTask(fixedTask);
      if (fixedTask) {
        setTargetGroup(fixedTask.target_group);
        setAiEnabled(fixedTask.ai_enabled);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveSettings = async () => {
    if (!task) return;
    try {
      setSaving(true);
      setError('');
      await adminApi.updateResearchTask(task.id, {
        target_group: targetGroup,
        ai_enabled: aiEnabled,
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!task) return;
    try {
      setSaving(true);
      setError('');
      await adminApi.updateResearchTask(task.id, {
        target_group: targetGroup,
        ai_enabled: aiEnabled,
      });
      await adminApi.activateResearchTask(task.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发布失败');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!task) return;
    try {
      setSaving(true);
      setError('');
      await adminApi.archiveResearchTask(task.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '结束失败');
    } finally {
      setSaving(false);
    }
  };

  const settingsLocked = task?.status === 'active';

  return (
    <div className="test-assignment-page">
      <section className="test-assignment-hero">
        <div>
          <p className="test-assignment-kicker">PROJECT 02 / TRANSFER</p>
          <h2>迷宫寻宝迁移测试</h2>
          <p>学生直接进入迷宫可视化运行器和函数建构台。实验期间固定使用这一个迁移项目，不再新建任务。</p>
        </div>
        {task && <span className={`test-status-badge is-${task.status}`}>{STATUS_LABEL[task.status]}</span>}
      </section>

      {error && <div className="test-error" role="alert">{error}</div>}

      {loading ? (
        <div className="test-loading"><LoaderCircle className="animate-spin" /> 正在读取迁移测试…</div>
      ) : !task ? (
        <div className="test-empty" role="status">
          <ClipboardCheck size={30} />
          <strong>固定迁移测试尚未就绪</strong>
          <span>重启后端后会自动补齐“迷宫寻宝”，不需要教师手工创建。</span>
        </div>
      ) : (
        <article className={`test-card test-fixed-card is-${task.status}`}>
          <div className="test-card-preview is-large" aria-hidden="true">
            <span className="test-start">S</span><i /><i /><i /><span className="test-goal">◆</span>
          </div>
          <div className="test-card-body">
            <div className="test-card-meta">
              <span>MAZE_TREASURE_V1</span>
              <span>固定实验项目</span>
            </div>
            <h3>{task.title}</h3>
            <p>{task.instructions}</p>

            <div className="test-settings-grid">
              <label>
                <span><Users size={16} />发布范围</span>
                <select
                  value={targetGroup}
                  disabled={settingsLocked || saving}
                  onChange={event => setTargetGroup(event.target.value as ResearchTask['target_group'])}
                >
                  {GROUPS.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}
                </select>
              </label>
              <button
                className={`test-ai-switch ${aiEnabled ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={aiEnabled}
                disabled={settingsLocked || saving}
                onClick={() => setAiEnabled(value => !value)}
              >
                <span><Bot size={18} />AI 学习助手</span>
                <i>{aiEnabled ? '开启' : '关闭'}</i>
              </button>
            </div>

            <div className="test-card-facts">
              <span><Check size={15} />{task.submissions_count ?? 0} 份学生提交</span>
              <span>{settingsLocked ? '发布后实验条件已冻结' : '发布前可调整实验组与 AI 开关'}</span>
            </div>

            <div className="test-card-actions is-split">
              {!settingsLocked && (
                <button type="button" className="is-secondary" disabled={saving} onClick={() => void saveSettings()}>
                  <Save size={16} />保存设置
                </button>
              )}
              {task.status !== 'active' ? (
                <button type="button" disabled={saving} onClick={() => void publish()}>
                  {saving ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}发布测试
                </button>
              ) : (
                <button type="button" disabled={saving} onClick={() => void archive()}>
                  <Archive size={16} />结束测试
                </button>
              )}
            </div>
          </div>
        </article>
      )}
    </div>
  );
};
