import * as vscode from "vscode";
import { execFile } from "child_process";
import * as path from "path";
import * as os from "os";
import { TelemetryEvent } from "../types";

/**
 * Pushes telemetry data to a GitHub Enterprise repository using the `gh` CLI.
 *
 * Flow:
 *   1. On flush, serialize the event batch to JSON.
 *   2. Use `gh api` to push the file contents to the configured repo
 *      via the GitHub Contents API (no local clone required).
 *   3. Falls back to local file storage if `gh` is unavailable or
 *      the push fails.
 *
 * The user must have `gh` authenticated for the target GHE host:
 *   gh auth login --hostname <your-ghe-host>
 */

export interface GHPushConfig {
  /** GHE hostname (e.g. "github.mycompany.com") */
  gheHost: string;
  /** Target repo in OWNER/REPO format, e.g. "my-org/devinsights-telemetry" */
  gheRepo: string;
  /** Branch to push telemetry files to (default: "main") */
  gheBranch: string;
  /** Directory within the repo to store telemetry (default: "telemetry") */
  gheTelemetryDir: string;
}

export class GHPushService implements vscode.Disposable {
  private config: GHPushConfig;
  private ghPath: string | null = null;
  private available: boolean = false;
  private userId: string;
  private machineId: string;

  constructor(config: GHPushConfig) {
    this.config = config;
    this.userId = os.userInfo().username || "unknown";
    this.machineId = vscode.env.machineId.substring(0, 8);
  }

  /**
   * Discover `gh` CLI on the system and verify auth for the GHE host.
   */
  async initialize(): Promise<boolean> {
    if (!this.config.gheHost) {
      console.log(
        "[KDK DevInsights] No GHE host configured. " +
        "Set kdkDevInsights.gheHost in VS Code settings to enable GH push."
      );
      return false;
    }

    // Try common install locations
    const candidates = [
      "gh",
      "/usr/local/bin/gh",
      "/opt/homebrew/bin/gh",
      path.join(os.homedir(), ".local", "bin", "gh"),
    ];

    for (const candidate of candidates) {
      try {
        const version = await this.exec(candidate, ["--version"]);
        if (version.includes("gh version")) {
          this.ghPath = candidate;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!this.ghPath) {
      console.warn(
        "[KDK DevInsights] gh CLI not found. " +
        "Install it: https://cli.github.com  " +
        "Telemetry will be stored locally only."
      );
      return false;
    }

    // Verify authentication for the GHE host
    try {
      const authStatus = await this.exec(this.ghPath, [
        "auth", "status",
        "--hostname", this.config.gheHost,
      ]);
      if (authStatus.includes("Logged in")) {
        this.available = true;
        console.log(
          `[KDK DevInsights] gh CLI authenticated for ${this.config.gheHost}`
        );
        return true;
      }
    } catch (err) {
      // Auth check might fail with exit code 1 but still print useful info
      const msg = String(err);
      if (msg.includes("Logged in")) {
        this.available = true;
        console.log(
          `[KDK DevInsights] gh CLI authenticated for ${this.config.gheHost}`
        );
        return true;
      }

      console.warn(
        `[KDK DevInsights] gh CLI is not authenticated for ${this.config.gheHost}. ` +
        `Run: gh auth login --hostname ${this.config.gheHost}`
      );
    }

    return false;
  }

  /**
   * Push a batch of telemetry events to the GHE repo.
   *
   * Uses the GitHub Contents API via `gh api` to create/update a file
   * without needing a local git clone.
   */
  async pushEvents(events: TelemetryEvent[]): Promise<boolean> {
    if (!this.available || !this.ghPath) {
      return false;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${this.userId}/${this.machineId}/${timestamp}.json`;
    const filePath = `${this.config.gheTelemetryDir}/${fileName}`;

    const payload = JSON.stringify({
      pushedAt: new Date().toISOString(),
      user: this.userId,
      machine: this.machineId,
      eventCount: events.length,
      events,
    }, null, 2);

    // Base64 encode for the Contents API
    const contentBase64 = Buffer.from(payload, "utf-8").toString("base64");

    const apiPayload = JSON.stringify({
      message: `telemetry: ${this.userId} ${events.length} events @ ${timestamp}`,
      content: contentBase64,
      branch: this.config.gheBranch,
    });

    try {
      await this.exec(this.ghPath, [
        "api",
        "--hostname", this.config.gheHost,
        "--method", "PUT",
        `/repos/${this.config.gheRepo}/contents/${filePath}`,
        "--input", "-",
      ], apiPayload);

      console.log(
        `[KDK DevInsights] Pushed ${events.length} events to ` +
        `${this.config.gheHost}/${this.config.gheRepo}/${filePath}`
      );
      return true;
    } catch (err) {
      console.error("[KDK DevInsights] GH push failed:", err);
      // Try fallback: create a gist instead
      return this.pushAsGist(events, timestamp);
    }
  }

  /**
   * Fallback: push telemetry as a private gist on the GHE instance.
   */
  private async pushAsGist(
    events: TelemetryEvent[],
    timestamp: string
  ): Promise<boolean> {
    if (!this.ghPath) {
      return false;
    }

    const payload = JSON.stringify({
      pushedAt: new Date().toISOString(),
      user: this.userId,
      machine: this.machineId,
      eventCount: events.length,
      events,
    }, null, 2);

    const gistFileName = `devinsights-${timestamp}.json`;

    try {
      // Write payload to a temp file (gh gist create needs a file)
      const tmpFile = path.join(os.tmpdir(), gistFileName);
      const fs = await import("fs/promises");
      await fs.writeFile(tmpFile, payload, "utf-8");

      await this.exec(this.ghPath, [
        "gist", "create",
        "--hostname", this.config.gheHost,
        "--desc", `KDK DevInsights telemetry: ${this.userId} @ ${timestamp}`,
        "--public=false",
        tmpFile,
      ]);

      // Clean up temp file
      await fs.unlink(tmpFile).catch(() => {});

      console.log(
        `[KDK DevInsights] Pushed ${events.length} events as gist on ${this.config.gheHost}`
      );
      return true;
    } catch (err) {
      console.error("[KDK DevInsights] Gist fallback also failed:", err);
      return false;
    }
  }

  /**
   * Check if the GHE repo exists. If not, offer to create it.
   */
  async ensureRepoExists(): Promise<boolean> {
    if (!this.available || !this.ghPath) {
      return false;
    }

    try {
      await this.exec(this.ghPath, [
        "api",
        "--hostname", this.config.gheHost,
        `/repos/${this.config.gheRepo}`,
      ]);
      return true;
    } catch {
      // Repo doesn't exist; try to create it
      try {
        const [owner, repo] = this.config.gheRepo.split("/");
        await this.exec(this.ghPath, [
          "api",
          "--hostname", this.config.gheHost,
          "--method", "POST",
          `/orgs/${owner}/repos`,
          "-f", `name=${repo}`,
          "-f", "private=true",
          "-f", "description=KDK DevInsights telemetry data",
          "-f", "auto_init=true",
        ]);
        console.log(
          `[KDK DevInsights] Created repo ${this.config.gheRepo} on ${this.config.gheHost}`
        );
        return true;
      } catch (createErr) {
        // Try user repo if org creation failed
        try {
          const [, repo] = this.config.gheRepo.split("/");
          await this.exec(this.ghPath!, [
            "api",
            "--hostname", this.config.gheHost,
            "--method", "POST",
            "/user/repos",
            "-f", `name=${repo}`,
            "-f", "private=true",
            "-f", "description=KDK DevInsights telemetry data",
            "-f", "auto_init=true",
          ]);
          console.log(
            `[KDK DevInsights] Created user repo ${this.config.gheRepo} on ${this.config.gheHost}`
          );
          return true;
        } catch (userErr) {
          console.error("[KDK DevInsights] Could not create telemetry repo:", userErr);
          return false;
        }
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  updateConfig(config: GHPushConfig): void {
    this.config = config;
  }

  /**
   * Run a CLI command and return stdout.
   */
  private exec(
    cmd: string,
    args: string[],
    stdin?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, args, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          // Ensure GH_HOST is set for GHE
          GH_HOST: this.config.gheHost,
        },
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });

      if (stdin && child.stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }
    });
  }

  dispose(): void {
    // Nothing to clean up
  }
}
