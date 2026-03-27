/**
 * KDK DevInsights - Core Type Definitions
 *
 * Defines every telemetry event shape, configuration interface,
 * and data model used throughout the extension.
 */

// ---------------------------------------------------------------------------
// Telemetry Event Types
// ---------------------------------------------------------------------------

export enum TelemetryEventType {
  // Copilot inline completions
  COMPLETION_SHOWN = "copilot.completion.shown",
  COMPLETION_ACCEPTED = "copilot.completion.accepted",
  COMPLETION_DISMISSED = "copilot.completion.dismissed",
  COMPLETION_PARTIALLY_ACCEPTED = "copilot.completion.partiallyAccepted",

  // Copilot Chat
  CHAT_PROMPT_SENT = "copilot.chat.promptSent",
  CHAT_RESPONSE_RECEIVED = "copilot.chat.responseReceived",
  CHAT_CODE_INSERTED = "copilot.chat.codeInserted",
  CHAT_CODE_COPIED = "copilot.chat.codeCopied",
  CHAT_SLASH_COMMAND_USED = "copilot.chat.slashCommandUsed",
  CHAT_PARTICIPANT_INVOKED = "copilot.chat.participantInvoked",

  // Editor activity
  EDITOR_FILE_OPENED = "editor.file.opened",
  EDITOR_FILE_CLOSED = "editor.file.closed",
  EDITOR_FILE_SAVED = "editor.file.saved",
  EDITOR_ACTIVE_CHANGED = "editor.active.changed",
  EDITOR_LINES_CHANGED = "editor.lines.changed",

  // Git operations
  GIT_COMMIT = "git.commit",
  GIT_BRANCH_SWITCH = "git.branch.switch",
  GIT_PUSH = "git.push",
  GIT_PULL = "git.pull",
  GIT_MERGE = "git.merge",

  // Session lifecycle
  SESSION_START = "session.start",
  SESSION_END = "session.end",
  SESSION_IDLE_START = "session.idle.start",
  SESSION_IDLE_END = "session.idle.end",

  // Ticket association
  TICKET_ASSOCIATED = "ticket.associated",
  TICKET_CLEARED = "ticket.cleared",
  TICKET_AUTO_DETECTED = "ticket.autoDetected",

  // Extension lifecycle
  EXTENSION_ACTIVATED = "extension.activated",
  EXTENSION_DEACTIVATED = "extension.deactivated",
  TRACKING_PAUSED = "tracking.paused",
  TRACKING_RESUMED = "tracking.resumed",
}

// ---------------------------------------------------------------------------
// Base Telemetry Event
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  timestamp: string; // ISO 8601
  sessionId: string;
  userId: string;
  enterpriseId: string;
  teamId: string;
  workspaceId: string;
  metadata: Record<string, unknown>;
  context: EventContext;
}

export interface EventContext {
  activeFile?: string;
  activeLanguage?: string;
  activeLineCount?: number;
  gitBranch?: string;
  gitRepo?: string;
  associatedTicket?: TicketInfo | null;
  vscodeVersion: string;
  extensionVersion: string;
  os: string;
  machineId: string;
}

// ---------------------------------------------------------------------------
// Copilot-Specific Event Metadata
// ---------------------------------------------------------------------------

export interface CompletionEventMetadata {
  completionId: string;
  language: string;
  lineNumber: number;
  characterCount: number;
  lineCount: number;
  triggerKind: "automatic" | "manual";
  modelId?: string;
  responseTimeMs?: number;
  snippet?: string; // Only if includeCodeSnippets is enabled
  wasMultiLine: boolean;
  fileRelativePath: string;
}

export interface ChatEventMetadata {
  chatSessionId: string;
  promptLength: number;
  responseLength?: number;
  responseTimeMs?: number;
  slashCommand?: string;
  participant?: string;
  codeBlockCount?: number;
  codeBlockLanguages?: string[];
  turnIndex: number;
  modelId?: string;
}

// ---------------------------------------------------------------------------
// Editor Activity Metadata
// ---------------------------------------------------------------------------

export interface EditorActivityMetadata {
  fileName: string;
  fileRelativePath: string;
  language: string;
  linesAdded: number;
  linesRemoved: number;
  activeTimeMs: number;
  charactersDelta: number;
}

// ---------------------------------------------------------------------------
// Git Operation Metadata
// ---------------------------------------------------------------------------

export interface GitOperationMetadata {
  operation: "commit" | "push" | "pull" | "merge" | "branchSwitch";
  branch: string;
  previousBranch?: string;
  commitHash?: string;
  commitMessage?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  repoName: string;
  repoRemoteUrl?: string;
}

// ---------------------------------------------------------------------------
// Ticket / User Story Association
// ---------------------------------------------------------------------------

export interface TicketInfo {
  id: string;
  provider: "jira" | "azure-devops" | "github-issues" | "rally" | "custom";
  url?: string;
  title?: string;
  type?: "story" | "bug" | "task" | "epic" | "feature" | "other";
  assignee?: string;
  status?: string;
  detectedFrom: "branch" | "commit" | "manual" | "pr";
}

// ---------------------------------------------------------------------------
// Session Tracking
// ---------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
  startTime: string;
  endTime?: string;
  userId: string;
  machineId: string;
  workspacePath: string;
  workspaceName: string;
  vscodeVersion: string;
  extensionVersion: string;
  os: string;

  // Running metrics
  totalActiveTimeMs: number;
  totalIdleTimeMs: number;
  completionsShown: number;
  completionsAccepted: number;
  completionsDismissed: number;
  completionsPartiallyAccepted: number;
  chatPromptsSent: number;
  chatCodeInserted: number;
  chatCodeCopied: number;
  linesWrittenByDev: number;
  linesAcceptedFromCopilot: number;
  filesEdited: Set<string>;
  languagesUsed: Set<string>;
  branchesWorkedOn: Set<string>;
  ticketsWorkedOn: Set<string>;
  commits: number;
}

// ---------------------------------------------------------------------------
// Aggregate Metrics (for dashboard / reporting)
// ---------------------------------------------------------------------------

export interface AcceptanceMetrics {
  totalShown: number;
  totalAccepted: number;
  totalDismissed: number;
  totalPartiallyAccepted: number;
  acceptanceRate: number; // 0..1
  avgResponseTimeMs: number;
  byLanguage: Record<string, { shown: number; accepted: number; rate: number }>;
  byHour: Record<number, { shown: number; accepted: number; rate: number }>;
}

export interface ProductivityMetrics {
  totalActiveTimeMs: number;
  totalCodingTimeMs: number;
  linesWrittenByDev: number;
  linesFromCopilot: number;
  copilotContributionRate: number; // 0..1
  avgCompletionLengthLines: number;
  chatInteractions: number;
  chatCodeAdopted: number;
  estimatedTimeSavedMs: number;
}

export interface TicketMetrics {
  ticketId: string;
  totalTimeMs: number;
  completionsAccepted: number;
  chatInteractions: number;
  linesFromCopilot: number;
  linesWrittenByDev: number;
  commits: number;
  filesEdited: number;
  estimatedTimeSavedMs: number;
}

export interface ROISummary {
  periodStart: string;
  periodEnd: string;
  totalDevelopers: number;
  totalSessions: number;
  totalActiveHours: number;
  overallAcceptanceRate: number;
  estimatedHoursSaved: number;
  copilotContributionRate: number;
  topTicketsByTimeSaved: TicketMetrics[];
  topLanguagesByAcceptance: Array<{ language: string; rate: number }>;
}

// ---------------------------------------------------------------------------
// Configuration (mirrors package.json settings)
// ---------------------------------------------------------------------------

export interface DevInsightsConfig {
  enabled: boolean;
  telemetryEndpoint: string;
  telemetryApiKey: string;
  flushIntervalSeconds: number;
  maxBatchSize: number;
  ticketPatterns: string[];
  ticketProvider: "jira" | "azure-devops" | "github-issues" | "rally" | "custom";
  ticketProviderBaseUrl: string;
  trackCopilotCompletions: boolean;
  trackCopilotChat: boolean;
  trackEditorActivity: boolean;
  trackGitOperations: boolean;
  anonymizeUserData: boolean;
  localStoragePath: string;
  includeCodeSnippets: boolean;
  idleTimeoutMinutes: number;
  enterpriseId: string;
  teamId: string;
  gheHost: string;
  gheRepo: string;
  gheBranch: string;
  gheTelemetryDir: string;
}

// ---------------------------------------------------------------------------
// Internal Message Types (extension <-> webview)
// ---------------------------------------------------------------------------

export type WebviewMessage =
  | { type: "requestDashboardData"; period: "today" | "week" | "month" | "custom"; startDate?: string; endDate?: string }
  | { type: "requestSessionData" }
  | { type: "requestTicketMetrics"; ticketId: string }
  | { type: "exportData"; format: "json" | "csv" }
  | { type: "associateTicket"; ticketId: string }
  | { type: "clearTicket" }
  | { type: "pauseTracking" }
  | { type: "resumeTracking" };

export type ExtensionMessage =
  | { type: "dashboardData"; data: DashboardPayload }
  | { type: "sessionUpdate"; data: SessionInfo }
  | { type: "ticketMetrics"; data: TicketMetrics }
  | { type: "configUpdate"; data: Partial<DevInsightsConfig> }
  | { type: "error"; message: string };

export interface DashboardPayload {
  currentSession: SessionInfo;
  acceptance: AcceptanceMetrics;
  productivity: ProductivityMetrics;
  ticketBreakdown: TicketMetrics[];
  roi: ROISummary;
  recentEvents: TelemetryEvent[];
}
