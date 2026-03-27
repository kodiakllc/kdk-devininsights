import * as vscode from "vscode";
import { DevInsightsConfig } from "../types";

const CONFIG_SECTION = "kdkDevInsights";

/**
 * Reads and provides typed access to all extension settings.
 * Listens for configuration changes and notifies subscribers.
 */
export class ConfigService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<DevInsightsConfig>();
  public readonly onDidChangeConfig = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          this.changeEmitter.fire(this.getConfig());
        }
      })
    );
  }

  getConfig(): DevInsightsConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
      enabled: cfg.get<boolean>("enabled", true),
      telemetryEndpoint: cfg.get<string>("telemetryEndpoint", ""),
      telemetryApiKey: cfg.get<string>("telemetryApiKey", ""),
      flushIntervalSeconds: cfg.get<number>("flushIntervalSeconds", 30),
      maxBatchSize: cfg.get<number>("maxBatchSize", 100),
      ticketPatterns: cfg.get<string[]>("ticketPatterns", [
        "([A-Z]{2,10}-\\d+)",
        "(US\\d+)",
        "(DE\\d+)",
        "(BUG\\d+)",
        "(STORY-\\d+)",
      ]),
      ticketProvider: cfg.get<DevInsightsConfig["ticketProvider"]>("ticketProvider", "jira"),
      ticketProviderBaseUrl: cfg.get<string>("ticketProviderBaseUrl", ""),
      trackCopilotCompletions: cfg.get<boolean>("trackCopilotCompletions", true),
      trackCopilotChat: cfg.get<boolean>("trackCopilotChat", true),
      trackEditorActivity: cfg.get<boolean>("trackEditorActivity", true),
      trackGitOperations: cfg.get<boolean>("trackGitOperations", true),
      anonymizeUserData: cfg.get<boolean>("anonymizeUserData", false),
      localStoragePath: cfg.get<string>("localStoragePath", ""),
      includeCodeSnippets: cfg.get<boolean>("includeCodeSnippets", false),
      idleTimeoutMinutes: cfg.get<number>("idleTimeoutMinutes", 5),
      enterpriseId: cfg.get<string>("enterpriseId", ""),
      teamId: cfg.get<string>("teamId", ""),
      gheHost: cfg.get<string>("gheHost", ""),
      gheRepo: cfg.get<string>("gheRepo", ""),
      gheBranch: cfg.get<string>("gheBranch", "main"),
      gheTelemetryDir: cfg.get<string>("gheTelemetryDir", "telemetry"),
    };
  }

  /**
   * Convenience method to check if a specific tracking feature is enabled.
   */
  isFeatureEnabled(feature: keyof Pick<
    DevInsightsConfig,
    "trackCopilotCompletions" | "trackCopilotChat" | "trackEditorActivity" | "trackGitOperations"
  >): boolean {
    const config = this.getConfig();
    return config.enabled && config[feature];
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
