import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Language, ProfileChange, UserProfile } from '../types';

type MetricKey = 'cognition' | 'affect' | 'behavior';

interface Props {
  profile: UserProfile;
  changes: ProfileChange[];
  language: Language;
  isLoading?: boolean;
}

interface TrendPoint {
  label: string;
  cognition: number;
  affect: number;
  behavior: number;
}

interface ChartSize {
  width: number;
  height: number;
}

const metricKeys: MetricKey[] = ['cognition', 'affect', 'behavior'];
const yTicks = [0, 25, 50, 75, 100];

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const isMetricKey = (value: string): value is MetricKey =>
  metricKeys.includes(value.toLowerCase() as MetricKey);

const formatTimestamp = (timestamp: string, language: Language) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return language === 'zh' ? '过程点' : 'Step';

  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const ProfileTrendChart: React.FC<Props> = ({ profile, changes, language, isLoading = false }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState<ChartSize>({ width: 640, height: 240 });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const labels = useMemo(() => ({
    cognition: language === 'zh' ? '认知' : 'Cognition',
    affect: language === 'zh' ? '情感' : 'Affect',
    behavior: language === 'zh' ? '行为' : 'Behavior',
  }), [language]);

  const trendData = useMemo<TrendPoint[]>(() => {
    const groupedChanges = new Map<string, Partial<Record<MetricKey, number>>>();

    for (const change of changes) {
      const dimension = change.dimension.toLowerCase();
      if (!isMetricKey(dimension)) continue;

      const group = groupedChanges.get(change.timestamp) ?? {};
      group[dimension] = (group[dimension] ?? 0) + change.change;
      groupedChanges.set(change.timestamp, group);
    }

    const groups = Array.from(groupedChanges.entries())
      .sort(([timeA], [timeB]) => new Date(timeB).getTime() - new Date(timeA).getTime())
      .slice(0, 7);

    if (groups.length === 0) {
      return [{
        label: language === 'zh' ? '当前' : 'Now',
        cognition: profile.cognition,
        affect: profile.affect,
        behavior: profile.behavior,
      }];
    }

    const cursor = {
      cognition: profile.cognition,
      affect: profile.affect,
      behavior: profile.behavior,
    };
    const pointsFromNewest: TrendPoint[] = [];

    for (const [timestamp, deltas] of groups) {
      pointsFromNewest.push({
        label: formatTimestamp(timestamp, language),
        cognition: clampScore(cursor.cognition),
        affect: clampScore(cursor.affect),
        behavior: clampScore(cursor.behavior),
      });

      for (const key of metricKeys) {
        cursor[key] = clampScore(cursor[key] - (deltas[key] ?? 0));
      }
    }

    pointsFromNewest.push({
      label: language === 'zh' ? '起点' : 'Start',
      cognition: clampScore(cursor.cognition),
      affect: clampScore(cursor.affect),
      behavior: clampScore(cursor.behavior),
    });

    return pointsFromNewest.reverse();
  }, [changes, language, profile.affect, profile.behavior, profile.cognition]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return undefined;

    const updateSize = () => {
      const nextWidth = Math.max(280, Math.round(element.clientWidth));
      const nextHeight = Math.max(210, Math.round(element.clientHeight));
      setChartSize(current => current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const margins = { top: 44, right: 22, bottom: 34, left: 44 };
    const plotWidth = Math.max(1, chartSize.width - margins.left - margins.right);
    const plotHeight = Math.max(1, chartSize.height - margins.top - margins.bottom);
    const xForIndex = (index: number) => margins.left + (trendData.length === 1
      ? plotWidth / 2
      : (index / (trendData.length - 1)) * plotWidth);
    const yForValue = (value: number) => margins.top + ((100 - clampScore(value)) / 100) * plotHeight;

    return { margins, plotWidth, plotHeight, xForIndex, yForValue };
  }, [chartSize.height, chartSize.width, trendData.length]);

  const series = useMemo(() => [
    { key: 'cognition' as const, label: labels.cognition, color: 'var(--brand-cyan)' },
    { key: 'affect' as const, label: labels.affect, color: 'var(--brand-blue)' },
    { key: 'behavior' as const, label: labels.behavior, color: 'var(--brand-amber)' },
  ], [labels.affect, labels.behavior, labels.cognition]);

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (trendData.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const relativeX = Math.max(0, Math.min(geometry.plotWidth, pointerX - geometry.margins.left));
    const nextIndex = trendData.length === 1
      ? 0
      : Math.round((relativeX / geometry.plotWidth) * (trendData.length - 1));
    setActiveIndex(current => current === nextIndex ? current : nextIndex);
  };

  if (isLoading) {
    return <div className="profile-trend-loading" aria-label={language === 'zh' ? '正在加载画像变化' : 'Loading profile changes'} />;
  }

  const activePoint = activeIndex === null ? null : trendData[activeIndex];
  const activeX = activeIndex === null ? 0 : geometry.xForIndex(activeIndex);

  return (
    <div
      ref={chartRef}
      className="profile-trend-chart"
      aria-label={changes.length === 0
        ? (language === 'zh' ? '当前认知、情感和行为画像，暂无历史变化' : 'Current cognition, affect, and behavior profile with no historical changes yet')
        : (language === 'zh' ? '认知、情感和行为近期变化折线图' : 'Recent cognition, affect, and behavior trend chart')}
    >
      <div className="profile-trend-legend" aria-hidden="true">
        {series.map(item => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      <svg
        className="profile-trend-svg"
        viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
        role="img"
      >
        {yTicks.map(tick => {
          const y = geometry.yForValue(tick);
          return (
            <g key={tick}>
              <line
                x1={geometry.margins.left}
                x2={geometry.margins.left + geometry.plotWidth}
                y1={y}
                y2={y}
                className="profile-trend-gridline"
              />
              <text x={geometry.margins.left - 9} y={y + 4} textAnchor="end" className="profile-trend-axis-label">
                {tick}
              </text>
            </g>
          );
        })}

        {trendData.map((point, index) => {
          const shouldShowLabel = trendData.length <= 4
            || index === 0
            || index === trendData.length - 1
            || index === Math.floor((trendData.length - 1) / 2);
          if (!shouldShowLabel) return null;
          return (
            <text
              key={`${point.label}-${index}`}
              x={geometry.xForIndex(index)}
              y={chartSize.height - 10}
              textAnchor={index === 0 ? 'start' : index === trendData.length - 1 ? 'end' : 'middle'}
              className="profile-trend-axis-label"
            >
              {point.label}
            </text>
          );
        })}

        {activeIndex !== null && (
          <line
            x1={activeX}
            x2={activeX}
            y1={geometry.margins.top}
            y2={geometry.margins.top + geometry.plotHeight}
            className="profile-trend-cursor"
          />
        )}

        {series.map(item => {
          const points = trendData
            .map((point, index) => `${geometry.xForIndex(index)},${geometry.yForValue(point[item.key])}`)
            .join(' ');

          return (
            <g key={item.key}>
              <polyline
                points={points}
                fill="none"
                stroke={item.color}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {trendData.map((point, index) => (
                <circle
                  key={`${item.key}-${index}`}
                  cx={geometry.xForIndex(index)}
                  cy={geometry.yForValue(point[item.key])}
                  r={activeIndex === index ? 6 : 4}
                  fill="var(--surface-strong)"
                  stroke={item.color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          );
        })}
      </svg>

      {activePoint && (
        <div
          className="profile-trend-tooltip"
          style={{ left: Math.max(82, Math.min(chartSize.width - 82, activeX)) }}
        >
          <strong>{activePoint.label}</strong>
          {series.map(item => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label} {activePoint[item.key]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
