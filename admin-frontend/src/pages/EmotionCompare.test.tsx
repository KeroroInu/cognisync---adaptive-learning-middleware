import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const setState = vi.fn();

async function loadComponentWithStates(states: unknown[]) {
  vi.resetModules();
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
      ...actual,
      useState: vi.fn(() => [states.shift(), setState]),
    };
  });
  const module = await import('./EmotionCompare');
  return { EmotionCompare: module.EmotionCompare };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.doUnmock('react');
});

describe('EmotionCompare', () => {
  it('renders initial configuration state', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      null,
      null,
      null,
      'base',
      '',
      '',
      false,
      [],
      false,
      '',
      null,
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('情感对比实验');
    expect(html).toContain('实验历史');
    expect(html).toContain('中文微博单标签');
    expect(html).toContain('开始对比实验');
    expect(html).toContain('文本列');
  });

  it('renders base tab results and summary metrics', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      {
        datasetInfo: {
          datasetName: 'usual_train.xlsx',
          sourceFormat: 'xlsx',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 2,
          rowsSkipped: 0,
          labelCount: 6,
          labels: ['angry', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
        },
        baselineRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天心情不错',
            predictedEmotionCode: 'E13',
            predictedEmotionName: 'neutral',
            predictedIntensity: 'medium',
            confidence: 0.4,
            rawLabel: 'neutral',
          },
        ],
        systemRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天心情不错',
            predictedEmotionCode: 'E07',
            predictedEmotionName: 'excited',
            predictedIntensity: 'high',
            confidence: 0.8,
            profileBefore: { cognition: 50, affect: 50, behavior: 50 },
            profileAfter: { cognition: 51, affect: 56, behavior: 52 },
            delta: { cognition: 1, affect: 6, behavior: 2 },
            contextUsed: { dialogue: false, profile: true, knowledge: false },
          },
        ],
        comparisonRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天心情不错',
            groundTruthLabels: ['happy'],
            baselinePrediction: {
              emotionCode: 'E13',
              emotionName: 'neutral',
              intensity: 'medium',
              confidence: 0.4,
              rawLabel: 'neutral',
            },
            systemPrediction: {
              emotionCode: 'E07',
              emotionName: 'excited',
              intensity: 'high',
              confidence: 0.8,
              rawLabel: 'excited',
            },
            baselineMatched: false,
            systemMatched: true,
            winner: 'system',
          },
        ],
        summaryMetrics: {
          taskType: 'single_label',
          support: 2,
          labelCount: 6,
          labels: ['angry', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
          baseline: { accuracy: 0.5, macroF1: 0.4, weightedF1: 0.45 },
          system: { accuracy: 1, macroF1: 0.8, weightedF1: 0.85 },
        },
        exportArtifacts: {
          comparisonCsvFileName: 'compare.csv',
          comparisonCsvContent: 'rowIndex,text\n1,今天心情不错',
          resultJsonFileName: 'compare.json',
        },
      },
      {
        base: {
          datasetInfo: {
            datasetName: 'usual_train.xlsx',
            sourceFormat: 'xlsx',
            taskType: 'single_label',
            datasetTemplate: 'weibo_single',
            sampleIdColumn: 'id',
            textColumn: 'content',
            expectedLabelColumn: 'label',
            expectedLabelColumns: [],
            positiveLabelValue: null,
            rowsProcessed: 2,
            rowsSkipped: 0,
            labelCount: 6,
            labels: ['angry', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
          },
          baselineRows: [
            {
              rowIndex: 1,
              sampleId: '1',
              text: '今天心情不错',
              predictedEmotionCode: 'E13',
              predictedEmotionName: 'neutral',
              predictedIntensity: 'medium',
              confidence: 0.4,
              rawLabel: 'neutral',
            },
          ],
          systemRows: [
            {
              rowIndex: 1,
              sampleId: '1',
              text: '今天心情不错',
              predictedEmotionCode: 'E07',
              predictedEmotionName: 'excited',
              predictedIntensity: 'high',
              confidence: 0.8,
              profileBefore: { cognition: 50, affect: 50, behavior: 50 },
              profileAfter: { cognition: 51, affect: 56, behavior: 52 },
              delta: { cognition: 1, affect: 6, behavior: 2 },
              contextUsed: { dialogue: false, profile: true, knowledge: false },
            },
          ],
          comparisonRows: [
            {
              rowIndex: 1,
              sampleId: '1',
              text: '今天心情不错',
              groundTruthLabels: ['happy'],
              baselinePrediction: {
                emotionCode: 'E13',
                emotionName: 'neutral',
                intensity: 'medium',
                confidence: 0.4,
                rawLabel: 'neutral',
              },
              systemPrediction: {
                emotionCode: 'E07',
                emotionName: 'excited',
                intensity: 'high',
                confidence: 0.8,
                rawLabel: 'excited',
              },
              baselineMatched: false,
              systemMatched: true,
              winner: 'system',
            },
          ],
          summaryMetrics: {
            taskType: 'single_label',
            support: 2,
            labelCount: 6,
            labels: ['angry', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
            baseline: { accuracy: 0.5, macroF1: 0.4, weightedF1: 0.45 },
            system: { accuracy: 1, macroF1: 0.8, weightedF1: 0.85 },
          },
          exportArtifacts: {
            comparisonCsvFileName: 'compare.csv',
            comparisonCsvContent: 'rowIndex,text\n1,今天心情不错',
            resultJsonFileName: 'compare.json',
          },
        },
        perClassMetrics: [],
        confusionAnalysis: { taskType: 'single_label', labels: ['happy'], baselineMatrix: [[1]], systemMatrix: [[1]], available: true },
        agreementMetrics: {
          taskType: 'single_label',
          baseline: { overallAgreement: 0.5, observedAgreement: 0.5, expectedAgreement: 0.25, cohensKappa: 0.33 },
          system: { overallAgreement: 1, observedAgreement: 1, expectedAgreement: 0.5, cohensKappa: 1 },
          available: true,
        },
        intensityMetrics: {
          baseline: { intensityAccuracy: null, intensityMAE: null, support: 0 },
          system: { intensityAccuracy: null, intensityMAE: null, support: 0 },
          available: false,
          note: '当前公开数据集缺少可靠强度真值',
        },
      },
      {
        datasetInfo: {
          datasetName: 'usual_train.xlsx',
          sourceFormat: 'xlsx',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 2,
          rowsSkipped: 0,
          labelCount: 6,
          labels: ['angry', 'fear', 'happy', 'neutral', 'sad', 'surprise'],
        },
        variants: [],
      },
      'base',
      '',
      '',
      false,
      [],
      false,
      '',
      null,
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('总体指标');
    expect(html).toContain('Baseline Accuracy');
    expect(html).toContain('100.0%');
    expect(html).toContain('导出 CSV');
    expect(html).toContain('CogniSync 更好');
    expect(html).toContain('今天心情不错');
  });

  it('renders base results when phase2 requests partially fail', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      {
        datasetInfo: {
          datasetName: 'usual_train.txt',
          sourceFormat: 'json',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 1,
          rowsSkipped: 0,
          labelCount: 1,
          labels: ['happy'],
        },
        baselineRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天真开心',
            predictedEmotionCode: 'E13',
            predictedEmotionName: 'neutral',
            predictedIntensity: 'medium',
            confidence: 0.5,
            rawLabel: 'neutral',
          },
        ],
        systemRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天真开心',
            predictedEmotionCode: 'E07',
            predictedEmotionName: 'excited',
            predictedIntensity: 'high',
            confidence: 0.9,
            profileBefore: { cognition: 50, affect: 50, behavior: 50 },
            profileAfter: { cognition: 51, affect: 57, behavior: 52 },
            delta: { cognition: 1, affect: 7, behavior: 2 },
            contextUsed: { dialogue: false, profile: true, knowledge: false },
          },
        ],
        comparisonRows: [
          {
            rowIndex: 1,
            sampleId: '1',
            text: '今天真开心',
            groundTruthLabels: ['happy'],
            baselinePrediction: {
              emotionCode: 'E13',
              emotionName: 'neutral',
              intensity: 'medium',
              confidence: 0.5,
              rawLabel: 'neutral',
            },
            systemPrediction: {
              emotionCode: 'E07',
              emotionName: 'excited',
              intensity: 'high',
              confidence: 0.9,
              rawLabel: 'excited',
            },
            baselineMatched: false,
            systemMatched: true,
            winner: 'system',
          },
        ],
        summaryMetrics: {
          taskType: 'single_label',
          support: 1,
          labelCount: 1,
          labels: ['happy'],
          baseline: { accuracy: 0, macroF1: 0, weightedF1: 0 },
          system: { accuracy: 1, macroF1: 1, weightedF1: 1 },
        },
        exportArtifacts: {
          comparisonCsvFileName: 'compare.csv',
          comparisonCsvContent: 'rowIndex,text\n1,今天真开心',
          resultJsonFileName: 'compare.json',
        },
      },
      null,
      null,
      'base',
      '',
      '论文指标扩展未加载成功：示例；消融实验结果未加载成功：示例',
      false,
      [],
      false,
      '',
      'run-1',
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('论文指标扩展未加载成功：示例');
    expect(html).toContain('消融实验结果未加载成功：示例');
    expect(html).toContain('今天真开心');
    expect(html).toContain('CogniSync 更好');
    expect(html).toContain('导出 JSON');
  });

  it('renders phase2 metrics tab with unavailable states', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'goemotions_multi',
        labelMode: 'multi_binary',
        textColumn: 'text',
        expectedLabelColumn: '',
        expectedLabelColumnsText: 'joy,confusion',
        positiveLabelValue: '1',
        sampleIdColumn: '',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      null,
      {
        base: {
          datasetInfo: {
            datasetName: 'goemotions.csv',
            sourceFormat: 'csv',
            taskType: 'multi_label',
            datasetTemplate: 'goemotions_multi',
            sampleIdColumn: null,
            textColumn: 'text',
            expectedLabelColumn: null,
            expectedLabelColumns: ['joy', 'confusion'],
            positiveLabelValue: '1',
            rowsProcessed: 2,
            rowsSkipped: 0,
            labelCount: 2,
            labels: ['joy', 'confusion'],
          },
          baselineRows: [],
          systemRows: [],
          comparisonRows: [],
          summaryMetrics: {
            taskType: 'multi_label',
            support: 2,
            labelCount: 2,
            labels: ['joy', 'confusion'],
            baseline: { exactMatch: 0.5, overlapMatch: 0.5, microF1: 0.5, macroF1: 0.5, labelWiseMetrics: [] },
            system: { exactMatch: 1, overlapMatch: 1, microF1: 1, macroF1: 1, labelWiseMetrics: [] },
          },
          exportArtifacts: {
            comparisonCsvFileName: 'compare.csv',
            comparisonCsvContent: 'x',
            resultJsonFileName: 'compare.json',
          },
        },
        perClassMetrics: [
          {
            label: 'joy',
            support: 1,
            baselinePrecision: 0,
            baselineRecall: 0,
            baselineF1: 0,
            systemPrecision: 1,
            systemRecall: 1,
            systemF1: 1,
          },
        ],
        confusionAnalysis: { taskType: 'multi_label', labels: [], baselineMatrix: [], systemMatrix: [], available: false },
        agreementMetrics: {
          taskType: 'multi_label',
          baseline: { overallAgreement: null, observedAgreement: null, expectedAgreement: null, cohensKappa: null },
          system: { overallAgreement: null, observedAgreement: null, expectedAgreement: null, cohensKappa: null },
          available: false,
        },
        intensityMetrics: {
          baseline: { intensityAccuracy: null, intensityMAE: null, support: 0 },
          system: { intensityAccuracy: null, intensityMAE: null, support: 0 },
          available: false,
          note: '当前公开数据集缺少可靠强度真值',
        },
      },
      null,
      'metrics',
      '',
      '论文指标扩展未加载成功：示例',
      false,
      [],
      false,
      '',
      null,
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('论文指标扩展');
    expect(html).toContain('Per-class Metrics');
    expect(html).toContain('joy');
    expect(html).toContain('当前任务类型暂无 confusion matrix');
    expect(html).toContain('当前公开数据集缺少可靠强度真值');
  });

  it('renders ablation tab with placeholder variants', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      null,
      null,
      {
        datasetInfo: {
          datasetName: 'weibo.csv',
          sourceFormat: 'csv',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 2,
          rowsSkipped: 0,
          labelCount: 6,
          labels: ['happy'],
        },
        variants: [
          {
            variantKey: 'baseline_text_only',
            variantName: '纯文本基线',
            taskType: 'single_label',
            implemented: true,
            note: null,
            contexts: { profile: false, dialogue: false, knowledge: false },
            support: 2,
            summary: { accuracy: 0, macroF1: 0, weightedF1: 0, exactMatch: null, overlapMatch: null, microF1: null },
            deltaVsBaseline: { deltaAccuracy: 0, deltaMacroF1: 0, deltaWeightedF1: 0, deltaExactMatch: null, deltaOverlapMatch: null, deltaMicroF1: null },
          },
          {
            variantKey: 'system_dialogue_only',
            variantName: '仅对话上下文',
            taskType: 'single_label',
            implemented: false,
            note: '当前第二阶段 backend 尚未接入真实对话上下文分析链，先保留统一结构。',
            contexts: { profile: false, dialogue: true, knowledge: false },
            support: 2,
            summary: { accuracy: null, macroF1: null, weightedF1: null, exactMatch: null, overlapMatch: null, microF1: null },
            deltaVsBaseline: { deltaAccuracy: null, deltaMacroF1: null, deltaWeightedF1: null, deltaExactMatch: null, deltaOverlapMatch: null, deltaMicroF1: null },
          },
        ],
      },
      'ablation',
      '',
      '',
      false,
      [],
      false,
      '',
      null,
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('消融实验');
    expect(html).toContain('纯文本基线');
    expect(html).toContain('仅对话上下文');
    expect(html).toContain('占位 / 待接入');
    expect(html).toContain('当前第二阶段 backend 尚未接入真实对话上下文分析链');
  });

  it('renders ablation empty state when ablation request fails after base success', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      {
        datasetInfo: {
          datasetName: 'weibo.csv',
          sourceFormat: 'csv',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 2,
          rowsSkipped: 0,
          labelCount: 6,
          labels: ['happy'],
        },
        baselineRows: [],
        systemRows: [],
        comparisonRows: [],
        summaryMetrics: {
          taskType: 'single_label',
          support: 2,
          labelCount: 6,
          labels: ['happy'],
          baseline: { accuracy: 0, macroF1: 0, weightedF1: 0 },
          system: { accuracy: 1, macroF1: 1, weightedF1: 1 },
        },
        exportArtifacts: {
          comparisonCsvFileName: 'compare.csv',
          comparisonCsvContent: 'x',
          resultJsonFileName: 'compare.json',
        },
      },
      null,
      null,
      'ablation',
      '',
      '消融实验结果未加载成功：示例',
      false,
      [],
      false,
      '',
      null,
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('消融实验结果未加载成功：示例');
    expect(html).toContain('还没有消融实验结果');
    expect(html).toContain('数据集解释');
  });

  it('renders history runs with active replay state', async () => {
    const { EmotionCompare } = await loadComponentWithStates([
      null,
      {
        datasetTemplate: 'weibo_single',
        labelMode: 'single_label',
        textColumn: 'content',
        expectedLabelColumn: 'label',
        expectedLabelColumnsText: '',
        positiveLabelValue: '1',
        sampleIdColumn: 'id',
        labelMappingJson: '{}',
        previewLimit: 20,
      },
      {
        runId: 'run-1',
        datasetInfo: {
          datasetName: 'weibo.csv',
          sourceFormat: 'csv',
          taskType: 'single_label',
          datasetTemplate: 'weibo_single',
          sampleIdColumn: 'id',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          positiveLabelValue: null,
          rowsProcessed: 2,
          rowsSkipped: 0,
          labelCount: 2,
          labels: ['happy', 'sad'],
        },
        baselineRows: [],
        systemRows: [],
        comparisonRows: [],
        summaryMetrics: {
          taskType: 'single_label',
          support: 2,
          labelCount: 2,
          labels: ['happy', 'sad'],
          baseline: { accuracy: 0.5, macroF1: 0.4, weightedF1: 0.45 },
          system: { accuracy: 1, macroF1: 1, weightedF1: 1 },
        },
        exportArtifacts: {
          comparisonCsvFileName: 'compare.csv',
          comparisonCsvContent: 'x',
          resultJsonFileName: 'compare.json',
        },
      },
      null,
      null,
      'base',
      '',
      '',
      false,
      [
        {
          id: 'run-1',
          originalFilename: 'weibo.csv',
          datasetTemplate: 'weibo_single',
          labelMode: 'single_label',
          sourceFormat: 'csv',
          taskType: 'single_label',
          textColumn: 'content',
          expectedLabelColumn: 'label',
          expectedLabelColumns: [],
          sampleIdColumn: 'id',
          summaryMetrics: {
            taskType: 'single_label',
            support: 2,
            labelCount: 2,
            labels: ['happy', 'sad'],
            baseline: { accuracy: 0.5, macroF1: 0.4, weightedF1: 0.45 },
            system: { accuracy: 1, macroF1: 1, weightedF1: 1 },
          },
          createdAt: '2026-03-30T10:20:30+00:00',
        },
      ],
      false,
      '',
      'run-1',
      true,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('实验历史');
    expect(html).toContain('weibo.csv');
    expect(html).toContain('当前展示');
    expect(html).toContain('System Acc 100.0%');
    expect(html).toContain('正在回放…');
    expect(html).toContain('正在加载历史详情');
  });
});
