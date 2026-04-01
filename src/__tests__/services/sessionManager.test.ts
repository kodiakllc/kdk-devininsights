import { SessionManager } from "../../services/sessionManager";
import { TicketInfo } from "../../types";

describe("SessionManager", () => {
  let manager: SessionManager;
  const extensionVersion = "1.0.0-test";

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SessionManager(extensionVersion);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("constructor", () => {
    it("sets a sessionId", () => {
      expect(manager.getSessionId()).toBeDefined();
      expect(typeof manager.getSessionId()).toBe("string");
      expect(manager.getSessionId().length).toBeGreaterThan(0);
    });

    it("sets startTime as an ISO string", () => {
      const session = manager.getSession();
      expect(session.startTime).toBeDefined();
      expect(new Date(session.startTime).toISOString()).toBe(session.startTime);
    });

    it("sets version fields correctly", () => {
      const session = manager.getSession();
      expect(session.extensionVersion).toBe(extensionVersion);
      expect(session.vscodeVersion).toBe("1.85.0");
    });

    it("initializes counters to zero", () => {
      const session = manager.getSession();
      expect(session.completionsShown).toBe(0);
      expect(session.completionsAccepted).toBe(0);
      expect(session.completionsDismissed).toBe(0);
      expect(session.chatPromptsSent).toBe(0);
      expect(session.chatCodeInserted).toBe(0);
      expect(session.chatCodeCopied).toBe(0);
      expect(session.linesWrittenByDev).toBe(0);
      expect(session.linesAcceptedFromCopilot).toBe(0);
      expect(session.commits).toBe(0);
    });

    it("has no active ticket initially", () => {
      expect(manager.getActiveTicket()).toBeNull();
    });
  });

  describe("recordCompletionShown", () => {
    it("increments completionsShown counter", () => {
      manager.recordCompletionShown();
      expect(manager.getSession().completionsShown).toBe(1);
      manager.recordCompletionShown();
      expect(manager.getSession().completionsShown).toBe(2);
    });
  });

  describe("recordCompletionAccepted", () => {
    it("increments completionsAccepted counter", () => {
      manager.recordCompletionAccepted(5, "typescript", "/src/index.ts");
      expect(manager.getSession().completionsAccepted).toBe(1);
    });

    it("adds language to languagesUsed set", () => {
      manager.recordCompletionAccepted(3, "typescript", "/src/index.ts");
      expect(manager.getSession().languagesUsed.has("typescript")).toBe(true);
    });

    it("adds file path to filesEdited set", () => {
      manager.recordCompletionAccepted(3, "typescript", "/src/index.ts");
      expect(manager.getSession().filesEdited.has("/src/index.ts")).toBe(true);
    });

    it("accumulates linesAcceptedFromCopilot", () => {
      manager.recordCompletionAccepted(5, "typescript", "/src/a.ts");
      manager.recordCompletionAccepted(10, "python", "/src/b.py");
      expect(manager.getSession().linesAcceptedFromCopilot).toBe(15);
    });
  });

  describe("recordCompletionDismissed", () => {
    it("increments completionsDismissed counter", () => {
      manager.recordCompletionDismissed();
      expect(manager.getSession().completionsDismissed).toBe(1);
      manager.recordCompletionDismissed();
      expect(manager.getSession().completionsDismissed).toBe(2);
    });
  });

  describe("recordChatPrompt", () => {
    it("increments chatPromptsSent counter", () => {
      manager.recordChatPrompt();
      expect(manager.getSession().chatPromptsSent).toBe(1);
    });
  });

  describe("recordChatCodeInserted", () => {
    it("increments chatCodeInserted counter", () => {
      manager.recordChatCodeInserted();
      expect(manager.getSession().chatCodeInserted).toBe(1);
    });
  });

  describe("recordChatCodeCopied", () => {
    it("increments chatCodeCopied counter", () => {
      manager.recordChatCodeCopied();
      expect(manager.getSession().chatCodeCopied).toBe(1);
    });
  });

  describe("recordLinesWrittenByDev", () => {
    it("accumulates lines written", () => {
      manager.recordLinesWrittenByDev(10);
      manager.recordLinesWrittenByDev(20);
      expect(manager.getSession().linesWrittenByDev).toBe(30);
    });
  });

  describe("recordFileEdited", () => {
    it("adds file path and language to their respective sets", () => {
      manager.recordFileEdited("/src/app.ts", "typescript");
      manager.recordFileEdited("/src/style.css", "css");
      const session = manager.getSession();
      expect(session.filesEdited.has("/src/app.ts")).toBe(true);
      expect(session.filesEdited.has("/src/style.css")).toBe(true);
      expect(session.languagesUsed.has("typescript")).toBe(true);
      expect(session.languagesUsed.has("css")).toBe(true);
    });
  });

  describe("recordBranch", () => {
    it("adds branch name to branchesWorkedOn set", () => {
      manager.recordBranch("feature/test");
      manager.recordBranch("main");
      const session = manager.getSession();
      expect(session.branchesWorkedOn.has("feature/test")).toBe(true);
      expect(session.branchesWorkedOn.has("main")).toBe(true);
    });
  });

  describe("recordCommit", () => {
    it("increments commits counter", () => {
      manager.recordCommit();
      manager.recordCommit();
      expect(manager.getSession().commits).toBe(2);
    });
  });

  describe("recordIdleEnd", () => {
    it("accumulates idle time", () => {
      manager.recordIdleEnd(1000);
      manager.recordIdleEnd(2000);
      expect(manager.getSession().totalIdleTimeMs).toBe(3000);
    });
  });

  describe("associateTicket", () => {
    const ticket: TicketInfo = {
      id: "PROJ-123",
      provider: "jira",
      detectedFrom: "branch",
    };

    it("sets the active ticket", () => {
      manager.associateTicket(ticket);
      expect(manager.getActiveTicket()).toEqual(ticket);
    });

    it("adds ticket id to ticketsWorkedOn set", () => {
      manager.associateTicket(ticket);
      expect(manager.getSession().ticketsWorkedOn.has("PROJ-123")).toBe(true);
    });
  });

  describe("clearTicket", () => {
    it("clears the active ticket", () => {
      const ticket: TicketInfo = {
        id: "PROJ-456",
        provider: "jira",
        detectedFrom: "manual",
      };
      manager.associateTicket(ticket);
      expect(manager.getActiveTicket()).not.toBeNull();

      manager.clearTicket();
      expect(manager.getActiveTicket()).toBeNull();
    });
  });

  describe("autoDetectTicket", () => {
    const tickets: TicketInfo[] = [
      { id: "AUTO-1", provider: "jira", detectedFrom: "branch" },
      { id: "AUTO-2", provider: "jira", detectedFrom: "branch" },
    ];

    it("sets the first ticket when none is active", () => {
      manager.autoDetectTicket(tickets);
      expect(manager.getActiveTicket()?.id).toBe("AUTO-1");
    });

    it("skips if a ticket is already active", () => {
      const existingTicket: TicketInfo = {
        id: "EXISTING-1",
        provider: "jira",
        detectedFrom: "manual",
      };
      manager.associateTicket(existingTicket);
      manager.autoDetectTicket(tickets);
      expect(manager.getActiveTicket()?.id).toBe("EXISTING-1");
    });

    it("does nothing when passed an empty array", () => {
      manager.autoDetectTicket([]);
      expect(manager.getActiveTicket()).toBeNull();
    });
  });

  describe("endSession", () => {
    it("sets endTime on the session", () => {
      const session = manager.endSession();
      expect(session.endTime).toBeDefined();
      expect(new Date(session.endTime!).toISOString()).toBe(session.endTime);
    });
  });

  describe("toJSON", () => {
    it("converts Sets to Arrays", () => {
      manager.recordFileEdited("/src/a.ts", "typescript");
      manager.recordBranch("main");
      manager.associateTicket({
        id: "TKT-1",
        provider: "jira",
        detectedFrom: "branch",
      });

      const json = manager.toJSON();
      expect(Array.isArray(json.filesEdited)).toBe(true);
      expect(Array.isArray(json.languagesUsed)).toBe(true);
      expect(Array.isArray(json.branchesWorkedOn)).toBe(true);
      expect(Array.isArray(json.ticketsWorkedOn)).toBe(true);
      expect(json.filesEdited).toContain("/src/a.ts");
      expect(json.languagesUsed).toContain("typescript");
      expect(json.branchesWorkedOn).toContain("main");
      expect(json.ticketsWorkedOn).toContain("TKT-1");
    });
  });

  describe("getAcceptanceRate", () => {
    it("returns 0 when no completions have been shown", () => {
      expect(manager.getAcceptanceRate()).toBe(0);
    });

    it("returns the correct ratio of accepted to shown", () => {
      manager.recordCompletionShown();
      manager.recordCompletionShown();
      manager.recordCompletionShown();
      manager.recordCompletionShown();
      manager.recordCompletionAccepted(1, "typescript", "/src/a.ts");
      manager.recordCompletionAccepted(1, "typescript", "/src/b.ts");
      expect(manager.getAcceptanceRate()).toBe(0.5);
    });
  });

  describe("getEstimatedTimeSavedMs", () => {
    it("uses the default 55-second multiplier", () => {
      manager.recordCompletionAccepted(1, "typescript", "/src/a.ts");
      manager.recordCompletionAccepted(1, "typescript", "/src/b.ts");
      expect(manager.getEstimatedTimeSavedMs()).toBe(2 * 55 * 1000);
    });

    it("uses a custom multiplier when provided", () => {
      manager.recordCompletionAccepted(1, "typescript", "/src/a.ts");
      expect(manager.getEstimatedTimeSavedMs(30)).toBe(1 * 30 * 1000);
    });

    it("returns 0 when no completions have been accepted", () => {
      expect(manager.getEstimatedTimeSavedMs()).toBe(0);
    });
  });

  describe("session update events", () => {
    it("emits updates on metric changes", () => {
      const listener = jest.fn();
      manager.onSessionUpdate(listener);

      manager.recordCompletionShown();
      expect(listener).toHaveBeenCalledTimes(1);

      manager.recordCommit();
      expect(listener).toHaveBeenCalledTimes(2);

      const session = listener.mock.calls[0][0];
      expect(session.completionsShown).toBe(1);
    });
  });

  describe("ticket change events", () => {
    it("emits ticket change when ticket is associated", () => {
      const listener = jest.fn();
      manager.onTicketChange(listener);
      const ticket: TicketInfo = {
        id: "EVT-1",
        provider: "jira",
        detectedFrom: "branch",
      };
      manager.associateTicket(ticket);
      expect(listener).toHaveBeenCalledWith(ticket);
    });

    it("emits null when ticket is cleared", () => {
      const listener = jest.fn();
      manager.onTicketChange(listener);
      manager.associateTicket({
        id: "EVT-2",
        provider: "jira",
        detectedFrom: "manual",
      });
      manager.clearTicket();
      expect(listener).toHaveBeenLastCalledWith(null);
    });
  });

  describe("dispose", () => {
    it("cleans up without throwing", () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
