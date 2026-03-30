import { useMemo, useState } from 'react';
import { Download, FileJson, FlaskConical, Loader2, RefreshCw, Upload } from 'lucide-react';

import { adminApi } from '../lib/adminApi';
import type {
  EmotionCompareComparisonRow,
  EmotionCompareResult,
} from '../types';

type DatasetTemplateKey = 'weibo_single' | 'goemotions_multi' | 'custom';

type FormState = {
  datasetTemplate: DatasetTemplateKey;
  labelMode: 'single_label' | 'multi_binary';
  textColumn: string;
  expectedLabelColumn: string;
  expectedLabelColumnsText: string;
  positiveLabelValue: string;
  sampleIdColumn: string;
  labelMappingJson: string;
  previewLimit: number;
};

type DatasetTemplatePreset = {
  labelMode: FormState['labelMode'];
  textColumn: string;
  expectedLabelColumn: string;
  expectedLabelColumnsText: string;
  positiveLabelValue: string;
  sampleIdColumn: string;
  labelMappingJson: string;
};

const GOEMOTIONS_COLUMNS = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity',
  'desire', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
  'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief',
  'remorse', 'sadness', 'surprise', 'neutral',
].join(',');

const DATASET_TEMPLATES: Record<Exclude<DatasetTemplateKey, 'custom'>, DatasetTemplatePreset> = {
  weibo_single: {
    labelMode: 'single_label',
    textColumn: 'content',
    expectedLabelColumn: 'label',
    expectedLabelColumnsText: '',
    positiveLabelValue: '1',
    sampleIdColumn: 'id',
    labelMappingJson: '{\n  "happy": ["excited", "motivated", "encouraged", "confident", "E05", "E06", "E07", "E08"],\n  "sad": ["discouraged", "frustrated", "E03", "E11"],\n  "fear": ["anxious", "overwhelmed", "E04", "E10"]\n}',
  },
  goemotions_multi: {
    labelMode: 'multi_binary',
    textColumn: 'text',
    expectedLabelColumn: '',
    expectedLabelColumnsText: GOEMOTIONS_COLUMNS,
    positiveLabelValue: '1',
    sampleIdColumn: '',
    labelMappingJson: '{\n  "confusion": ["confused", "E01"],\n  "joy": ["excited", "motivated", "relieved", "E07", "E08", "E12"],\n  "fear": ["anxious", "E04"]\n}',
  },
};

const initialFormState: FormState = {
  datasetTemplate: 'weibo_single',
  ...DATASET_TEMPLATES.weibo_single,
  previewLimit: 20,
};

const normalizeCompareError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '情感对比实验执行失败';
  if (message.includes('413') || message.includes('Request Entity Too Large')) {
    return '上传文件过大，请压缩后重试，或先使用较小样本集验证流程。';
  }
  if (message.includes('text column')) {
    return `文本列配置错误：${message}`;
  }
  if (message.includes('expected label')) {
    return `标签列配置错误：${message}`;
  }
  if (message.includes('JSON array')) {
    return `数据格式错误：${message}`;
  }
  return message;
};

const downloadText = (content: string, fileName: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const formatPercent = (value: number | null | undefined) => {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

const winnerTone: Record<EmotionCompareComparisonRow['winner'], string> = {
  baseline: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  system: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  tie: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  none: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const EmotionCompare = () => {
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [result, setResult] = useState<EmotionCompareResult | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const applyTemplate = (template: DatasetTemplateKey) => {
    if (template === 'custom') {
      setForm((prev) => ({ ...prev, datasetTemplate: 'custom' }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      datasetTemplate: template,
      ...DATASET_TEMPLATES[template],
    }));
  };

  const handleAnalyze = async () => {
    if (!file) {
      setError('请先选择数据集文件');
      return;
    }
    if (!form.textColumn.trim()) {
      setError('文本列不能为空');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const expectedLabelColumns = form.expectedLabelColumnsText
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      const normalizedMapping = form.labelMappingJson.trim();
      if (normalizedMapping) {
        const parsed = JSON.parse(normalizedMapping) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('标签映射必须是 JSON 对象');
        }
      }
      if (form.labelMode === 'multi_binary' && expectedLabelColumns.length === 0) {
        throw new Error('多标签模式下，请填写 one-hot 标签列');
      }

      const nextResult = await adminApi.analyzeEmotionCompareDataset({
        file,
        labelMode: form.labelMode,
        textColumn: form.textColumn.trim(),
        expectedLabelColumn: form.labelMode === 'single_label' ? form.expectedLabelColumn.trim() : undefined,
        expectedLabelColumnsJson: form.labelMode === 'multi_binary' ? JSON.stringify(expectedLabelColumns) : undefined,
        positiveLabelValue: form.labelMode === 'multi_binary' ? form.positiveLabelValue.trim() || '1' : undefined,
        sampleIdColumn: form.sampleIdColumn.trim() || undefined,
        labelMappingJson: normalizedMapping || undefined,
        previewLimit: form.previewLimit,
        datasetTemplate: form.datasetTemplate === 'custom' ? undefined : form.datasetTemplate,
      });
      setResult(nextResult);
    } catch (err) {
      setError(normalizeCompareError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const summaryCards = useMemo(() => {
    if (!result) return [];
    const summary = result.summaryMetrics;
    if (summary.taskType === 'single_label') {
      return [
        {
          label: 'Baseline Accuracy',
          baseline: formatPercent(summary.baseline.accuracy),
          system: formatPercent(summary.system.accuracy),
        },
        {
          label: 'Macro F1',
          baseline: formatPercent(summary.baseline.macroF1),
          system: formatPercent(summary.system.macroF1),
        },
        {
          label: 'Weighted F1',
          baseline: formatPercent(summary.baseline.weightedF1),
          system: formatPercent(summary.system.weightedF1),
        },
      ];
    }
    return [
      {
        label: 'Exact Match',
        baseline: formatPercent(summary.baseline.exactMatch),
        system: formatPercent(summary.system.exactMatch),
      },
      {
        label: 'Overlap Match',
        baseline: formatPercent(summary.baseline.overlapMatch),
        system: formatPercent(summary.system.overlapMatch),
      },
      {
        label: 'Macro F1',
        baseline: formatPercent(summary.baseline.macroF1),
        system: formatPercent(summary.system.macroF1),
      },
    ];
  }, [result]);

  const systemWins = useMemo(
    () => result?.comparisonRows.filter((row) => row.winner === 'system').length ?? 0,
    [result]
  );

  const baselineWins = useMemo(
    () => result?.comparisonRows.filter((row) => row.winner === 'baseline').length ?? 0,
    [result]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">情感对比实验</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            上传研究数据集，在同一页面对比纯文本 LLM 基线和 CogniSync 情感系统输出，优先验证最小可用研究闭环。
          </p>
        </div>
        {result && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() =>
                downloadText(result.exportArtifacts.comparisonCsvContent, result.exportArtifacts.comparisonCsvFileName, 'text/csv;charset=utf-8')
              }
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <Download size={18} />
              导出 CSV
            </button>
            <button
              onClick={() =>
                downloadText(
                  JSON.stringify(result, null, 2),
                  result.exportArtifacts.resultJsonFileName,
                  'application/json;charset=utf-8'
                )
              }
              className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
            >
              <FileJson size={18} />
              导出 JSON
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="glass-card p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <section className="glass-card rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <FlaskConical size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">上传与配置</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                先选模板，再根据数据集微调字段映射。
              </p>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">数据集模板</span>
            <select
              value={form.datasetTemplate}
              onChange={(event) => applyTemplate(event.target.value as DatasetTemplateKey)}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            >
              <option value="weibo_single">中文微博单标签</option>
              <option value="goemotions_multi">GoEmotions 多标签</option>
              <option value="custom">自定义配置</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">数据集文件</span>
            <div className="mt-2">
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <Upload size={18} />
                <span className="text-sm">
                  {file ? `已选择：${file.name}` : '点击上传 CSV / XLSX / TXT(JSON array)'}
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.txt,.json,application/json,text/csv"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium">文本列</span>
            <input
              value={form.textColumn}
              onChange={(event) => setForm((prev) => ({ ...prev, textColumn: event.target.value, datasetTemplate: 'custom' }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">标签模式</span>
            <select
              value={form.labelMode}
              onChange={(event) => setForm((prev) => ({ ...prev, labelMode: event.target.value as FormState['labelMode'], datasetTemplate: 'custom' }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            >
              <option value="single_label">单标签列</option>
              <option value="multi_binary">多标签 0/1 列</option>
            </select>
          </label>

          {form.labelMode === 'single_label' ? (
            <label className="block">
              <span className="text-sm font-medium">标签列</span>
              <input
                value={form.expectedLabelColumn}
                onChange={(event) => setForm((prev) => ({ ...prev, expectedLabelColumn: event.target.value, datasetTemplate: 'custom' }))}
                className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium">多标签列名</span>
                <textarea
                  value={form.expectedLabelColumnsText}
                  onChange={(event) => setForm((prev) => ({ ...prev, expectedLabelColumnsText: event.target.value, datasetTemplate: 'custom' }))}
                  className="mt-2 min-h-[112px] w-full rounded-xl border px-3 py-2 bg-transparent font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">正样本取值</span>
                <input
                  value={form.positiveLabelValue}
                  onChange={(event) => setForm((prev) => ({ ...prev, positiveLabelValue: event.target.value, datasetTemplate: 'custom' }))}
                  className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="text-sm font-medium">样本 ID 列</span>
            <input
              value={form.sampleIdColumn}
              onChange={(event) => setForm((prev) => ({ ...prev, sampleIdColumn: event.target.value, datasetTemplate: 'custom' }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              placeholder="可选，如 id"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">预览行数</span>
            <input
              type="number"
              min={1}
              max={100}
              value={form.previewLimit}
              onChange={(event) => setForm((prev) => ({ ...prev, previewLimit: Number(event.target.value) || 20 }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">标签映射 JSON</span>
            <textarea
              value={form.labelMappingJson}
              onChange={(event) => setForm((prev) => ({ ...prev, labelMappingJson: event.target.value, datasetTemplate: 'custom' }))}
              className="mt-2 min-h-[140px] w-full rounded-xl border px-3 py-2 bg-transparent font-mono text-xs"
            />
          </label>

          <button
            onClick={handleAnalyze}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium disabled:opacity-60"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <FlaskConical size={18} />}
            {submitting ? '正在执行对比实验…' : '开始对比实验'}
          </button>
        </section>

        <section className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {[
              { label: '有效样本', value: result?.datasetInfo.rowsProcessed ?? 0 },
              { label: '跳过空行', value: result?.datasetInfo.rowsSkipped ?? 0 },
              { label: '标签总数', value: result?.datasetInfo.labelCount ?? 0 },
              { label: 'Baseline 胜出', value: baselineWins },
              { label: 'System 胜出', value: systemWins },
            ].map((card) => (
              <div key={card.label} className="glass-card rounded-2xl p-5">
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
                <p className="text-3xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">数据集解释</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  当前上传文件被系统识别成哪种任务类型、使用了哪些字段。
                </p>
              </div>
              {result && (
                <button
                  onClick={() => setResult(null)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                >
                  <RefreshCw size={16} />
                  清空结果
                </button>
              )}
            </div>
            {result ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
                <div className="rounded-xl border p-4">
                  <p style={{ color: 'var(--text-secondary)' }}>文件名</p>
                  <p className="font-semibold mt-1 break-all">{result.datasetInfo.datasetName}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p style={{ color: 'var(--text-secondary)' }}>任务类型</p>
                  <p className="font-semibold mt-1">{result.datasetInfo.taskType}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p style={{ color: 'var(--text-secondary)' }}>文本列</p>
                  <p className="font-semibold mt-1">{result.datasetInfo.textColumn}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p style={{ color: 'var(--text-secondary)' }}>标签字段</p>
                  <p className="font-semibold mt-1 break-all">
                    {result.datasetInfo.expectedLabelColumn || result.datasetInfo.expectedLabelColumns.join(', ') || '未提供'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                还没有实验结果。完成一次分析后，这里会显示数据集如何被系统识别。
              </div>
            )}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">总体指标</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                第一阶段只保留最小研究指标，用于验证 baseline 与系统方法谁更接近数据集标签。
              </p>
            </div>
            {result ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {summaryCards.map((card) => (
                  <div key={card.label} className="rounded-2xl border p-4">
                    <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>Baseline</span>
                        <span className="font-semibold">{card.baseline}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>CogniSync</span>
                        <span className="font-semibold">{card.system}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                运行对比实验后，这里会显示 Accuracy / F1 或多标签匹配指标。
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h2 className="text-lg font-semibold">Baseline：纯文本 LLM</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  只基于当前文本的情感判断，不使用画像与上下文。
                </p>
              </div>
              {result && result.baselineRows.length > 0 ? (
                <div className="divide-y">
                  {result.baselineRows.slice(0, 6).map((row) => (
                    <div key={`baseline-${row.rowIndex}`} className="px-5 py-4 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">#{row.rowIndex} {row.sampleId ? `· ${row.sampleId}` : ''}</p>
                          <p className="mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{row.text}</p>
                        </div>
                        <div className="text-right min-w-[120px]">
                          <p className="font-semibold">{row.predictedEmotionName || '—'}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {row.predictedEmotionCode || '—'} · {row.predictedIntensity || '—'} · {formatPercent(row.confidence)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                  还没有 Baseline 结果。
                </div>
              )}
            </div>

            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h2 className="text-lg font-semibold">CogniSync：画像增强情感系统</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  结合系统情感模块输出，保留画像前后状态、delta 与上下文使用信息。
                </p>
              </div>
              {result && result.systemRows.length > 0 ? (
                <div className="divide-y">
                  {result.systemRows.slice(0, 6).map((row) => (
                    <div key={`system-${row.rowIndex}`} className="px-5 py-4 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">#{row.rowIndex} {row.sampleId ? `· ${row.sampleId}` : ''}</p>
                          <p className="mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{row.text}</p>
                          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            画像前 C/A/B：{row.profileBefore?.cognition ?? '—'}/{row.profileBefore?.affect ?? '—'}/{row.profileBefore?.behavior ?? '—'}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            delta：{row.delta?.cognition ?? 0}/{row.delta?.affect ?? 0}/{row.delta?.behavior ?? 0}
                          </p>
                        </div>
                        <div className="text-right min-w-[120px]">
                          <p className="font-semibold">{row.predictedEmotionName || '—'}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {row.predictedEmotionCode || '—'} · {row.predictedIntensity || '—'} · {formatPercent(row.confidence)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                  还没有系统结果。
                </div>
              )}
            </div>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">逐条对比主表</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                用于研究者快速筛查“只有 system 命中”“只有 baseline 命中”“两者都错”的样本。
              </p>
            </div>
            {result && result.comparisonRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px]">
                  <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <tr>
                      {['行号', '样本', '文本', '真值', 'Baseline', 'System', '对比结论'].map((header) => (
                        <th key={header} className="px-4 py-3 text-left text-sm font-semibold">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.comparisonRows.map((row) => (
                      <tr key={`compare-${row.rowIndex}`} className="border-t align-top" style={{ borderColor: 'var(--glass-border)' }}>
                        <td className="px-4 py-3 text-sm">{row.rowIndex}</td>
                        <td className="px-4 py-3 text-sm">{row.sampleId || '—'}</td>
                        <td className="px-4 py-3 text-sm max-w-[360px]">{row.text}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-2">
                            {row.groundTruthLabels.length > 0 ? row.groundTruthLabels.map((label) => (
                              <span key={`${row.rowIndex}-${label}`} className="px-2.5 py-1 rounded-full text-xs bg-slate-100 dark:bg-slate-800">
                                {label}
                              </span>
                            )) : <span style={{ color: 'var(--text-secondary)' }}>无</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium">{row.baselinePrediction.emotionName || '—'}</div>
                          <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {row.baselinePrediction.emotionCode || '—'} · {row.baselinePrediction.intensity || '—'}
                          </div>
                          <div className={`mt-2 inline-flex px-2 py-1 rounded-full text-xs ${row.baselineMatched ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                            {row.baselineMatched ? '命中' : '未命中'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium">{row.systemPrediction.emotionName || '—'}</div>
                          <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {row.systemPrediction.emotionCode || '—'} · {row.systemPrediction.intensity || '—'}
                          </div>
                          <div className={`mt-2 inline-flex px-2 py-1 rounded-full text-xs ${row.systemMatched ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                            {row.systemMatched ? '命中' : '未命中'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${winnerTone[row.winner]}`}>
                            {row.winner === 'baseline' ? 'Baseline 更好' : row.winner === 'system' ? 'CogniSync 更好' : row.winner === 'tie' ? '两者都命中' : '暂无胜者'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                还没有对比结果。完成一次实验后，这里会显示逐条对比主表。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
