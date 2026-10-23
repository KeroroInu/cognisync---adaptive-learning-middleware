import React, { useMemo } from 'react';
import { SnakeBuildPreview } from './ProjectBuildStage';
import type { Language } from '../types';

const noOp = () => {};
const noCards: [] = [];
export const FreeGamePreview: React.FC<{ code: string; currentCode: string; language: Language; onOutput: (source: string, lines: string[]) => void }> = ({ code, currentCode, language, onOutput }) => {
  const bundle = useMemo(() => code ? { 'free-program': code } : {}, [code]);
  const capabilities = useMemo(() => new Set(code ? ['initial-state', 'movement', 'direction-input', 'game-loop'] : []), [code]);
  return <section className="free-game-panel" aria-label="游戏预览">
    <header><strong>游戏预览</strong><span>{!code ? '等待运行代码' : code !== currentCode ? '代码已修改，运行后更新' : '当前运行版本'}</span></header>
    <SnakeBuildPreview language={language} capabilities={capabilities} codeByNode={bundle} creativeFunctions={noCards}
      demonstration={null} onCreativeRuntimeErrors={noOp} onRuntimeOutput={onOutput} />
    <details><summary>代码怎样接到游戏？</summary><p>保留下面两个入口，内部可自己组织函数。点“运行代码”后再启动游戏。</p>
      <pre>{'def create_initial_state():\n    # 返回：蛇身坐标列表、方向、得分\n    pass\n\ndef step_game(state, user_input):\n    # 推进一步，返回更新后的 state\n    return state'}</pre>
      <p>state 包含 snake、direction、food、score、game_over；可选 interval（秒）、objects、timers。棋盘为 12 × 12。支持基础 Python、math、random，不支持桌面窗口或任意安装库。</p>
    </details>
  </section>;
};
