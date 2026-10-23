import React, { useEffect, useRef } from 'react';
import { ClipboardList, X } from 'lucide-react';
import type { Language, User } from '../types';
import './ClassroomTaskBrief.css';

interface Props {
  open: boolean;
  language: Language;
  experimentGroup: User['experimentGroup'];
  onClose: () => void;
}

interface BriefCopy {
  badge: string;
  title: string;
  body: string;
  route: string[];
}

const COPY: Record<User['experimentGroup'], Record<Language, BriefCopy>> = {
  pdt: {
    zh: {
      badge: '项目解构组',
      title: '项目侦探，集合',
      body: '先把贪吃蛇跑明白，再把观察拆成函数、画清流程，最后把七个函数装回去。AI 递工具，你来掌舵。',
      route: ['观察', '拆功能', '画流程', '再建构'],
    },
    en: {
      badge: 'Project deconstruction',
      title: 'Project detectives, assemble',
      body: 'Run Snake, turn observations into functions, draw each flow, then rebuild all seven functions. AI hands you tools; you steer.',
      route: ['Observe', 'Functions', 'Flow', 'Rebuild'],
    },
  },
  ai_pbl: {
    zh: {
      badge: '常规 AI 协作组',
      title: '和 AI 组队，方向盘在你手里',
      body: '围绕贪吃蛇持续设计、编码和调试；卡住时问 AI，让它帮你看清下一步。最后拍板和动手的人，还是你。',
      route: ['理解任务', '规划', '编码', '调试'],
    },
    en: {
      badge: 'AI project learning',
      title: 'Team up with AI — you keep the wheel',
      body: 'Design, code, and debug Snake as one project. Ask AI when stuck, but keep the final decisions and implementation yours.',
      route: ['Understand', 'Plan', 'Code', 'Debug'],
    },
  },
  lecture: {
    zh: {
      badge: '课堂讲授组',
      title: '最后的代码手艺人',
      body: '跟着课堂讲解，一行一行把贪吃蛇打磨出来。没有 AI 捷径，但每一段逻辑都算你亲手做的。',
      route: ['听讲', '模仿', '编码', '检查'],
    },
    en: {
      badge: 'Classroom instruction',
      title: 'The last code artisans',
      body: 'Follow the lesson and craft Snake line by line. There is no AI shortcut, but every piece of logic is truly yours.',
      route: ['Learn', 'Follow', 'Code', 'Check'],
    },
  },
  experience: {
    zh: {
      badge: '体验组',
      title: '和 SFLS 一起完成你的作品',
      body: '先看老师发布的任务要求，下载自己的任务包，再和 SFLS 讨论、制作并提交作品。',
      route: ['查看任务', '下载任务包', '协作制作', '提交作品'],
    },
    en: {
      badge: 'Experience group',
      title: 'Create your project with SFLS',
      body: 'Read your teacher’s task, download your own task package, then create and submit your project with SFLS.',
      route: ['Read task', 'Download', 'Create', 'Submit'],
    },
  },
  unassigned: {
    zh: {
      badge: '课堂任务',
      title: '先别急着开工',
      body: '老师正在为你安排学习方式。分组完成后，这里会出现本节课的任务说明。',
      route: ['等待分组'],
    },
    en: {
      badge: 'Class task',
      title: 'Hold that brilliant idea',
      body: 'Your teacher is assigning your learning route. The class brief will appear here once your group is ready.',
      route: ['Await assignment'],
    },
  },
};

export const ClassroomTaskBrief: React.FC<Props> = ({
  open,
  language,
  experimentGroup,
  onClose,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[experimentGroup]?.[language] ?? COPY.unassigned[language];

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="class-task-layer">
      <button
        type="button"
        className="class-task-scrim"
        onClick={onClose}
        aria-label={language === 'zh' ? '关闭课堂任务' : 'Close class task'}
      />
      <section
        className="class-task-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-task-title"
      >
        <div className="class-task-topline">
          <span className="class-task-badge"><ClipboardList size={16} />{copy.badge}</span>
          <button
            type="button"
            className="class-task-close"
            onClick={onClose}
            aria-label={language === 'zh' ? '关闭，以后可从右上角查看' : 'Close; reopen from the top right'}
          >
            <X size={20} />
          </button>
        </div>

        <h2 id="class-task-title">{copy.title}</h2>
        <p>{copy.body}</p>

        <ol className="class-task-route" aria-label={language === 'zh' ? '本节课路线' : 'Class route'}>
          {copy.route.map(item => <li key={item}>{item}</li>)}
        </ol>

        <footer>
          <small>{language === 'zh' ? '关掉后不再自动出现，右上角任务图标随时能找回。' : 'It will not pop up again. Reopen it anytime from the task icon.'}</small>
          <button ref={confirmRef} type="button" onClick={onClose}>
            {language === 'zh' ? '收到，开工' : 'Got it — let’s go'}
          </button>
        </footer>
      </section>
    </div>
  );
};
