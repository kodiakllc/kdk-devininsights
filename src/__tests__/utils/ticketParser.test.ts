import { TicketParser } from "../../utils/ticketParser";
import { DevInsightsConfig } from "../../types";

function makeConfig(overrides: Partial<DevInsightsConfig> = {}): DevInsightsConfig {
  return {
    enabled: true,
    telemetryEndpoint: "",
    telemetryApiKey: "",
    flushIntervalSeconds: 60,
    maxBatchSize: 100,
    ticketPatterns: ["([A-Z][A-Z0-9]+-\\d+)"],
    ticketProvider: "jira",
    ticketProviderBaseUrl: "https://jira.example.com",
    trackCopilotCompletions: true,
    trackCopilotChat: true,
    trackEditorActivity: true,
    trackGitOperations: true,
    anonymizeUserData: false,
    localStoragePath: "/tmp/devinsights",
    includeCodeSnippets: false,
    idleTimeoutMinutes: 5,
    enterpriseId: "ent-1",
    teamId: "team-1",
    gheHost: "",
    gheRepo: "",
    gheBranch: "",
    gheTelemetryDir: "",
    ...overrides,
  };
}

describe("TicketParser", () => {
  describe("extractTickets", () => {
    it("finds a Jira-style ticket", () => {
      const parser = new TicketParser(makeConfig());
      const tickets = parser.extractTickets("feature/PROJ-123-add-login", "branch");
      expect(tickets).toHaveLength(1);
      expect(tickets[0].id).toBe("PROJ-123");
      expect(tickets[0].provider).toBe("jira");
      expect(tickets[0].detectedFrom).toBe("branch");
    });

    it("finds multiple tickets in one string", () => {
      const parser = new TicketParser(makeConfig());
      const tickets = parser.extractTickets("PROJ-1 and PROJ-2 related", "commit");
      expect(tickets).toHaveLength(2);
      expect(tickets[0].id).toBe("PROJ-1");
      expect(tickets[1].id).toBe("PROJ-2");
    });

    it("deduplicates tickets case-insensitively", () => {
      const parser = new TicketParser(
        makeConfig({ ticketPatterns: ["([A-Za-z][A-Za-z0-9]+-\\d+)"] })
      );
      const tickets = parser.extractTickets("proj-10 PROJ-10", "commit");
      expect(tickets).toHaveLength(1);
      expect(tickets[0].id).toBe("PROJ-10");
    });

    it("finds US/DE/BUG style patterns when configured", () => {
      const parser = new TicketParser(
        makeConfig({ ticketPatterns: ["(US\\d+)", "(DE\\d+)", "(BUG\\d+)"] })
      );
      const tickets = parser.extractTickets("US1234 DE999 BUG42", "commit");
      expect(tickets).toHaveLength(3);
      expect(tickets.map((t) => t.id)).toEqual(["US1234", "DE999", "BUG42"]);
    });

    it("returns an empty array when no match is found", () => {
      const parser = new TicketParser(makeConfig());
      const tickets = parser.extractTickets("no tickets here", "branch");
      expect(tickets).toEqual([]);
    });
  });

  describe("extractPrimaryTicket", () => {
    it("returns the first match", () => {
      const parser = new TicketParser(makeConfig());
      const ticket = parser.extractPrimaryTicket("feature/ABC-100-then-ABC-200");
      expect(ticket).not.toBeNull();
      expect(ticket!.id).toBe("ABC-100");
    });

    it("returns null when no match is found", () => {
      const parser = new TicketParser(makeConfig());
      expect(parser.extractPrimaryTicket("main")).toBeNull();
    });
  });

  describe("URL building", () => {
    it("builds a Jira URL", () => {
      const parser = new TicketParser(makeConfig({ ticketProvider: "jira" }));
      const tickets = parser.extractTickets("PROJ-1", "branch");
      expect(tickets[0].url).toBe("https://jira.example.com/browse/PROJ-1");
    });

    it("builds an Azure DevOps URL", () => {
      const parser = new TicketParser(
        makeConfig({
          ticketProvider: "azure-devops",
          ticketProviderBaseUrl: "https://dev.azure.com/org/project",
        })
      );
      const tickets = parser.extractTickets("AB-123", "branch");
      expect(tickets[0].url).toBe(
        "https://dev.azure.com/org/project/_workitems/edit/123"
      );
    });

    it("builds a GitHub Issues URL", () => {
      const parser = new TicketParser(
        makeConfig({
          ticketProvider: "github-issues",
          ticketProviderBaseUrl: "https://github.com/org/repo",
        })
      );
      const tickets = parser.extractTickets("GH-42", "branch");
      expect(tickets[0].url).toBe("https://github.com/org/repo/issues/42");
    });

    it("builds a Rally URL", () => {
      const parser = new TicketParser(
        makeConfig({
          ticketProvider: "rally",
          ticketProviderBaseUrl: "https://rally.example.com",
        })
      );
      const tickets = parser.extractTickets("US-99", "branch");
      expect(tickets[0].url).toBe(
        "https://rally.example.com/detail/userstory/US-99"
      );
    });

    it("builds a custom URL", () => {
      const parser = new TicketParser(
        makeConfig({
          ticketProvider: "custom",
          ticketProviderBaseUrl: "https://tracker.co",
        })
      );
      const tickets = parser.extractTickets("TK-7", "branch");
      expect(tickets[0].url).toBe("https://tracker.co/TK-7");
    });

    it("returns undefined when baseUrl is empty", () => {
      const parser = new TicketParser(
        makeConfig({ ticketProviderBaseUrl: "" })
      );
      const tickets = parser.extractTickets("PROJ-1", "branch");
      expect(tickets[0].url).toBeUndefined();
    });

    it("strips trailing slashes from baseUrl", () => {
      const parser = new TicketParser(
        makeConfig({ ticketProviderBaseUrl: "https://jira.example.com///" })
      );
      const tickets = parser.extractTickets("PROJ-5", "branch");
      expect(tickets[0].url).toBe("https://jira.example.com/browse/PROJ-5");
    });
  });

  describe("updateConfig", () => {
    it("changes patterns and provider", () => {
      const parser = new TicketParser(makeConfig());
      expect(parser.extractTickets("PROJ-1", "branch")).toHaveLength(1);

      parser.updateConfig(
        makeConfig({
          ticketPatterns: ["(ISSUE-\\d+)"],
          ticketProvider: "github-issues",
          ticketProviderBaseUrl: "https://github.com/org/repo",
        })
      );

      expect(parser.extractTickets("PROJ-1", "branch")).toHaveLength(0);
      const tickets = parser.extractTickets("ISSUE-55", "branch");
      expect(tickets).toHaveLength(1);
      expect(tickets[0].provider).toBe("github-issues");
      expect(tickets[0].url).toBe("https://github.com/org/repo/issues/55");
    });
  });

  describe("inferTicketType", () => {
    const cases: Array<[string, string]> = [
      ["feature/PROJ-1", "feature"],
      ["feat/PROJ-2", "feature"],
      ["bugfix/PROJ-3", "bug"],
      ["fix/PROJ-4", "bug"],
      ["hotfix/PROJ-5", "bug"],
      ["story/PROJ-6", "story"],
      ["us/PROJ-7", "story"],
      ["task/PROJ-8", "task"],
      ["chore/PROJ-9", "task"],
      ["epic/PROJ-10", "epic"],
      ["main", "other"],
      ["release/v1.0", "other"],
    ];

    it.each(cases)("returns %p -> %p", (branch, expected) => {
      expect(TicketParser.inferTicketType(branch)).toBe(expected);
    });
  });
});
