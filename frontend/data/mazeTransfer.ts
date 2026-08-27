import type { ResearchTask } from '../types';

export const MAZE_TRANSFER_CONFIG = {
  boardSize: 10,
  start: [1, 8],
  goal: [8, 1],
  maxSteps: 80,
  walls: [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0],
    [0, 1], [3, 1], [6, 1], [9, 1], [0, 2], [1, 2], [3, 2], [5, 2], [6, 2], [8, 2], [9, 2],
    [0, 3], [3, 3], [5, 3], [9, 3], [0, 4], [2, 4], [3, 4], [5, 4], [7, 4], [9, 4],
    [0, 5], [2, 5], [5, 5], [7, 5], [8, 5], [9, 5], [0, 6], [2, 6], [4, 6], [5, 6], [9, 6],
    [0, 7], [4, 7], [7, 7], [9, 7], [0, 8], [2, 8], [4, 8], [7, 8], [9, 8],
    [0, 9], [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9],
  ],
};

export interface MazeFunctionCard {
  id: string;
  title: string;
  code: string;
  fixed?: boolean;
}

export interface MazeTransferWorkspace {
  version: 'maze-transfer-v1';
  cards: MazeFunctionCard[];
  activeCardId: string;
  lastResult?: { passed: boolean; resultCode: string; path: number[][]; testedAt: string };
  savedAt: string;
  startedAt: number;
  lastPassedSignature?: string;
}

export const createMazeTransferWorkspace = (task: ResearchTask): MazeTransferWorkspace => ({
  version: 'maze-transfer-v1',
  cards: [{ id: 'next-move', title: '决定下一步', code: task.code_submitted || task.code_content, fixed: true }],
  activeCardId: 'next-move',
  savedAt: new Date().toISOString(),
  startedAt: Date.now(),
});

export const isMazeTransferWorkspace = (value: unknown): value is MazeTransferWorkspace => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MazeTransferWorkspace>;
  return item.version === 'maze-transfer-v1'
    && Array.isArray(item.cards)
    && item.cards.length > 0
    && item.cards.every(card => card && typeof card.id === 'string' && typeof card.title === 'string' && typeof card.code === 'string')
    && typeof item.activeCardId === 'string';
};

export const generateCodeSignature = (code: string): string => {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

export const bundleMazeFunctions = (workspace: MazeTransferWorkspace) => workspace.cards
  .map(card => `# --- ${card.title} ---\n${card.code.trim()}`)
  .filter(Boolean)
  .join('\n\n');
