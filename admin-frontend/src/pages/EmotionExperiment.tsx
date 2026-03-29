import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FlaskConical, History, Loader2, RefreshCw, Upload } from 'lucide-react';

import { adminApi } from '../lib/adminApi';
import type { EmotionExperimentResult, EmotionExperimentRunItem } from '../types';

type FormState = {
  textColumn: string;
  conversationIdColumn: string;
  speakerColumn: string;
  expectedLabelColumn: string;
  expectedLabelColumnsText: string;
  expectedLabelMode: 'single' | 'multi_binary';
  positiveLabelValue: string;
  profileKeyColumn: string;
  labelMappingJson: string;
  previewLimit: number;
};

const initialFormState: FormState = {
  textColumn: 'text',
  conversationIdColumn: 'dialogue_id',
  speakerColumn: 'speaker',
  expectedLabelColumn: 'label',
  expectedLabelColumnsText: '',
  expectedLabelMode: 'single',
  positiveLabelValue: '1',
  profileKeyColumn: '',
  labelMappingJson: '{\n  "困惑": ["confused", "E01"],\n  "积极": ["motivated", "excited", "E08", "E07"]\n}',
  previewLimit: 20,
};

const normalizeExperimentError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '实验分析失败';
  if (message.includes('413') || message.includes('Request Entity Too Large')) {
    return '上传文件过大，当前服务已放宽限制。请刷新后重试；如果仍失败，请先压缩 CSV 或减少无关列。';
  }
  if (message.includes('missing required text column')) {
    return `文本列配置错误：${message}`;
  }
  if (message.includes('missing expected label columns')) {
    return `多标签列配置错误：${message}`;
  }
  if (message.includes('expected_label_columns_json')) {
    return '多标签列配置必须是有效的列名列表。请使用英文逗号分隔，例如 joy,sadness,anger。';
  }
  return message;
};

const downloadCsv = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const EmotionExperiment = () => {
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [result, setResult] = useState<EmotionExperimentResult | null>(null);
  const [historyRuns, setHistoryRuns] = useState<EmotionExperimentRunItem[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const accuracyText = useMemo(() => {
    if (!result || result.summary.comparedRows === 0) return '未提供原始标签，暂不计算对比准确率';
    const accuracy = (result.summary.matchedRows / result.summary.comparedRows) * 100;
    return `标签对比命中率 ${accuracy.toFixed(1)}%`;
  }, [result]);

  const labelMappingPreview = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.labelMapping);
  }, [result]);

  const loadHistory = useCallback(async (selectedRunId?: string) => {
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const response = await adminApi.getEmotionExperimentRuns(20, 0);
      setHistoryRuns(response.runs);
      if (!selectedRunId && !activeRunId && response.runs.length > 0) {
        setActiveRunId(response.runs[0].id);
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : '加载实验历史失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [activeRunId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      setDetailLoading(true);
      setHistoryError('');
      const detail = await adminApi.getEmotionExperimentRunDetail(runId);
      setResult(detail);
      setActiveRunId(runId);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : '加载实验详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleAnalyze = async () => {
    if (!file) {
      setError('请先选择公开对话数据集 CSV 文件');
      return;
    }

    if (!form.textColumn.trim()) {
      setError('文本列不能为空');
      return;
    }

    try {
      const normalizedLabelMapping = form.labelMappingJson.trim();
      const normalizedExpectedLabelColumns = form.expectedLabelColumnsText
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      if (normalizedLabelMapping) {
        const parsed = JSON.parse(normalizedLabelMapping) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('标签映射必须是 JSON 对象，例如 {"困惑": ["confused", "E01"]}');
        }
      }
      if (form.expectedLabelMode === 'multi_binary' && normalizedExpectedLabelColumns.length === 0) {
        throw new Error('多标签模式下，请填写 0/1 标签列名列表，例如 joy,sadness,anger');
      }

      setSubmitting(true);
      setError('');
      const nextResult = await adminApi.analyzeEmotionExperimentCsv({
        file,
        textColumn: form.textColumn.trim(),
        conversationIdColumn: form.conversationIdColumn.trim() || undefined,
        speakerColumn: form.speakerColumn.trim() || undefined,
        expectedLabelColumn:
          form.expectedLabelMode === 'single'
            ? form.expectedLabelColumn.trim() || undefined
            : undefined,
        expectedLabelColumnsJson:
          form.expectedLabelMode === 'multi_binary'
            ? JSON.stringify(normalizedExpectedLabelColumns)
            : undefined,
        positiveLabelValue:
          form.expectedLabelMode === 'multi_binary'
            ? form.positiveLabelValue.trim() || '1'
            : undefined,
        profileKeyColumn: form.profileKeyColumn.trim() || undefined,
        labelMappingJson: normalizedLabelMapping || undefined,
        previewLimit: form.previewLimit,
      });
      setResult(nextResult);
      setActiveRunId(nextResult.experimentId ?? null);
      await loadHistory(nextResult.experimentId ?? undefined);
    } catch (err) {
      setError(normalizeExperimentError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">情感实验台</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            上传公开对话数据集，逐句生成情感标签与三维画像轨迹，并导出可对比的 CSV 结果。
          </p>
        </div>
        {result && (
          <button
            onClick={() => downloadCsv(result.csvContent, result.fileName)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            <Download size={18} />
            下载 CSV
          </button>
        )}
      </div>

      {error && (
        <div
          className="glass-card p-4 rounded-xl border"
          style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}
        >
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6">
        <section className="glass-card rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <FlaskConical size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">实验配置</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                配置列映射后即可调用当前系统批量分析。
              </p>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">公开数据集 CSV</span>
            <div className="mt-2">
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <Upload size={18} />
                <span className="text-sm">
                  {file ? `已选择：${file.name}` : '点击上传 UTF-8 CSV 文件'}
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
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
              onChange={(event) => setForm((prev) => ({ ...prev, textColumn: event.target.value }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              placeholder="text"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">会话列</span>
            <input
              value={form.conversationIdColumn}
              onChange={(event) => setForm((prev) => ({ ...prev, conversationIdColumn: event.target.value }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              placeholder="dialogue_id"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">说话人列</span>
            <input
              value={form.speakerColumn}
              onChange={(event) => setForm((prev) => ({ ...prev, speakerColumn: event.target.value }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              placeholder="speaker"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">标签模式</span>
            <select
              value={form.expectedLabelMode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  expectedLabelMode: event.target.value as FormState['expectedLabelMode'],
                }))
              }
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            >
              <option value="single">单标签列</option>
              <option value="multi_binary">多标签 0/1 列</option>
            </select>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              如果数据集是一列标签，选“单标签列”；如果是多列 one-hot 标签，选“多标签 0/1 列”。
            </p>
          </label>

          {form.expectedLabelMode === 'single' ? (
            <label className="block">
              <span className="text-sm font-medium">原始标签列</span>
              <input
                value={form.expectedLabelColumn}
                onChange={(event) => setForm((prev) => ({ ...prev, expectedLabelColumn: event.target.value }))}
                className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
                placeholder="label"
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium">多标签列名</span>
                <textarea
                  value={form.expectedLabelColumnsText}
                  onChange={(event) => setForm((prev) => ({ ...prev, expectedLabelColumnsText: event.target.value }))}
                  className="mt-2 min-h-[96px] w-full rounded-xl border px-3 py-2 bg-transparent font-mono text-xs"
                  placeholder="joy,sadness,anger,fear,surprise"
                />
                <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  你的数据集第一列是文本、后面 21 列是 0/1 标签时，把这 21 个列名按英文逗号填进来。
                </p>
              </label>

              <label className="block">
                <span className="text-sm font-medium">正样本取值</span>
                <input
                  value={form.positiveLabelValue}
                  onChange={(event) => setForm((prev) => ({ ...prev, positiveLabelValue: event.target.value }))}
                  className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
                  placeholder="1"
                />
                <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  默认 1 表示该情绪成立；如果数据集使用 true/yes，也可以填成 1,true,yes。
                </p>
              </label>
            </>
          )}

          <label className="block">
            <span className="text-sm font-medium">画像分组列</span>
            <input
              value={form.profileKeyColumn}
              onChange={(event) => setForm((prev) => ({ ...prev, profileKeyColumn: event.target.value }))}
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
              placeholder="user_id（可选）"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">预览行数</span>
            <input
              type="number"
              min={1}
              max={100}
              value={form.previewLimit}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, previewLimit: Number(event.target.value) || 20 }))
              }
              className="mt-2 w-full rounded-xl border px-3 py-2 bg-transparent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">标签映射 JSON</span>
            <textarea
              value={form.labelMappingJson}
              onChange={(event) => setForm((prev) => ({ ...prev, labelMappingJson: event.target.value }))}
              className="mt-2 min-h-[160px] w-full rounded-xl border px-3 py-2 bg-transparent font-mono text-xs"
              placeholder='{"困惑": ["confused", "E01"]}'
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              允许把公开数据集原标签映射到系统标签、编码或情感名称，例如 “困惑 → confused / E01”。
            </p>
          </label>

          <button
            onClick={handleAnalyze}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium disabled:opacity-60"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <FlaskConical size={18} />}
            {submitting ? '正在分析数据集…' : '开始实验分析'}
          </button>
        </section>

        <section className="space-y-6">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <History size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">实验历史</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    查看最近实验记录，回看配置与结果，并重新下载 CSV。
                  </p>
                </div>
              </div>
              <button
                onClick={() => void loadHistory()}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                disabled={historyLoading}
              >
                <RefreshCw size={16} className={historyLoading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>

            {historyError && (
              <div
                className="mb-4 rounded-xl border px-4 py-3 text-sm"
                style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#ef4444' }}
              >
                {historyError}
              </div>
            )}

            {historyRuns.length > 0 ? (
              <div className="space-y-3">
                {historyRuns.map((run) => {
                  const isActive = activeRunId === run.id;
                  const compareRate =
                    run.summary.comparedRows > 0
                      ? ((run.summary.matchedRows / run.summary.comparedRows) * 100).toFixed(1)
                      : null;

                  return (
                    <button
                      key={run.id}
                      onClick={() => void loadRunDetail(run.id)}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                        isActive ? 'border-indigo-500 shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold">{run.originalFilename}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {new Date(run.createdAt).toLocaleString()} · 文本列 {run.textColumn}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{run.summary.analyzedRows} 行</p>
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {compareRate ? `对比命中 ${compareRate}%` : '无对比标签'}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                {historyLoading ? '正在加载实验历史…' : '还没有实验历史记录。'}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: '处理总行数', value: result?.summary.rowsProcessed ?? 0 },
              { label: '有效分析行', value: result?.summary.analyzedRows ?? 0 },
              { label: '对比样本数', value: result?.summary.comparedRows ?? 0 },
              { label: '命中标签数', value: result?.summary.matchedRows ?? 0 },
            ].map((item) => (
              <div key={item.label} className="glass-card rounded-2xl p-5">
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                  {item.label}
                </p>
                <p className="text-3xl font-bold">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-semibold">实验摘要</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {accuracyText}
                </p>
              </div>
              {result && (
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  检测列：{result.detectedColumns.join(', ') || '无'}
                </div>
              )}
            </div>
            {result ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div className="rounded-xl border p-4">
                  <p className="mb-1" style={{ color: 'var(--text-secondary)' }}>跳过空行</p>
                  <p className="text-xl font-semibold">{result.summary.rowsSkipped}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="mb-1" style={{ color: 'var(--text-secondary)' }}>画像实体数</p>
                  <p className="text-xl font-semibold">{result.summary.uniqueProfiles}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="mb-1" style={{ color: 'var(--text-secondary)' }}>对话会话数</p>
                  <p className="text-xl font-semibold">{result.summary.uniqueConversations}</p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="mb-1" style={{ color: 'var(--text-secondary)' }}>实验记录 ID</p>
                  <p className="text-sm font-semibold break-all">{result.experimentId || '未保存'}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                尚未运行实验。上传 CSV 并配置列映射后，这里会显示批处理统计摘要。
              </div>
            )}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-semibold">标签映射</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  当前实验使用的原标签到系统标签映射
                </p>
              </div>
            </div>
            {labelMappingPreview.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {labelMappingPreview.map(([sourceLabel, targets]) => (
                  <div key={sourceLabel} className="rounded-xl border p-4">
                    <p className="text-sm font-semibold mb-2">{sourceLabel}</p>
                    <div className="flex flex-wrap gap-2">
                      {targets.map((target) => (
                        <span
                          key={`${sourceLabel}-${target}`}
                          className="px-2.5 py-1 rounded-full text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                        >
                          {target}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                当前实验未提供标签映射，将使用原标签与系统标签直接比较。
              </div>
            )}
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">结果预览</h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  预览系统标签、画像变化与原始标签对比结果
                </p>
              </div>
              {detailLoading && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 size={16} className="animate-spin" />
                  正在加载历史详情…
                </div>
              )}
            </div>
            {result && result.previewRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <tr>
                      {[
                        '行号',
                        '会话',
                        '文本',
                        '旧标签',
                        '编码',
                        '强度',
                        '置信度',
                        '画像前',
                        '画像后',
                        '对比',
                      ].map((header) => (
                        <th key={header} className="px-4 py-3 text-left text-sm font-semibold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.previewRows.map((row) => (
                      <tr
                        key={`${row.conversationId}-${row.rowIndex}`}
                        className="border-t align-top"
                        style={{ borderColor: 'var(--glass-border)' }}
                      >
                        <td className="px-4 py-3 text-sm">{row.rowIndex}</td>
                        <td className="px-4 py-3 text-sm">
                          <div>{row.conversationId}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {row.profileKey}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm max-w-[420px]">
                          <div className="font-medium mb-1">{row.text}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {row.speaker || '未提供说话人'} · {row.intent}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {row.expectedLabel || <span style={{ color: 'var(--text-secondary)' }}>无</span>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium">{row.emotionCode}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {row.emotionName} / {row.emotion}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">{row.intensity}</td>
                        <td className="px-4 py-3 text-sm">{(row.confidence * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3 text-sm">
                          C {row.profileCognitionBefore} / A {row.profileAffectBefore} / B {row.profileBehaviorBefore}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          C {row.profileCognitionAfter} / A {row.profileAffectAfter} / B {row.profileBehaviorAfter}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {row.expectedMatches === null ? (
                            <span style={{ color: 'var(--text-secondary)' }}>未对比</span>
                          ) : row.expectedMatches ? (
                            <span className="text-emerald-600 font-medium">匹配</span>
                          ) : (
                            <span className="text-rose-600 font-medium">不匹配</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                还没有可显示的实验结果。完成一次分析后，这里会展示逐句标签预览。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
