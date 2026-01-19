import React from 'react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts';
import { UserProfile, Language } from '../types';
import { translations } from '../utils/translations';

interface Props {
  data: UserProfile;
  compareData?: UserProfile; // If provided, shows a second overlapping chart
  showLegend?: boolean;
  language?: Language;
}

export const RadarDisplay: React.FC<Props> = ({ data, compareData, showLegend = false, language = 'zh' }) => {
  const t = translations[language];

  const chartData = [
    { subject: t.cognition, A: data.cognition, B: compareData?.cognition || 0, fullMark: 100 },
    { subject: t.affect, A: data.affect, B: compareData?.affect || 0, fullMark: 100 },
    { subject: t.behavior, A: data.behavior, B: compareData?.behavior || 0, fullMark: 100 },
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
        <PolarGrid stroke="#334155" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
        
        <Radar
          name={t.modelLabel}
          dataKey="A"
          stroke="#6366f1"
          strokeWidth={3}
          fill="#6366f1"
          fillOpacity={0.4}
        />
        
        {compareData && (
          <Radar
            name={t.userLabel}
            dataKey="B"
            stroke="#10b981"
            strokeWidth={3}
            fill="#10b981"
            fillOpacity={0.4}
          />
        )}
        
        {showLegend && <Legend wrapperStyle={{ color: '#cbd5e1' }} />}
      </RadarChart>
    </ResponsiveContainer>
  );
};