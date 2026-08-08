import React, { useState, useEffect } from 'react';
import { RadarDisplay } from '../components/RadarDisplay';
import { SpotlightCard } from '../components/SpotlightCard';
import { LearnerCardDeck } from '../components/LearnerCardDeck';
import { ProfileTrendChart } from '../components/ProfileTrendChart';
import { UserProfile, Language, ProfileChange, User } from '../types';
import { ArrowRight, Activity, Brain, Target, TrendingUp, Gauge } from 'lucide-react';
import { translations } from '../utils/translations';
import { getRecentChanges } from '../services/api';

interface Props {
  profile: UserProfile;
  onNavigate: (view: any) => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
  userName?: string;
  experimentGroup: User['experimentGroup'];
}

export const Dashboard: React.FC<Props> = ({ profile, onNavigate, language, userId, userName, experimentGroup }) => {
  const t = translations[language];
  const [recentChanges, setRecentChanges] = useState<ProfileChange[]>([]);
  const [isLoadingChanges, setIsLoadingChanges] = useState(false);

  useEffect(() => {
    const fetchRecentChangesData = async () => {
      if (!userId) return;

      setIsLoadingChanges(true);
      try {
        const response = await getRecentChanges(userId, 8);
        setRecentChanges(response.data?.changes || []);
      } catch (error) {
        console.error('Failed to fetch recent changes:', error);
      } finally {
        setIsLoadingChanges(false);
      }
    };

    fetchRecentChangesData();
  }, [userId]);

  const metrics = [
    {
      key: 'cognition' as const,
      label: t.cognition,
      value: profile.cognition,
      description: language === 'zh' ? '概念理解与问题拆解' : 'Concept understanding and problem decomposition',
      icon: <Brain size={23} />,
      iconClass: 'metric-cognition',
    },
    {
      key: 'affect' as const,
      label: t.affect,
      value: profile.affect,
      description: language === 'zh' ? '投入状态与学习韧性' : 'Engagement and learning resilience',
      icon: <Activity size={23} />,
      iconClass: 'metric-affect',
    },
    {
      key: 'behavior' as const,
      label: t.behavior,
      value: profile.behavior,
      description: language === 'zh' ? '行动节奏与持续投入' : 'Learning rhythm and sustained effort',
      icon: <Target size={23} />,
      iconClass: 'metric-behavior',
    },
  ];

  const hero = {
    pdt: {
      kicker: 'PROJECT DECONSTRUCTION / 2026',
      platform: 'AI 时代的项目解构式编程学习平台',
      slogan: '从解构，到建构。',
      intro: '先运行和观察，再拆出功能、数据与关系；之后通过表达、编码和验证，让理解重新成为可以运行的项目。',
      action: '开始项目解构',
    },
    ai_pbl: {
      kicker: 'AI PROJECT LEARNING / 2026',
      platform: 'AI 支持的项目式编程学习平台',
      slogan: '从目标，到作品。',
      intro: '围绕真实项目持续规划、编码、调试与改进，在需要时借助 AI 提问并推进作品。',
      action: '进入项目工坊',
    },
    lecture: {
      kicker: 'PROGRAMMING PRACTICE / 2026',
      platform: '讲授与在线编程实践平台',
      slogan: '从讲解，到练习。',
      intro: '跟随课堂讲解理解概念与示例，并在统一的在线环境中完成编码、运行与提交。',
      action: '进入编程练习',
    },
    unassigned: {
      kicker: 'LEARNER PROFILE / 2026',
      platform: 'AI 时代的编程学习平台',
      slogan: '等待教师开放学习路径。',
      intro: '你的起始画像已经生成。教师完成实验班分配后，这里会自动开放对应的学习界面。',
      action: '查看测量任务',
    },
  }[experimentGroup];

  return (
    <div className="dashboard-grid">
      <section className="dashboard-hero animate-fade-in">
        <div className="dashboard-hero-copy">
          <p className="dashboard-kicker">{hero.kicker}</p>
          <h2 className="dashboard-display">
            {language === 'zh' ? (
              <>
                <span className="dashboard-platform-line">{hero.platform}</span>
                <span className="dashboard-slogan-line">{hero.slogan}</span>
              </>
            ) : 'From deconstruction to reconstruction.'}
          </h2>
          <p className="dashboard-intro">
            {language === 'zh'
              ? hero.intro
              : 'Observe a working artifact, expose its functions, data, and relations, then turn that understanding back into a running project through explanation, code, and verification.'}
          </p>
          <div className="dashboard-hero-actions">
            <button type="button" onClick={() => onNavigate(experimentGroup === 'unassigned' ? 'scales' : 'research')} className="hero-action hero-action-primary">
              <span>{language === 'zh' ? hero.action : 'Open learning workspace'}</span>
              <ArrowRight size={18} />
            </button>
            {experimentGroup === 'pdt' && <button type="button" onClick={() => onNavigate('graph')} className="hero-action">
              <span>{language === 'zh' ? '查看结构关系' : 'View structural relations'}</span>
              <ArrowRight size={18} />
            </button>}
          </div>
        </div>
        <div className="dashboard-deck-stage">
          <LearnerCardDeck profile={profile} userName={userName} language={language} />
        </div>
      </section>

      <section className="dashboard-insights animate-fade-in stagger-1">
        <SpotlightCard className="dashboard-radar-panel" spotlightColor="rgba(142, 169, 68, 0.13)">
          <div className="panel-heading">
            <div>
              <h3 className="panel-title">{language === 'zh' ? '当前画像雷达' : 'Current profile radar'}</h3>
              <p className="panel-copy">
                {language === 'zh' ? '认知、情感与行为的当前学习状态' : 'Current cognition, affect, and behavior signals'}
              </p>
            </div>
            <div className="dashboard-panel-icon"><Gauge size={21} /></div>
          </div>
          <div className="dashboard-radar-frame">
            <RadarDisplay data={profile} language={language} />
          </div>
        </SpotlightCard>

        <div className="dashboard-signals-column">
          <div className="dashboard-metrics-grid">
            {metrics.map((metric, idx) => (
              <SpotlightCard key={metric.key} className={`metric-card dashboard-metric-card animate-scale-in stagger-${idx + 1}`}>
                <div className="metric-card-top">
                  <div className={`metric-icon ${metric.iconClass}`}>{metric.icon}</div>
                  <div className="text-right">
                    <span className="metric-value">{metric.value}</span>
                    <span className="metric-total">/100</span>
                  </div>
                </div>
                <h3 className="metric-label">{metric.label}</h3>
                <p className="metric-desc">{metric.description}</p>
              </SpotlightCard>
            ))}
          </div>

          <SpotlightCard className="dashboard-trend-panel" spotlightColor="rgba(245, 184, 75, 0.12)">
            <div className="panel-heading">
              <div>
                <h3 className="panel-title">{t.recentShifts}</h3>
                <p className="panel-copy">
                  {language === 'zh' ? '记录每次学习后的画像变化' : 'Profile changes after each learning session'}
                </p>
              </div>
              <div className="dashboard-panel-icon dashboard-panel-icon-amber"><TrendingUp size={21} /></div>
            </div>
            <ProfileTrendChart
              profile={profile}
              changes={recentChanges}
              language={language}
              isLoading={isLoadingChanges}
            />
          </SpotlightCard>
        </div>
      </section>
    </div>
  );
};
