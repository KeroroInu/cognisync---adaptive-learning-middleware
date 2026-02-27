import { useState } from 'react';
import { Download, Users, FileText, MessageSquare, TrendingUp, CheckCircle, AlertCircle, Loader } from 'lucide-react';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';
const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY as string) || '';

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
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
    borderColor: 'border-indigo-200 dark:border-indigo-700',
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
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-700',
    filename: 'scale_responses',
    endpoint: '/admin/export/csv/scale-responses',
    fields: ['response_id', 'user_id', 'student_id', 'user_name', 'user_email', 'scale_name', 'responded_at', 'item_1 ~ item_N（各题得分）', 'cognition_score', 'affect_score', 'behavior_score', 'total_score', 'max_score'],
    researchUse: '适用：量表信效度验证、维度得分分布分析、与学习结果的相关分析',
  },
  {
    id: 'conversations',
    title: '对话行为数据集',
    titleEn: 'Conversation Data',
    description: '包含消息级别的对话记录，含发送时间、角色、消息长度、AI 提取的概念标签及时段信息，适用于学习行为模式分析与自然语言处理研究。',
    icon: <MessageSquare size={24} />,
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-50 dark:bg-violet-900/20',
    borderColor: 'border-violet-200 dark:border-violet-700',
    filename: 'conversation_data',
    endpoint: '/admin/export/csv/conversations',
    fields: ['message_id', 'user_id', 'student_id', 'user_name', 'user_email', 'role', 'message_time', 'hour_of_day', 'day_of_week', 'message_length_chars', 'extracted_concepts_raw', 'concept_count'],
    researchUse: '适用：学习行为时间分析、对话深度研究、知识领域偏好分析、NLP 语料构建',
  },
  {
    id: 'knowledge-graph',
    title: '学习轨迹数据集',
    titleEn: 'Learning Trajectory',
    description: '包含用户画像随时间的变化序列（每次量表提交或对话后的快照），用于分析学习者认知/情感/行为三维度的动态演变轨迹。',
    icon: <TrendingUp size={24} />,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-700',
    filename: 'learning_trajectory',
    endpoint: '/admin/export/csv/knowledge-graph',
    fields: ['user_id', 'student_id', 'user_name', 'user_email', 'snapshot_cognition', 'snapshot_affect', 'snapshot_behavior', 'snapshot_time', 'snapshot_source'],
    researchUse: '适用：纵向学习轨迹分析、干预效果前后对比、增长曲线建模（HLM/LCA）',
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
      const url = `${BASE_URL}${dataset.endpoint}`;
      const response = await fetch(url, {
        headers: { 'X-ADMIN-KEY': ADMIN_KEY },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
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

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">研究数据导出</h1>
        <p className="text-gray-700 dark:text-gray-300">
          面向社会科学与教育研究的结构化数据集，导出为 CSV 格式，可直接用于 SPSS、R、Python 等分析工具。
        </p>
      </div>

      {/* Research Note */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 flex gap-3">
        <div className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400">
          <AlertCircle size={18} />
        </div>
        <div className="text-sm text-blue-900 dark:text-blue-100 space-y-1">
          <p className="font-semibold">数据使用说明</p>
          <p>导出数据包含用户邮箱，请在分析前进行去标识化处理。建议使用 <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-800 font-mono text-xs">student_id</code> 作为分析主键替代 email，以符合数据脱敏要求。所有数据使用 UTF-8 with BOM 编码，Excel 可直接打开中文内容。</p>
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
              className={`glass-card rounded-2xl border ${dataset.borderColor} overflow-hidden`}
            >
              {/* Card Header */}
              <div className={`p-5 ${dataset.bgColor} border-b ${dataset.borderColor}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`${dataset.color} shrink-0`}>
                      {dataset.icon}
                    </div>
                    <div>
                      <h2 className="text-base font-bold">{dataset.title}</h2>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{dataset.titleEn}</p>
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
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105'
                    }`}
                  >
                    {status === 'loading' && <Loader size={15} className="animate-spin" />}
                    {status === 'success' && <CheckCircle size={15} />}
                    {status === 'error' && <AlertCircle size={15} />}
                    {(status === 'idle') && <Download size={15} />}
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
                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                  {dataset.description}
                </p>

                {/* Research Use */}
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">研究适用场景</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{dataset.researchUse}</p>
                </div>

                {/* Field List */}
                <div>
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">包含字段</p>
                  <div className="flex flex-wrap gap-1.5">
                    {dataset.fields.map(field => (
                      <span
                        key={field}
                        className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {status === 'error' && error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Export All */}
      <div className="glass-card rounded-2xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold mb-1">一键导出全部数据集</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              依次下载上述 4 个 CSV 文件，适合完整数据备份或跨数据集联合分析。
            </p>
          </div>
          <button
            onClick={() => DATASETS.forEach(ds => handleExport(ds))}
            disabled={Object.values(statuses).some(s => s === 'loading')}
            className="shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 text-white font-semibold text-sm hover:shadow-lg hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            导出全部（4 个文件）
          </button>
        </div>
      </div>
    </div>
  );
};
