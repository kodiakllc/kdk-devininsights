import * as vscode from "vscode";
import {
  TelemetryEventType,
  DashboardPayload,
  WebviewMessage,
  TicketInfo,
} from "./types";
import { ConfigService } from "./services/configService";
import { CopilotCompletionTracker } from "./services/copilotTracker";
import { CopilotChatTracker } from "./services/chatTracker";
import { EditorActivityTracker } from "./services/editorActivityTracker";
import { GitService } from "./services/gitService";
import { GHPushService } from "./services/ghPushService";
import { SessionManager } from "./services/sessionManager";
import { TelemetryCollector } from "./telemetry/telemetryCollector";
import { TicketParser } from "./utils/ticketParser";
import { StatusBarProvider } from "./providers/statusBarProvider";
import {
  ActiveSessionTreeProvider,
  TicketTreeProvider,
} from "./providers/treeViewProviders";
import { DashboardPanel } from "./views/dashboardPanel";

const EXTENSION_VERSION = "1.0.0";

let extensionContext: vscode.ExtensionContext;

// Service instances
let configService: ConfigService;
let copilotTracker: CopilotCompletionTracker;
let chatTracker: CopilotChatTracker;
let editorTracker: EditorActivityTracker;
let gitService: GitService;
let ghPushService: GHPushService;
let sessionManager: SessionManager;
let telemetryCollector: TelemetryCollector;
let ticketParser: TicketParser;
let statusBar: StatusBarProvider;
let sessionTreeProvider: ActiveSessionTreeProvider;
let ticketTreeProvider: TicketTreeProvider;
let dashboardPanel: DashboardPanel;

/**
 * Extension activation entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;

  console.log("[KDK DevInsights] Activating...");

  // -----------------------------------------------------------------------
  // 1. Initialize Config
  // -----------------------------------------------------------------------
  configService = new ConfigService();
  const config = configService.getConfig();

  if (!config.enabled) {
    console.log("[KDK DevInsights] Extension is disabled via settings.");
    return;
  }

  // -----------------------------------------------------------------------
  // 2. Initialize Core Services
  // -----------------------------------------------------------------------
  ticketParser = new TicketParser(config);
  sessionManager = new SessionManager(EXTENSION_VERSION);

  // Initialize GH Push Service for GitHub Enterprise
  ghPushService = new GHPushService({
    gheHost: config.gheHost,
    gheRepo: config.gheRepo,
    gheBranch: config.gheBranch,
    gheTelemetryDir: config.gheTelemetryDir,
  });

  // Initialize gh CLI in the background (don't block activation)
  ghPushService.initialize().then(async (available) => {
    if (available && config.gheRepo) {
      await ghPushService.ensureRepoExists();
      vscode.window.showInformationMessage(
        `KDK DevInsights: Connected to ${config.gheHost}/${config.gheRepo}`
      );
    } else if (config.gheHost && !available) {
      vscode.window.showWarningMessage(
        "KDK DevInsights: gh CLI not authenticated for " +
        `${config.gheHost}. Run: gh auth login --hostname ${config.gheHost}`
      );
    }
  }).catch((err) => {
    console.warn("[KDK DevInsights] GH push init error:", err);
  });

  telemetryCollector = new TelemetryCollector(
    config,
    sessionManager.getSessionId(),
    context.globalStorageUri,
    ghPushService
  );

  gitService = new GitService(ticketParser);
  await gitService.initialize();

  copilotTracker = new CopilotCompletionTracker(config.includeCodeSnippets);
  chatTracker = new CopilotChatTracker();
  editorTracker = new EditorActivityTracker(config.idleTimeoutMinutes);

  // -----------------------------------------------------------------------
  // 3. Initialize UI Providers
  // -----------------------------------------------------------------------
  statusBar = new StatusBarProvider();

  sessionTreeProvider = new ActiveSessionTreeProvider();
  ticketTreeProvider = new TicketTreeProvider();

  vscode.window.registerTreeDataProvider("kdkDevInsights.activeSession", sessionTreeProvider);
  vscode.window.registerTreeDataProvider("kdkDevInsights.ticketAssociation", ticketTreeProvider);

  dashboardPanel = new DashboardPanel(context.extensionUri);

  // -----------------------------------------------------------------------
  // 4. Wire Event Handlers
  // -----------------------------------------------------------------------
  wireCompletionEvents();
  wireChatEvents();
  wireEditorEvents();
  wireGitEvents();
  wireSessionEvents();
  wireDashboardMessages();

  // -----------------------------------------------------------------------
  // 5. Register Commands
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("kdkDevInsights.openDashboard", () => {
      dashboardPanel.reveal();
      updateDashboard();
    }),

    vscode.commands.registerCommand("kdkDevInsights.associateTicket", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter the ticket/story ID (e.g., PROJ-123, US456)",
        placeHolder: "PROJ-123",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Please enter a ticket ID";
          }
          return null;
        },
      });

      if (input) {
        const ticket: TicketInfo = {
          id: input.trim().toUpperCase(),
          provider: config.ticketProvider,
          url: ticketParser.extractTickets(input, "manual")[0]?.url,
          detectedFrom: "manual",
        };

        sessionManager.associateTicket(ticket);
        statusBar.updateTicket(ticket);
        ticketTreeProvider.updateTicket(ticket);

        telemetryCollector.record(TelemetryEventType.TICKET_ASSOCIATED, {
          ticketId: ticket.id,
          provider: ticket.provider,
          detectedFrom: "manual",
        });

        vscode.window.showInformationMessage(
          `KDK DevInsights: Now tracking work for ${ticket.id}`
        );
      }
    }),

    vscode.commands.registerCommand("kdkDevInsights.clearTicket", () => {
      const cleared = sessionManager.getActiveTicket();
      sessionManager.clearTicket();
      statusBar.updateTicket(null);
      ticketTreeProvider.updateTicket(null);

      if (cleared) {
        telemetryCollector.record(TelemetryEventType.TICKET_CLEARED, {
          ticketId: cleared.id,
        });
      }

      vscode.window.showInformationMessage("KDK DevInsights: Ticket association cleared.");
    }),

    vscode.commands.registerCommand("kdkDevInsights.viewSessionSummary", () => {
      const session = sessionManager.toJSON();
      const rate = sessionManager.getAcceptanceRate();
      const savedMs = sessionManager.getEstimatedTimeSavedMs();
      const savedMinutes = Math.round(savedMs / 60000);

      const ghStatus = ghPushService.isAvailable()
        ? `GH Push: connected to ${config.gheHost}`
        : "GH Push: not connected";

      const summary = [
        `Session: ${(session.sessionId as string).substring(0, 8)}`,
        `Active: ${Math.round((session.totalActiveTimeMs as number) / 60000)}m`,
        `Acceptance: ${Math.round(rate * 100)}%`,
        `Completions: ${session.completionsAccepted}/${session.completionsShown}`,
        `Chat: ${session.chatPromptsSent} prompts, ${session.chatCodeInserted} insertions`,
        `Est. Time Saved: ${savedMinutes}m`,
        `Tickets: ${(session.ticketsWorkedOn as string[]).join(", ") || "none"}`,
        `\n${ghStatus}`,
      ].join("\n");

      vscode.window.showInformationMessage(summary, { modal: true });
    }),

    vscode.commands.registerCommand("kdkDevInsights.exportTelemetry", async () => {
      const format = await vscode.window.showQuickPick(["JSON", "CSV"], {
        placeHolder: "Export format",
      });

      if (format) {
        await telemetryCollector.flush();
        vscode.window.showInformationMessage(
          `KDK DevInsights: Telemetry exported as ${format}. ` +
          `Check the local storage path or telemetry endpoint.`
        );
      }
    }),

    vscode.commands.registerCommand("kdkDevInsights.pauseTracking", () => {
      telemetryCollector.pause();
      statusBar.updateTrackingState(true);
      telemetryCollector.record(TelemetryEventType.TRACKING_PAUSED, {});
      vscode.window.showInformationMessage("KDK DevInsights: Tracking paused.");
    }),

    vscode.commands.registerCommand("kdkDevInsights.resumeTracking", () => {
      telemetryCollector.resume();
      statusBar.updateTrackingState(false);
      telemetryCollector.record(TelemetryEventType.TRACKING_RESUMED, {});
      vscode.window.showInformationMessage("KDK DevInsights: Tracking resumed.");
    })
  );

  // -----------------------------------------------------------------------
  // 6. Initialize Trackers
  // -----------------------------------------------------------------------
  if (config.trackCopilotCompletions) {
    await copilotTracker.initialize();
  }
  if (config.trackCopilotChat) {
    await chatTracker.initialize();
  }
  if (config.trackEditorActivity) {
    editorTracker.initialize();
  }

  // -----------------------------------------------------------------------
  // 7. Auto-detect Ticket from Current Branch
  // -----------------------------------------------------------------------
  const gitState = gitService.getState();
  if (gitState && gitState.detectedTickets.length > 0) {
    sessionManager.autoDetectTicket(gitState.detectedTickets);
    statusBar.updateTicket(gitState.detectedTickets[0]);
    ticketTreeProvider.updateTicket(gitState.detectedTickets[0]);

    telemetryCollector.record(TelemetryEventType.TICKET_AUTO_DETECTED, {
      ticketId: gitState.detectedTickets[0].id,
      branch: gitState.branch,
    });
  }

  // -----------------------------------------------------------------------
  // 8. Config Change Listener
  // -----------------------------------------------------------------------
  context.subscriptions.push(
    configService.onDidChangeConfig((newConfig) => {
      ticketParser.updateConfig(newConfig);
      telemetryCollector.updateConfig(newConfig);
      editorTracker.updateConfig(newConfig.idleTimeoutMinutes);
      copilotTracker.updateConfig(newConfig.includeCodeSnippets);
      ghPushService.updateConfig({
        gheHost: newConfig.gheHost,
        gheRepo: newConfig.gheRepo,
        gheBranch: newConfig.gheBranch,
        gheTelemetryDir: newConfig.gheTelemetryDir,
      });
    })
  );

  // -----------------------------------------------------------------------
  // 9. Record Extension Activation
  // -----------------------------------------------------------------------
  telemetryCollector.record(TelemetryEventType.EXTENSION_ACTIVATED, {
    vscodeVersion: vscode.version,
    extensionVersion: EXTENSION_VERSION,
    ghPushAvailable: ghPushService.isAvailable(),
    gheHost: config.gheHost,
  });

  // Push all disposables
  context.subscriptions.push(
    configService,
    copilotTracker,
    chatTracker,
    editorTracker,
    gitService,
    ghPushService,
    sessionManager,
    telemetryCollector,
    statusBar,
    dashboardPanel
  );

  console.log("[KDK DevInsights] Activated successfully.");
}

/**
 * Extension deactivation entry point.
 */
export async function deactivate(): Promise<void> {
  console.log("[KDK DevInsights] Deactivating...");

  if (telemetryCollector) {
    telemetryCollector.record(TelemetryEventType.EXTENSION_DEACTIVATED, {});
    telemetryCollector.record(TelemetryEventType.SESSION_END, sessionManager.toJSON());
    await telemetryCollector.flush();
  }

  if (sessionManager) {
    sessionManager.endSession();
  }
}

// ---------------------------------------------------------------------------
// Event Wiring Functions
// ---------------------------------------------------------------------------

function wireCompletionEvents(): void {
  copilotTracker.onCompletionShown((meta) => {
    sessionManager.recordCompletionShown();
    telemetryCollector.record(TelemetryEventType.COMPLETION_SHOWN, meta as unknown as Record<string, unknown>);
    updateStatusBar();
  });

  copilotTracker.onCompletionAccepted((meta) => {
    sessionManager.recordCompletionAccepted(meta.lineCount, meta.language, meta.fileRelativePath);
    telemetryCollector.record(TelemetryEventType.COMPLETION_ACCEPTED, meta as unknown as Record<string, unknown>, {
      gitBranch: gitService.getCurrentBranch(),
      gitRepo: gitService.getCurrentRepo(),
      associatedTicket: sessionManager.getActiveTicket(),
    });
    updateStatusBar();
  });

  copilotTracker.onCompletionDismissed((meta) => {
    sessionManager.recordCompletionDismissed();
    telemetryCollector.record(TelemetryEventType.COMPLETION_DISMISSED, meta as unknown as Record<string, unknown>);
    updateStatusBar();
  });
}

function wireChatEvents(): void {
  chatTracker.onPromptSent((meta) => {
    sessionManager.recordChatPrompt();
    telemetryCollector.record(TelemetryEventType.CHAT_PROMPT_SENT, meta as unknown as Record<string, unknown>, {
      gitBranch: gitService.getCurrentBranch(),
      associatedTicket: sessionManager.getActiveTicket(),
    });
    updateStatusBar();
  });

  chatTracker.onCodeInserted((meta) => {
    sessionManager.recordChatCodeInserted();
    telemetryCollector.record(TelemetryEventType.CHAT_CODE_INSERTED, meta as unknown as Record<string, unknown>);
    updateStatusBar();
  });

  chatTracker.onCodeCopied((meta) => {
    sessionManager.recordChatCodeCopied();
    telemetryCollector.record(TelemetryEventType.CHAT_CODE_COPIED, meta as unknown as Record<string, unknown>);
  });

  chatTracker.onSlashCommandUsed((meta) => {
    telemetryCollector.record(TelemetryEventType.CHAT_SLASH_COMMAND_USED, meta as unknown as Record<string, unknown>);
  });
}

function wireEditorEvents(): void {
  editorTracker.onLinesChanged((data) => {
    if (data.linesAdded > 0) {
      sessionManager.recordLinesWrittenByDev(data.linesAdded);
    }
    sessionManager.recordFileEdited(data.fileRelativePath, data.language);
    telemetryCollector.record(TelemetryEventType.EDITOR_LINES_CHANGED, data as unknown as Record<string, unknown>);
  });

  editorTracker.onFileSaved((meta) => {
    telemetryCollector.record(TelemetryEventType.EDITOR_FILE_SAVED, meta as unknown as Record<string, unknown>, {
      gitBranch: gitService.getCurrentBranch(),
      associatedTicket: sessionManager.getActiveTicket(),
    });
  });

  editorTracker.onIdleStart(() => {
    sessionManager.recordIdleStart();
    telemetryCollector.record(TelemetryEventType.SESSION_IDLE_START, {});
  });

  editorTracker.onIdleEnd((data) => {
    sessionManager.recordIdleEnd(data.idleDurationMs);
    telemetryCollector.record(TelemetryEventType.SESSION_IDLE_END, {
      idleDurationMs: data.idleDurationMs,
    });
  });
}

function wireGitEvents(): void {
  gitService.onBranchChange((data) => {
    sessionManager.recordBranch(data.current);
    telemetryCollector.record(TelemetryEventType.GIT_BRANCH_SWITCH, {
      previousBranch: data.previous,
      currentBranch: data.current,
      operation: "branchSwitch",
      branch: data.current,
      repoName: gitService.getCurrentRepo(),
    });

    // Auto-detect ticket from new branch
    if (data.tickets.length > 0) {
      sessionManager.autoDetectTicket(data.tickets);
      statusBar.updateTicket(data.tickets[0]);
      ticketTreeProvider.updateTicket(data.tickets[0]);

      telemetryCollector.record(TelemetryEventType.TICKET_AUTO_DETECTED, {
        ticketId: data.tickets[0].id,
        branch: data.current,
      });
    }
  });

  gitService.onCommit((meta) => {
    sessionManager.recordCommit();
    telemetryCollector.record(TelemetryEventType.GIT_COMMIT, meta as unknown as Record<string, unknown>, {
      associatedTicket: sessionManager.getActiveTicket(),
    });
    updateStatusBar();
  });
}

function wireSessionEvents(): void {
  sessionManager.onSessionUpdate((session) => {
    sessionTreeProvider.update(session);
    ticketTreeProvider.updateTicketsWorkedOn(session.ticketsWorkedOn);

    // If dashboard is visible, push updates
    if (dashboardPanel.isVisible()) {
      dashboardPanel.postMessage({ type: "sessionUpdate", data: session });
    }
  });
}

function wireDashboardMessages(): void {
  dashboardPanel.onMessage((message: WebviewMessage) => {
    switch (message.type) {
      case "requestDashboardData":
        updateDashboard();
        break;
      case "requestSessionData":
        dashboardPanel.postMessage({
          type: "sessionUpdate",
          data: sessionManager.getSession(),
        });
        break;
      case "pauseTracking":
        vscode.commands.executeCommand("kdkDevInsights.pauseTracking");
        break;
      case "resumeTracking":
        vscode.commands.executeCommand("kdkDevInsights.resumeTracking");
        break;
      case "associateTicket":
        vscode.commands.executeCommand("kdkDevInsights.associateTicket");
        break;
      case "clearTicket":
        vscode.commands.executeCommand("kdkDevInsights.clearTicket");
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function updateStatusBar(): void {
  statusBar.updateFromSession(sessionManager.getSession());
}

function updateDashboard(): void {
  const session = sessionManager.getSession();
  const rate = sessionManager.getAcceptanceRate();

  const payload: DashboardPayload = {
    currentSession: session,
    acceptance: {
      totalShown: session.completionsShown,
      totalAccepted: session.completionsAccepted,
      totalDismissed: session.completionsDismissed,
      totalPartiallyAccepted: session.completionsPartiallyAccepted,
      acceptanceRate: rate,
      avgResponseTimeMs: 0,
      byLanguage: {},
      byHour: {},
    },
    productivity: {
      totalActiveTimeMs: session.totalActiveTimeMs,
      totalCodingTimeMs: session.totalActiveTimeMs - session.totalIdleTimeMs,
      linesWrittenByDev: session.linesWrittenByDev,
      linesFromCopilot: session.linesAcceptedFromCopilot,
      copilotContributionRate: (session.linesWrittenByDev + session.linesAcceptedFromCopilot) > 0
        ? session.linesAcceptedFromCopilot / (session.linesWrittenByDev + session.linesAcceptedFromCopilot)
        : 0,
      avgCompletionLengthLines: session.completionsAccepted > 0
        ? session.linesAcceptedFromCopilot / session.completionsAccepted
        : 0,
      chatInteractions: session.chatPromptsSent,
      chatCodeAdopted: session.chatCodeInserted,
      estimatedTimeSavedMs: sessionManager.getEstimatedTimeSavedMs(),
    },
    ticketBreakdown: [],
    roi: {
      periodStart: session.startTime,
      periodEnd: new Date().toISOString(),
      totalDevelopers: 1,
      totalSessions: 1,
      totalActiveHours: session.totalActiveTimeMs / 3600000,
      overallAcceptanceRate: rate,
      estimatedHoursSaved: sessionManager.getEstimatedTimeSavedMs() / 3600000,
      copilotContributionRate: (session.linesWrittenByDev + session.linesAcceptedFromCopilot) > 0
        ? session.linesAcceptedFromCopilot / (session.linesWrittenByDev + session.linesAcceptedFromCopilot)
        : 0,
      topTicketsByTimeSaved: [],
      topLanguagesByAcceptance: [],
    },
    recentEvents: [],
  };

  dashboardPanel.updateDashboard(payload);
}
