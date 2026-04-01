import * as vscode from "vscode";
import { StatusBarProvider } from "../../providers/statusBarProvider";
import { SessionInfo, TicketInfo } from "../../types";

describe("StatusBarProvider", () => {
  let provider: StatusBarProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new StatusBarProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe("constructor", () => {
    it("creates three status bar items", () => {
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(3);
    });

    it("creates items with correct alignments and priorities", () => {
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 100);
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 99);
      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 98);
    });

    it("shows all three status bar items", () => {
      const metricsItem = (provider as any).metricsItem;
      const ticketItem = (provider as any).ticketItem;
      const trackingItem = (provider as any).trackingItem;
      expect(metricsItem.show).toHaveBeenCalled();
      expect(ticketItem.show).toHaveBeenCalled();
      expect(trackingItem.show).toHaveBeenCalled();
    });

    it("sets the metrics item command to openDashboard", () => {
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.command).toBe("kdkDevInsights.openDashboard");
    });

    it("sets the ticket item command to associateTicket", () => {
      const ticketItem = (provider as any).ticketItem;
      expect(ticketItem.command).toBe("kdkDevInsights.associateTicket");
    });
  });

  describe("updateMetrics", () => {
    it("shows check icon when acceptance rate >= 50%", () => {
      provider.updateMetrics(0.75, 15, 5);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(check)");
      expect(metricsItem.text).toContain("75%");
    });

    it("shows check icon when acceptance rate is exactly 50%", () => {
      provider.updateMetrics(0.5, 10, 3);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(check)");
      expect(metricsItem.text).toContain("50%");
    });

    it("shows dash icon when 25% <= rate < 50%", () => {
      provider.updateMetrics(0.3, 6, 2);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(dash)");
      expect(metricsItem.text).toContain("30%");
    });

    it("shows dash icon when rate is exactly 25%", () => {
      provider.updateMetrics(0.25, 5, 1);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(dash)");
      expect(metricsItem.text).toContain("25%");
    });

    it("shows x icon when rate < 25%", () => {
      provider.updateMetrics(0.1, 2, 1);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(x)");
      expect(metricsItem.text).toContain("10%");
    });

    it("shows x icon when rate is 0%", () => {
      provider.updateMetrics(0, 0, 0);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("$(x)");
      expect(metricsItem.text).toContain("0%");
    });

    it("includes completions accepted and chat interactions counts", () => {
      provider.updateMetrics(0.6, 12, 7);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("12");
      expect(metricsItem.text).toContain("7");
    });
  });

  describe("updateTicket", () => {
    it("shows ticket id when a ticket is set", () => {
      const ticket: TicketInfo = {
        id: "PROJ-42",
        provider: "jira",
        detectedFrom: "branch",
      };
      provider.updateTicket(ticket);
      const ticketItem = (provider as any).ticketItem;
      expect(ticketItem.text).toContain("PROJ-42");
      expect(ticketItem.text).toContain("$(bookmark)");
      expect(ticketItem.color).toBeUndefined();
    });

    it("shows 'No ticket' when ticket is null", () => {
      provider.updateTicket(null);
      const ticketItem = (provider as any).ticketItem;
      expect(ticketItem.text).toContain("No ticket");
      expect(ticketItem.color).toBeInstanceOf(vscode.ThemeColor);
    });
  });

  describe("updateTrackingState", () => {
    it("shows 'Paused' with resume command when paused", () => {
      provider.updateTrackingState(true);
      const trackingItem = (provider as any).trackingItem;
      expect(trackingItem.text).toContain("Paused");
      expect(trackingItem.text).toContain("$(debug-pause)");
      expect(trackingItem.command).toBe("kdkDevInsights.resumeTracking");
    });

    it("shows 'Tracking' with pause command when active", () => {
      provider.updateTrackingState(false);
      const trackingItem = (provider as any).trackingItem;
      expect(trackingItem.text).toContain("Tracking");
      expect(trackingItem.text).toContain("$(pulse)");
      expect(trackingItem.command).toBe("kdkDevInsights.pauseTracking");
    });
  });

  describe("updateFromSession", () => {
    it("calculates rate from session and updates metrics", () => {
      const session: SessionInfo = {
        sessionId: "test-session",
        startTime: new Date().toISOString(),
        userId: "test-user",
        machineId: "test-machine",
        workspacePath: "/test",
        workspaceName: "test",
        vscodeVersion: "1.85.0",
        extensionVersion: "1.0.0",
        os: "linux-x64",
        totalActiveTimeMs: 10000,
        totalIdleTimeMs: 0,
        completionsShown: 10,
        completionsAccepted: 6,
        completionsDismissed: 4,
        completionsPartiallyAccepted: 0,
        chatPromptsSent: 3,
        chatCodeInserted: 1,
        chatCodeCopied: 0,
        linesWrittenByDev: 50,
        linesAcceptedFromCopilot: 20,
        filesEdited: new Set<string>(),
        languagesUsed: new Set<string>(),
        branchesWorkedOn: new Set<string>(),
        ticketsWorkedOn: new Set<string>(),
        commits: 2,
      };

      provider.updateFromSession(session);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("60%");
      expect(metricsItem.text).toContain("$(check)");
      expect(metricsItem.text).toContain("6");
      expect(metricsItem.text).toContain("3");
    });

    it("handles zero completionsShown gracefully", () => {
      const session: SessionInfo = {
        sessionId: "test-session",
        startTime: new Date().toISOString(),
        userId: "test-user",
        machineId: "test-machine",
        workspacePath: "/test",
        workspaceName: "test",
        vscodeVersion: "1.85.0",
        extensionVersion: "1.0.0",
        os: "linux-x64",
        totalActiveTimeMs: 0,
        totalIdleTimeMs: 0,
        completionsShown: 0,
        completionsAccepted: 0,
        completionsDismissed: 0,
        completionsPartiallyAccepted: 0,
        chatPromptsSent: 0,
        chatCodeInserted: 0,
        chatCodeCopied: 0,
        linesWrittenByDev: 0,
        linesAcceptedFromCopilot: 0,
        filesEdited: new Set<string>(),
        languagesUsed: new Set<string>(),
        branchesWorkedOn: new Set<string>(),
        ticketsWorkedOn: new Set<string>(),
        commits: 0,
      };

      provider.updateFromSession(session);
      const metricsItem = (provider as any).metricsItem;
      expect(metricsItem.text).toContain("0%");
    });
  });

  describe("dispose", () => {
    it("disposes all status bar items", () => {
      const metricsItem = (provider as any).metricsItem;
      const ticketItem = (provider as any).ticketItem;
      const trackingItem = (provider as any).trackingItem;

      provider.dispose();

      expect(metricsItem.dispose).toHaveBeenCalled();
      expect(ticketItem.dispose).toHaveBeenCalled();
      expect(trackingItem.dispose).toHaveBeenCalled();
    });
  });
});
