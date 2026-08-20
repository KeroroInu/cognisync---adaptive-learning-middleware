import { useState } from 'react';
import { Download, Users, FileText, MessageSquare, TrendingUp, CheckCircle, AlertCircle, Loader, GitBranch, Milestone, LifeBuoy } from 'lucide-react';
import { adminApi } from '../lib/adminApi';

interface DatasetConfig {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  filename: string;
  endpoint: string;
  fields: string[];
  researchUse: string;
}

const DATASETS: DatasetConfig[] = [
  {
    id: 'learner-profiles',
    title: '学习者画像数据集',
    titleEn: 'Learner Profiles',
    description: '包含每位学习者的基础信息、初始量表得分、当前认知/情感/行为三维度分值及对话参与行为指标，适用于学习者特征分析与分组研究。',
    icon: <Users size={24} />,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    filename: 'learner_profiles',
    endpoint: '/admin/export/csv/learner-profiles',
    fields: ['user_id', 'student_id', 'name', 'email', 'registered_at', 'initial_cognition', 'initial_affect', 'initial_behavior', 'current_cognition', 'current_affect', 'current_behavior', 'profile_update_count', 'total_sessions', 'total_messages', 'scale_completions'],
    researchUse: '适用：学习者特征分析、初始能力水平分组、纵向追踪研究的基线数据（student_id 可直接用作去标识化主键）',
  },
  {
    id: 'scale-responses',
    title: '量表响应数据集',
    titleEn: 'Scale Responses',
    description: '包含每位用户各量表题目的原始作答得分及认知/情感/行为三维度汇总分值，适用于量表信效度分析、因子分析及与其他变量的相关研究。',
    icon: <FileText size={24} />,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    filename: 'scale_responses',
    endpoint: '/admin/export/csv/scale-responses',
    fields: ['response_id', 'user_id', 'student_id', 'user_name', 'user_email', 'scale_name', 'responded_at', 'item_1 ~ item_N（各题得分）', 'cognition_score', 'affect_score', 'behavior_score', 'total_score', 'max_score'],
    researchUse: '适用：量表信效度验证、维度得分分布分析、与学习结果的相关分析',
  },
  {
    id: 'conversations',
    title: '对话行为数据集',
    titleEn: 'Conversation Data',
    description: '包含消息级对话、AI 回复、项目阶段、学生请求与实际采用的 L0–L3、蓝图版本、触发方式、画像快照及当前模块/测试上下文，可用于分析不同类型学生的求助与支架依赖。',
    icon: <MessageSquare size={24} />,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    filename: 'conversation_data',
    endpoint: '/admin/export/csv/conversations',
    fields: ['message_id', 'student_id', 'role', 'message_text', 'message_time', 'scaffold_stage', 'scaffold_requested_level', 'scaffold_level', 'scaffold_trigger', 'scaffold_blueprint_version_id', 'scaffold_policy_goal/allowed_help', 'scaffold_profile_cognition/affect/behavior', 'scaffold_current_module', 'scaffold_test_feedback'],
    researchUse: '适用：求助行为分析、L0–L3 支架依赖、学习者画像与支架等级关联、对话深度与后续修订研究',
  },
  {
    id: 'knowledge-graph',
    title: '学习轨迹数据集',
    titleEn: 'Learning Trajectory',
    description: '包含用户画像随时间的变化序列（每次量表提交或对话后的快照），用于分析学习者认知/情感/行为三维度的动态演变轨迹。',
    icon: <TrendingUp size={24} />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    filename: 'learning_trajectory',
    endpoint: '/admin/export/csv/knowledge-graph',
    fields: ['user_id', 'student_id', 'user_name', 'user_email', 'snapshot_cognition', 'snapshot_affect', 'snapshot_behavior', 'snapshot_time', 'snapshot_source'],
    researchUse: '适用：纵向学习轨迹分析、干预效果前后对比、增长曲线建模（HLM/LCA）',
  },
  // ── 项目解构过程证据（三份）─────────────────────────────────────────────
  // 与上面四份「结果型」数据集不同，这三份是过程型证据：产物怎么改的、
  // 关键时刻何时发生、支架请求与实际生效等级。端点早已实现，此前后台没有
  // 入口，研究者只能手工拼 URL 带 admin key 调用。
  {
    id: 'artifact-versions',
    title: '解构产物版本链',
    titleEn: 'Artifact Version Chain',
    description: '每行是一个阶段产物的一个版本，含完整内容快照、与上一版本的字段级差异摘要（changed_fields）、修改来源与修改理由，可还原「某张功能卡改了几次、每次改了什么、因何而改」。',
    icon: <GitBranch size={24} />,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    filename: 'artifact_versions',
    endpoint: '/admin/export/csv/artifact-versions',
    fields: ['student_id', 'user_name', 'experiment_group', 'task_title', 'stage', 'artifact_type', 'artifact_key', 'version', 'change_source', 'change_reason', 'changed_fields', 'content（JSON 快照）', 'content_hash', 'created_at', 'blueprint_version_id'],
    researchUse: '适用：解构质量的修订轨迹分析、自主修改与测试驱动修改的区分、蓝图对照下的产物演变',
  },
  {
    id: 'stage-events',
    title: '关键教学事件时间线',
    titleEn: 'Stage Events',
    description: '只记录阶段确认、结构修改、模块测试、主动求助与最终提交五类关键时刻，不含拖拽坐标与游戏帧。一次事件涉及多个产物时按产物展开为多行，同一事件共享 event_id 与 request_id，可据此重新聚合。',
    icon: <Milestone size={24} />,
    color: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    filename: 'stage_events',
    endpoint: '/admin/export/csv/stage-events',
    fields: ['student_id', 'user_name', 'experiment_group', 'task_title', 'event_id', 'request_id', 'stage', 'event_type', 'artifact_position', 'artifact_type', 'artifact_key', 'artifact_version', 'artifact_version_created', 'detail（JSON）', 'blueprint_version_id', 'created_at'],
    researchUse: '适用：阶段停留时长与推进节奏、求助时机、修订触发点、事件与产物版本的时间对应关系',
  },
  {
    id: 'scaffold-events',
    title: '支架请求与钳制轨迹',
    titleEn: 'Scaffold Events',
    description: '每行是一次成功送达的 L0–L3 支架，含学生请求等级、实际生效等级与是否被钳制（was_clamped），并关联学生提问原文与 AI 建议原文。学生发起但 AI 失败的求助不在此表，记录在关键事件的 help_request 中。',
    icon: <LifeBuoy size={24} />,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    filename: 'scaffold_events',
    endpoint: '/admin/export/csv/scaffold-events',
    fields: ['student_id', 'user_name', 'experiment_group', 'task_title', 'stage', 'trigger', 'requested_level', 'applied_level', 'was_clamped', 'delivery_status', 'policy_source', 'policy_max_code_lines', 'current_module', 'profile_cognition/affect/behavior', 'code_length', 'code_fingerprint', 'adopted', 'student_message_text', 'assistant_suggestion_text', 'created_at'],
    researchUse: '适用：支架依赖程度、请求等级与实际生效等级的落差、画像与求助强度的关联。注意含学生提问原文，对外共享前须按伦理要求脱敏',
  },
];

type ExportStatus = 'idle' | 'loading' | 'success' | 'error';

export const Exports = () => {
  const [statuses, setStatuses] = useState<Record<string, ExportStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleExport = async (dataset: DatasetConfig) => {
    setStatuses(prev => ({ ...prev, [dataset.id]: 'loading' }));
    setErrors(prev => ({ ...prev, [dataset.id]: '' }));

    try {
      const blob = await adminApi.exportCsv(dataset.endpoint.replace(/^\/admin/, ''));
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${dataset.filename}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      setStatuses(prev => ({ ...prev, [dataset.id]: 'success' }));
      setTimeout(() => setStatuses(prev => ({ ...prev, [dataset.id]: 'idle' })), 3000);
    } catch (err) {
      setStatuses(prev => ({ ...prev, [dataset.id]: 'error' }));
      setErrors(prev => ({ ...prev, [dataset.id]: err instanceof Error ? err.message : 'Export failed' }));
    }
  };

  const handleExportAll = async () => {
    // 刻意串行。数据集从 4 份增加到 7 份后，产物版本链会把整列 JSONB 快照读出来，
    // 一次并发 7 个大查询在 2 核测试机上有把后端拖垮的风险，而研究者按顺序拿到
    // 文件在体验上没有差别。
    for (const dataset of DATASETS) {
      await handleExport(dataset);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>研究数据导出</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          面向社会科学与教育研究的结构化数据集，导出为 CSV 格式，可直接用于 SPSS、R、Python 等分析工具。
        </p>
      </div>

      {/* Research Note */}
      <div className="admin-research-note rounded-xl p-4 flex gap-3">
        <div className="shrink-0 mt-0.5">
          <AlertCircle size={18} />
        </div>
        <div className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
          <p className="font-semibold">数据使用说明</p>
          <p style={{ color: 'var(--text-secondary)' }}>
            导出数据包含用户邮箱，请在分析前进行去标识化处理。建议使用{' '}
            <code className="px-1 py-0.5 rounded font-mono text-xs">
              student_id
            </code>{' '}
            作为分析主键替代 email，以符合数据脱敏要求。所有数据使用 UTF-8 with BOM 编码，Excel 可直接打开中文内容。
          </p>
        </div>
      </div>

      {/* Dataset Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {DATASETS.map((dataset) => {
          const status = statuses[dataset.id] || 'idle';
          const error = errors[dataset.id];

          return (
            <div
              key={dataset.id}
              className="glass-card rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--glass-border)' }}
            >
              {/* Card Header */}
              <div className={`p-5 export-card-header ${dataset.bgColor} border-b`}
                style={{ borderColor: 'var(--glass-border)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`${dataset.color} shrink-0`}>
                      {dataset.icon}
                    </div>
                    <div>
                      <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{dataset.title}</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-light)' }}>{dataset.titleEn}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleExport(dataset)}
                    disabled={status === 'loading'}
                    className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                      status === 'success'
                        ? 'bg-emerald-500 text-white'
                        : status === 'error'
                        ? 'bg-red-500 text-white'
                        : status === 'loading'
                        ? 'text-gray-500 cursor-not-allowed'
                        : 'admin-export-button bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105'
                    }`}
                    style={status === 'loading' ? { background: 'var(--bg-tertiary)' } : undefined}
                  >
                    {status === 'loading' && <Loader size={15} className="animate-spin" />}
                    {status === 'success' && <CheckCircle size={15} />}
                    {status === 'error' && <AlertCircle size={15} />}
                    {status === 'idle' && <Download size={15} />}
                    <span>
                      {status === 'loading' ? '导出中...' :
                       status === 'success' ? '已下载' :
                       status === 'error' ? '失败' : '导出 CSV'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 space-y-4">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {dataset.description}
                </p>

                {/* Research Use */}
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-light)' }}>研究适用场景</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{dataset.researchUse}</p>
                </div>

                {/* Field List */}
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-light)' }}>包含字段</p>
                  <div className="flex flex-wrap gap-1.5">
                    {dataset.fields.map(field => (
                      <span
                        key={field}
                        className="inline-block px-2 py-0.5 rounded text-xs font-mono"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {status === 'error' && error && (
                  <p className="text-xs text-red-500">{error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Export All */}
      <div className="glass-card rounded-2xl p-6" style={{ border: '1px solid var(--glass-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>一键导出全部数据集</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              依次下载上述 {DATASETS.length} 个 CSV 文件，适合完整数据备份或跨数据集联合分析。
            </p>
          </div>
          <button
            onClick={handleExportAll}
            disabled={Object.values(statuses).some(s => s === 'loading')}
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 text-white font-semibold text-sm hover:shadow-lg hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            导出全部（{DATASETS.length} 个文件）
          </button>
        </div>
      </div>
    </div>
  );
};
