import * as vscode from "vscode";
import { ConfigService } from "../../services/configService";

describe("ConfigService", () => {
  let service: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConfigService();
  });

  afterEach(() => {
    service.dispose();
  });

  describe("getConfig", () => {
    it("returns default values when no configuration is set", () => {
      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.telemetryEndpoint).toBe("");
      expect(config.telemetryApiKey).toBe("");
      expect(config.flushIntervalSeconds).toBe(30);
      expect(config.maxBatchSize).toBe(100);
      expect(config.ticketPatterns).toEqual([
        "([A-Z]{2,10}-\\d+)",
        "(US\\d+)",
        "(DE\\d+)",
        "(BUG\\d+)",
        "(STORY-\\d+)",
      ]);
      expect(config.ticketProvider).toBe("jira");
      expect(config.ticketProviderBaseUrl).toBe("");
      expect(config.trackCopilotCompletions).toBe(true);
      expect(config.trackCopilotChat).toBe(true);
      expect(config.trackEditorActivity).toBe(true);
      expect(config.trackGitOperations).toBe(true);
      expect(config.anonymizeUserData).toBe(false);
      expect(config.localStoragePath).toBe("");
      expect(config.includeCodeSnippets).toBe(false);
      expect(config.idleTimeoutMinutes).toBe(5);
      expect(config.enterpriseId).toBe("");
      expect(config.teamId).toBe("");
      expect(config.gheHost).toBe("");
      expect(config.gheRepo).toBe("");
      expect(config.gheBranch).toBe("main");
      expect(config.gheTelemetryDir).toBe("telemetry");
    });

    it("calls workspace.getConfiguration with the correct section", () => {
      service.getConfig();
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("kdkDevInsights");
    });
  });

  describe("isFeatureEnabled", () => {
    it("returns true when enabled is true and the feature is true", () => {
      expect(service.isFeatureEnabled("trackCopilotCompletions")).toBe(true);
      expect(service.isFeatureEnabled("trackCopilotChat")).toBe(true);
      expect(service.isFeatureEnabled("trackEditorActivity")).toBe(true);
      expect(service.isFeatureEnabled("trackGitOperations")).toBe(true);
    });

    it("returns false when enabled is false", () => {
      const mockGet = jest.fn((key: string, defaultValue?: unknown) => {
        if (key === "enabled") return false;
        return defaultValue;
      });
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: mockGet });

      expect(service.isFeatureEnabled("trackCopilotCompletions")).toBe(false);
      expect(service.isFeatureEnabled("trackCopilotChat")).toBe(false);
      expect(service.isFeatureEnabled("trackEditorActivity")).toBe(false);
      expect(service.isFeatureEnabled("trackGitOperations")).toBe(false);
    });

    it("returns false when the feature itself is false", () => {
      const mockGet = jest.fn((key: string, defaultValue?: unknown) => {
        if (key === "enabled") return true;
        if (key === "trackCopilotCompletions") return false;
        return defaultValue;
      });
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: mockGet });

      expect(service.isFeatureEnabled("trackCopilotCompletions")).toBe(false);
    });
  });

  describe("dispose", () => {
    it("cleans up resources without throwing", () => {
      expect(() => service.dispose()).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });
  });

  describe("onDidChangeConfig", () => {
    it("registers a configuration change listener", () => {
      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });
  });
});
