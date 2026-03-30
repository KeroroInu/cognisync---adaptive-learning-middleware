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

export interface TableInfo {
  table_name: string;
  row_count: number;
  description?: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_visible: boolean;
}

export interface TableRowsResponse {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
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
  status: 'draft' | 'active' | 'archived';
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

export interface EmotionExperimentRow {
  rowIndex: number;
  profileKey: string;
  conversationId: string;
  speaker: string | null;
  text: string;
  expectedLabel: string | null;
  expectedLabels: string[];
  expectedMatches: boolean | null;
  intent: string;
  emotion: string;
  emotionCode: string;
  emotionName: string;
  intensity: 'low' | 'medium' | 'high';
  confidence: number;
  arousal: number;
  valence: number;
  deltaCognition: number;
  deltaAffect: number;
  deltaBehavior: number;
  profileCognitionBefore: number;
  profileAffectBefore: number;
  profileBehaviorBefore: number;
  profileCognitionAfter: number;
  profileAffectAfter: number;
  profileBehaviorAfter: number;
}

export interface EmotionExperimentSummary {
  rowsProcessed: number;
  rowsSkipped: number;
  analyzedRows: number;
  comparedRows: number;
  matchedRows: number;
  uniqueProfiles: number;
  uniqueConversations: number;
}

export interface EmotionExperimentResult {
  experimentId?: string | null;
  fileName: string;
  detectedColumns: string[];
  labelMapping: Record<string, string[]>;
  previewRows: EmotionExperimentRow[];
  summary: EmotionExperimentSummary;
  csvContent: string;
}

export interface EmotionExperimentRunItem {
  id: string;
  originalFilename: string;
  outputFilename: string;
  textColumn: string;
  conversationIdColumn: string | null;
  speakerColumn: string | null;
  expectedLabelColumn: string | null;
  profileKeyColumn: string | null;
  labelMapping: Record<string, string[]>;
  summary: EmotionExperimentSummary;
  createdAt: string;
}

export interface EmotionExperimentRunsResponse {
  runs: EmotionExperimentRunItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface EmotionCompareDatasetInfo {
  datasetName: string;
  sourceFormat: string;
  taskType: 'single_label' | 'multi_label';
  datasetTemplate: string | null;
  sampleIdColumn: string | null;
  textColumn: string;
  expectedLabelColumn: string | null;
  expectedLabelColumns: string[];
  positiveLabelValue: string | null;
  rowsProcessed: number;
  rowsSkipped: number;
  labelCount: number;
  labels: string[];
}

export interface EmotionComparePrediction {
  emotionCode: string | null;
  emotionName: string | null;
  intensity: 'low' | 'medium' | 'high' | null;
  confidence: number | null;
  rawLabel: string | null;
}

export interface EmotionCompareBaselineRow {
  rowIndex: number;
  sampleId: string | null;
  text: string;
  predictedEmotionCode: string | null;
  predictedEmotionName: string | null;
  predictedIntensity: 'low' | 'medium' | 'high' | null;
  confidence: number | null;
  rawLabel: string | null;
}

export interface EmotionCompareProfileSnapshot {
  cognition: number;
  affect: number;
  behavior: number;
}

export interface EmotionCompareDelta {
  cognition: number;
  affect: number;
  behavior: number;
}

export interface EmotionCompareContextUsed {
  dialogue: boolean;
  profile: boolean;
  knowledge: boolean;
}

export interface EmotionCompareSystemRow {
  rowIndex: number;
  sampleId: string | null;
  text: string;
  predictedEmotionCode: string | null;
  predictedEmotionName: string | null;
  predictedIntensity: 'low' | 'medium' | 'high' | null;
  confidence: number | null;
  profileBefore: EmotionCompareProfileSnapshot | null;
  profileAfter: EmotionCompareProfileSnapshot | null;
  delta: EmotionCompareDelta | null;
  contextUsed: EmotionCompareContextUsed;
}

export interface EmotionCompareComparisonRow {
  rowIndex: number;
  sampleId: string | null;
  text: string;
  groundTruthLabels: string[];
  baselinePrediction: EmotionComparePrediction;
  systemPrediction: EmotionComparePrediction;
  baselineMatched: boolean | null;
  systemMatched: boolean | null;
  winner: 'baseline' | 'system' | 'tie' | 'none';
}

export interface EmotionCompareSingleMetrics {
  accuracy: number | null;
  macroF1: number | null;
  weightedF1: number | null;
}

export interface EmotionCompareMultiMetrics {
  exactMatch: number | null;
  overlapMatch: number | null;
  macroF1: number | null;
}

export interface EmotionCompareSingleSummaryMetrics {
  taskType: 'single_label';
  support: number;
  labelCount: number;
  labels: string[];
  baseline: EmotionCompareSingleMetrics;
  system: EmotionCompareSingleMetrics;
}

export interface EmotionCompareMultiSummaryMetrics {
  taskType: 'multi_label';
  support: number;
  labelCount: number;
  labels: string[];
  baseline: EmotionCompareMultiMetrics;
  system: EmotionCompareMultiMetrics;
}

export type EmotionCompareSummaryMetrics =
  | EmotionCompareSingleSummaryMetrics
  | EmotionCompareMultiSummaryMetrics;

export interface EmotionCompareExportArtifacts {
  comparisonCsvFileName: string;
  comparisonCsvContent: string;
  resultJsonFileName: string;
}

export interface EmotionCompareResult {
  datasetInfo: EmotionCompareDatasetInfo;
  baselineRows: EmotionCompareBaselineRow[];
  systemRows: EmotionCompareSystemRow[];
  comparisonRows: EmotionCompareComparisonRow[];
  summaryMetrics: EmotionCompareSummaryMetrics;
  exportArtifacts: EmotionCompareExportArtifacts;
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
