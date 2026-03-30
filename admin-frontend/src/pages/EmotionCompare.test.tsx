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
      '',
      false,
    ]);

    const html = renderToStaticMarkup(<EmotionCompare />);

    expect(html).toContain('情感对比实验');
    expect(html).toContain('中文微博单标签');
    expect(html).toContain('开始对比实验');
    expect(html).toContain('文本列');
  });

  it('renders compare results and summary metrics', async () => {
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
      '',
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
});
