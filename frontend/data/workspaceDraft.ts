import { isSnakeProjectWorkspace, type SnakeProjectWorkspace } from './snakeProjectDemo';

const key = (scope: string) => `cognisync:pending-workspace:v1:${scope}`;
export function readPendingWorkspace(scope: string): SnakeProjectWorkspace | null {
  try { const workspace = JSON.parse(localStorage.getItem(key(scope)) || 'null'); return isSnakeProjectWorkspace(workspace) ? workspace : null; }
  catch { return null; }
}
export function storePendingWorkspace(scope: string, workspace: SnakeProjectWorkspace): boolean {
  try { localStorage.setItem(key(scope), JSON.stringify(workspace)); return true; }
  catch { return false; }
}
export function acknowledgePendingWorkspace(scope: string, snapshot: SnakeProjectWorkspace): void {
  try {
    // An old response must never clear a more recent draft, including one written by another tab.
    if (localStorage.getItem(key(scope)) === JSON.stringify(snapshot)) localStorage.removeItem(key(scope));
  } catch { /* Server is already saved. */ }
}
