import { AppState } from './types';

export const INITIAL_STATE: AppState = {
  isResearchMode: true,
  language: 'zh',
  user: null,
  token: null,
  profile: {
    cognition: 50,
    affect: 50,
    behavior: 50,
    lastUpdate: new Date().toISOString(),
  },
  nodes: [],
  edges: [],
  messages: [],
  logs: [],
};