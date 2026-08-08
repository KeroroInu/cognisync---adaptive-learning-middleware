import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Layers3, RotateCcw, Sparkles, Target } from 'lucide-react';
import type { Language, UserProfile } from '../types';

type ProfileKey = 'cognition' | 'affect' | 'behavior';

interface Props {
  profile: UserProfile;
  userName?: string;
  language: Language;
}

interface CardDefinition {
  id: 'identity' | 'signals' | 'mission';
  eyebrow: string;
  index: string;
}

const profileKeys: ProfileKey[] = ['cognition', 'affect', 'behavior'];

export const LearnerCardDeck: React.FC<Props> = ({ profile, userName, language }) => {
  const [activeCard, setActiveCard] = useState(0);
  const isZh = language === 'zh';

  const profileSummary = useMemo(() => {
    const strongest = profileKeys.reduce((best, key) =>
      profile[key] > profile[best] ? key : best
    );
    const growthEdge = profileKeys.reduce((lowest, key) =>
      profile[key] < profile[lowest] ? key : lowest
    );

    const titles: Record<ProfileKey, string> = {
      cognition: isZh ? '结构探索者' : 'Structure Scout',
      affect: isZh ? '共情协作者' : 'Empathic Collaborator',
      behavior: isZh ? '行动调试员' : 'Action Debugger',
    };
    const missions: Record<ProfileKey, string> = {
      cognition: isZh ? '把复杂目标拆成三个可验证的步骤' : 'Break a complex goal into three testable steps',
      affect: isZh ? '记录一次卡点，并选择合适的学习支架' : 'Log one friction point and choose a useful scaffold',
      behavior: isZh ? '把计划转化为连续完成的小步行动' : 'Turn a plan into a sequence of small completed actions',
    };

    return {
      title: titles[strongest],
      mission: missions[growthEdge],
    };
  }, [isZh, profile]);

  const cards: CardDefinition[] = [
    { id: 'identity', eyebrow: isZh ? '起始画像' : 'Starting profile', index: '01' },
    { id: 'signals', eyebrow: isZh ? '三维信号' : 'Three signals', index: '02' },
    { id: 'mission', eyebrow: isZh ? '成长任务' : 'Growth mission', index: '03' },
  ];

  const orderedCards = cards.map((_, position) => cards[(activeCard + position) % cards.length]);

  const cycleCards = () => setActiveCard(current => (current + 1) % cards.length);

  const renderCardContent = (card: CardDefinition) => {
    if (card.id === 'identity') {
      return (
        <>
          <div className="learner-card-orbit" aria-hidden="true">
            <Sparkles size={38} strokeWidth={1.7} />
          </div>
          <div className="learner-card-copy">
            <p className="learner-card-name">{userName || (isZh ? '学习者' : 'Learner')}</p>
            <h3>{profileSummary.title}</h3>
            <p>{isZh ? '根据注册画像生成的学习起点，不代表能力定级。' : 'A starting point from onboarding, not an ability grade.'}</p>
          </div>
          <div className="learner-card-footer">
            <span>{isZh ? '自述数据' : 'SELF-REPORTED'}</span>
            <ArrowUpRight size={22} />
          </div>
        </>
      );
    }

    if (card.id === 'signals') {
      return (
        <>
          <div className="learner-signal-list">
            {profileKeys.map(key => (
              <div className="learner-signal" key={key}>
                <div>
                  <span>{key === 'cognition' ? (isZh ? '认知' : 'Cognition') : key === 'affect' ? (isZh ? '情感' : 'Affect') : (isZh ? '行为' : 'Behavior')}</span>
                  <strong>{profile[key]}</strong>
                </div>
                <div className="learner-signal-track" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, profile[key]))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="learner-card-footer">
            <span>{isZh ? '过程信号会持续更新' : 'SIGNALS KEEP EVOLVING'}</span>
            <Layers3 size={22} />
          </div>
        </>
      );
    }

    return (
      <>
        <div className="learner-mission-icon" aria-hidden="true">
          <Target size={44} strokeWidth={1.6} />
        </div>
        <div className="learner-card-copy">
          <p className="learner-card-name">{isZh ? '下一张证据卡' : 'Next evidence card'}</p>
          <h3>{profileSummary.mission}</h3>
          <p>{isZh ? '完成任务后，用过程记录更新卡片，而不是只看最终作品。' : 'Update the card with process evidence, not only the final product.'}</p>
        </div>
        <div className="learner-card-footer">
          <span>{isZh ? '等待行动' : 'READY FOR ACTION'}</span>
          <ArrowUpRight size={22} />
        </div>
      </>
    );
  };

  return (
    <div className="learner-deck-shell">
      <div className="learner-deck-heading">
        <button type="button" onClick={cycleCards} aria-label={isZh ? '切换下一张卡片' : 'Show next card'}>
          <RotateCcw size={15} />
          {isZh ? '翻下一张' : 'Next card'}
        </button>
      </div>
      <div className="learner-card-deck" aria-live="polite">
        {orderedCards.map((card, position) => (
          <button
            type="button"
            key={card.id}
            className={`learner-card learner-card-${card.id}`}
            data-position={position}
            tabIndex={position === 0 ? 0 : -1}
            aria-hidden={position !== 0}
            aria-label={position === 0 ? `${card.eyebrow}，${isZh ? '点击查看下一张' : 'click for next card'}` : undefined}
            onClick={position === 0 ? cycleCards : undefined}
          >
            <div className="learner-card-topline">
              <span>{card.eyebrow}</span>
              <strong>{card.index}</strong>
            </div>
            {renderCardContent(card)}
          </button>
        ))}
      </div>
    </div>
  );
};
