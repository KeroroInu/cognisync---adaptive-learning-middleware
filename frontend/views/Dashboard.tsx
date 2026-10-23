import React from 'react';
import { UserProfile, Language, User } from '../types';
import { ArrowRight } from 'lucide-react';

interface Props {
  profile: UserProfile;
  onNavigate: (view: any) => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
  userName?: string;
  experimentGroup: User['experimentGroup'];
}

/**
 * 学习首页只作为「当前没有开放任务」时的回退入口。
 *
 * 2026-08-24 裁定：学生端不再展示画像卡、雷达图、画像变化趋势和知识图谱入口，
 * 这些内容统一迁入教师端单生详情。画像数据仍在系统中正常采集与更新，
 * 只是不再作为学生的必经入口或阶段门槛。
 */
export const Dashboard: React.FC<Props> = ({ onNavigate, language, userName, experimentGroup }) => {
  const hero = {
    pdt: {
      kicker: 'PROJECT DECONSTRUCTION / 2026',
      platform: 'AI 时代的项目解构式编程学习平台',
      slogan: '从解构，到建构。',
      intro: '先运行和观察，再把现象命名为功能；之后在 AI 的分级支持下逐个完成基础函数、运行测试并扩展创意。',
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
    experience: {
      kicker: 'AI PROGRAMMING EXPERIENCE / 2026',
      platform: 'AI 编程体验平台',
      slogan: '让想法，成为作品。',
      intro: '查看老师发布的任务，下载到自己的电脑，和 SFLS 一起完成并提交作品。',
      action: '查看课堂任务',
    },
    unassigned: {
      kicker: 'PROGRAMMING LEARNING / 2026',
      platform: 'AI 时代的编程学习平台',
      slogan: '等待教师开放学习路径。',
      intro: '教师完成实验班分配并开放任务后，登录时会自动进入对应的学习界面。',
      action: '查看测量任务',
    },
  }[experimentGroup];

  const waitingCopy = experimentGroup === 'unassigned'
    ? '你的账号还没有分配实验班级。'
    : '教师当前没有开放任务，或任务已经归档。任务开放后，你下次登录会直接进入项目。';

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
            ) : experimentGroup === 'experience' ? 'Turn an idea into a project.' : 'From deconstruction to reconstruction.'}
          </h2>
          <p className="dashboard-intro">
            {language === 'zh'
              ? hero.intro
              : experimentGroup === 'experience'
                ? 'Read your teacher’s task, download your own package, and create and submit your project with SFLS.'
                : 'Observe a working project, name what it does, then rebuild it function by function with graded AI support.'}
          </p>
          <p className="dashboard-intro">
            {language === 'zh'
              ? `${userName ? `${userName}，` : ''}${waitingCopy}`
              : 'No open task right now. You will be taken straight into the project once your teacher opens one.'}
          </p>
          <div className="dashboard-hero-actions">
            <button
              type="button"
              onClick={() => onNavigate(experimentGroup === 'unassigned' ? 'scales' : experimentGroup === 'experience' ? 'preparation' : 'research')}
              className="hero-action hero-action-primary"
            >
              <span>{language === 'zh' ? hero.action : 'Open learning workspace'}</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
