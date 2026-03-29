import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

type MockStateSequence = unknown[];

const loadComponentWithStates = async (states: MockStateSequence) => {
  vi.resetModules();

  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    let index = 0;

    return {
      ...actual,
      useState: (initial: unknown) => {
        const value = index < states.length ? states[index] : initial;
        index += 1;
        return [value, vi.fn()] as const;
      },
      useEffect: vi.fn(),
      useCallback: (fn: unknown) => fn,
      useMemo: (factory: () => unknown) => factory(),
    };
  });

  vi.doMock('../lib/adminApi', () => ({
    adminApi: {},
  }));

  return import('./EmotionAnalytics');
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('EmotionAnalytics', () => {
  it('renders loading state markup', async () => {
    const { EmotionAnalytics } = await loadComponentWithStates([
      30,
      null,
      null,
      [],
      '',
      '',
      1,
      0,
      null,
      true,
      false,
      false,
      '',
      '',
    ]);

    const html = renderToStaticMarkup(<EmotionAnalytics />);
    expect(html).toContain('animate-spin');
  });

  it('renders analytics content when data is available', async () => {
    const { EmotionAnalytics } = await loadComponentWithStates([
      30,
      {
        totalLogs: 4,
        items: [
          {
            legacyEmotion: 'confused',
            emotionCode: 'E01',
            emotionName: 'confused',
            intensity: 'high',
            count: 2,
            percentage: 50,
            avgConfidence: 0.82,
          },
        ],
      },
      {
        days: 30,
        points: [
          {
            date: '2026-03-29',
            totalCount: 4,
            averageConfidence: 0.76,
            averageValence: 0.12,
            averageArousal: 0.35,
            emotionCounts: { E01: 2, E08: 1 },
          },
        ],
      },
      [
        {
          id: 'u1',
          student_id: '2026001',
          email: 'u1@example.com',
          name: '测试学生',
          role: 'student',
          is_active: true,
          created_at: '2026-03-29T10:20:30Z',
          last_active_at: null,
        },
      ],
      'u1',
      '测试',
      1,
      1,
      {
        summary: {
          userId: 'u1',
          studentId: '2026001',
          name: '测试学生',
          totalLogs: 3,
          lastAnalyzedAt: '2026-03-29T10:20:30Z',
          latestEmotionCode: 'E01',
          latestEmotionName: 'confused',
          currentCognition: 42,
          currentAffect: 48,
          currentBehavior: 55,
        },
        logs: [
          {
            id: 'log1',
            createdAt: '2026-03-29T10:20:30Z',
            sessionId: 'session1',
            messageId: 'message1',
            intent: 'help-seeking',
            emotion: 'confused',
            emotionCode: 'E01',
            emotionName: 'confused',
            intensity: 'high',
            confidence: 0.82,
            arousal: 0.35,
            valence: -0.55,
            detectedConcepts: ['反向传播'],
            evidence: ['还是不理解'],
            deltaCognition: -4,
            deltaAffect: -5,
            deltaBehavior: 3,
            profileCognition: 42,
            profileAffect: 48,
            profileBehavior: 55,
          },
        ],
      },
      false,
      false,
      false,
      '',
      '',
    ]);

    const html = renderToStaticMarkup(<EmotionAnalytics />);
    expect(html).toContain('情感统计分析');
    expect(html).toContain('情感分布');
    expect(html).toContain('confused');
    expect(html).toContain('测试学生');
    expect(html).toContain('反向传播');
    expect(html).toContain('当前关键词：测试');
  });
});
