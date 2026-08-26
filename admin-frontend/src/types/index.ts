// Admin API Types

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface OverviewStats {
  users_count: number;
  sessions_count: number;
  messages_count: number;
  templates_count: number;
  responses_count: number;
}

export interface User {
  id: string;
  student_id: string;
  email: string | null;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  class_name: string | null;
  experiment_group: 'unassigned' | 'pdt' | 'ai_pbl' | 'lecture';
}

export interface UsersListResponse {
  users: User[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserDetail {
  id: string;
  student_id: string;
  email: string | null;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  class_name: string | null;
  experiment_group: User['experiment_group'];
  messages_count: number;
  sessions_count: number;
  responses_count: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: Record<string, unknown>;
}

export interface MessagesListResponse {
  messages: ChatMessage[];
  total: number;
}

export interface ProfileSnapshot {
  id: string;
  user_id: string;
  cognition: number;
  affect: number;
  behavior: number;
  source: 'system' | 'user';
  created_at: string;
}

export interface ScaleTemplate {
  id: string;
  name: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  schema_json: Record<string, unknown>;
  scoring_json: Record<string, unknown>;
  mapping_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  activated_at?: string | null;
  responses_count?: number;
}

export interface ScalesListResponse {
  templates: ScaleTemplate[];
  total: number;
}

export interface ScaleResponse {
  id: string;
  user_id: string;
  user_name?: string;
  student_id?: string;
  template_id: string;
  template_name?: string;
  answers_json: Record<string, unknown>;
  scores_json: Record<string, unknown>;
  started_at?: string | null;
  created_at: string;
}

export interface SessionItem {
  id: string;
  user_id: string;
  user_name: string;
  student_id: string | null;
  user_email: string | null;
  message_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface SessionsListResponse {
  sessions: SessionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface SessionDetail {
  id: string;
  user_id: string;
  user_name: string;
  student_id: string | null;
  user_email: string | null;
  message_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface SessionMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: Record<string, unknown>;
}

export interface SessionMessagesResponse {
  messages: SessionMessageItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CalibrationLog {
  id: string;
  timestamp: string;
  dimension: 'cognition' | 'affect' | 'behavior';
  system_value: number;
  user_value: number;
  conflict_level: 'low' | 'medium' | 'high';
  user_comment: string | null;
  likert_trust: number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  category: string;
  mastery: number;
  frequency: number;
  is_flagged: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  rel_type: string;
  weight: number;
}

export interface UserGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ResearchTask {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  ai_prompt: string | null;
  code_content: string;
  language: string;
  target_group: 'all' | 'unassigned' | 'pdt' | 'ai_pbl' | 'lecture';
  task_kind: 'learning' | 'transfer_test';
  test_template: 'maze_treasure_v1' | null;
  ai_enabled: boolean;
  status: 'draft' | 'active' | 'archived';
  current_blueprint_version_id: string | null;
  submissions_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchTaskSubmission {
  id: string;
  task_id: string;
  user_id: string;
  user_name?: string;
  student_id?: string;
  user_email?: string;
  code_submitted: string;
  blueprint_version_id?: string | null;
  is_completed: boolean;
  started_at?: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface ResearchTasksResponse {
  tasks: ResearchTask[];
  total: number;
}

export interface ResearchSubmissionsResponse {
  submissions: ResearchTaskSubmission[];
  total: number;
}

export type BlueprintKnowledgeResponsibility = 'student_core' | 'ai_supported' | 'generated_process';

export interface BlueprintPhenomenon {
  id: string;
  labelZh: string;
  evidenceType: string;
  required: boolean;
  descriptionZh?: string | null;
}

export interface BlueprintKnowledgeItem {
  labelZh: string;
  responsibility: BlueprintKnowledgeResponsibility;
}

export interface BlueprintContract {
  functionTemplate: string;
  inputs: string[];
  outputs: string[];
  preconditions: string[];
  postconditions: string[];
}

export interface BlueprintTestCase {
  id: string;
  labelZh: string;
  category: 'example' | 'edge' | 'rule';
  inputData: unknown;
  expectedData: unknown;
  hidden: boolean;
}

export interface BlueprintNode {
  id: string;
  titleZh: string;
  scenarioZh: string;
  required: boolean;
  synonyms: string[];
  contract: BlueprintContract;
  knowledge: BlueprintKnowledgeItem[];
  prerequisiteIds: string[];
  tests: BlueprintTestCase[];
  visualizationBehaviorKey?: string | null;
}

export interface BlueprintAlternative {
  id: string;
  kind: 'split' | 'merge' | 'substitute';
  nodeIds: string[];
  descriptionZh: string;
}

export interface BlueprintScaffoldLevel {
  level: number;
  goalZh: string;
  allowedHelpZh: string;
  maxCodeLines?: number | null;
}

export type BlueprintStage = 'observe' | 'decompose' | 'model' | 'plan' | 'build' | 'transfer';

export interface BlueprintScaffoldPolicy {
  requireAttemptBeforeUpgrade: boolean;
  coreImplementationMaxLevel: number;
  stageLevels: Partial<Record<BlueprintStage, BlueprintScaffoldLevel[]>>;
}

export interface ProjectBlueprintConfig {
  schemaVersion: 1;
  projectKey: string;
  demoKey: string;
  titleZh: string;
  phenomena: BlueprintPhenomenon[];
  nodes: BlueprintNode[];
  alternatives: BlueprintAlternative[];
  scaffoldPolicy: BlueprintScaffoldPolicy;
}

export interface ProjectBlueprintVersion {
  id: string;
  task_id: string;
  version: number;
  schema_version: number;
  status: 'draft' | 'published';
  config: ProjectBlueprintConfig;
  content_hash: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBlueprintsResponse {
  blueprints: ProjectBlueprintVersion[];
  total: number;
}

export interface LlmRoleConfig {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
}

export interface LlmConfig {
  analysis: LlmRoleConfig;
  chat: LlmRoleConfig;
}

export interface EmotionDistributionItem {
  legacyEmotion: string;
  emotionCode: string;
  emotionName: string;
  intensity: 'low' | 'medium' | 'high';
  count: number;
  percentage: number;
  avgConfidence: number;
}

export interface EmotionDistributionResponse {
  totalLogs: number;
  items: EmotionDistributionItem[];
}

export interface EmotionTrendPoint {
  date: string;
  totalCount: number;
  averageConfidence: number;
  averageValence: number;
  averageArousal: number;
  emotionCounts: Record<string, number>;
}

export interface EmotionTrendResponse {
  days: number;
  points: EmotionTrendPoint[];
}

export interface EmotionUserSummary {
  userId: string;
  studentId: string;
  name: string;
  totalLogs: number;
  lastAnalyzedAt: string | null;
  latestEmotionCode: string | null;
  latestEmotionName: string | null;
  currentCognition: number | null;
  currentAffect: number | null;
  currentBehavior: number | null;
}

export interface EmotionUserLogItem {
  id: string;
  createdAt: string;
  sessionId: string | null;
  messageId: string;
  intent: string;
  emotion: string;
  emotionCode: string;
  emotionName: string;
  intensity: 'low' | 'medium' | 'high';
  confidence: number;
  arousal: number;
  valence: number;
  detectedConcepts: string[];
  evidence: string[];
  deltaCognition: number;
  deltaAffect: number;
  deltaBehavior: number;
  profileCognition: number | null;
  profileAffect: number | null;
  profileBehavior: number | null;
}

export interface EmotionUserDetailResponse {
  summary: EmotionUserSummary;
  logs: EmotionUserLogItem[];
}
