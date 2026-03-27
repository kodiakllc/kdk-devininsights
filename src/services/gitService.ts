import * as vscode from "vscode";
import { GitOperationMetadata, TicketInfo } from "../types";
import { TicketParser } from "../utils/ticketParser";

/**
 * Minimal type defs for VS Code's built-in Git extension API.
 * We access it dynamically at runtime via vscode.extensions.getExtension("vscode.git").
 */
interface GitExtensionAPI {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  onDidChangeState: vscode.Event<void>;
  log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
}

interface GitRepositoryState {
  HEAD: GitBranchRef | undefined;
  remotes: GitRemote[];
  onDidChange: vscode.Event<void>;
}

interface GitBranchRef {
  name?: string;
  commit?: string;
  upstream?: { name: string; remote: string };
}

interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface GitCommit {
  hash: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  authorDate?: Date;
}

export interface GitStateSnapshot {
  branch: string;
  repoName: string;
  repoRemoteUrl: string;
  headCommit: string;
  detectedTickets: TicketInfo[];
}

/**
 * Service that watches git state and emits events for branch switches, commits, etc.
 */
export class GitService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private gitApi: GitAPI | undefined;
  private currentBranch: string = "";
  private lastKnownCommit: string = "";
  private ticketParser: TicketParser;

  private branchChangeEmitter = new vscode.EventEmitter<{
    previous: string;
    current: string;
    tickets: TicketInfo[];
  }>();
  public readonly onBranchChange = this.branchChangeEmitter.event;

  private commitEmitter = new vscode.EventEmitter<GitOperationMetadata>();
  public readonly onCommit = this.commitEmitter.event;

  constructor(ticketParser: TicketParser) {
    this.ticketParser = ticketParser;
  }

  async initialize(): Promise<void> {
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtensionAPI>("vscode.git");
      if (!gitExtension) {
        console.warn("[KDK DevInsights] Git extension not found. Git tracking disabled.");
        return;
      }

      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      this.gitApi = gitExtension.exports.getAPI(1);

      // Watch existing repos
      for (const repo of this.gitApi.repositories) {
        this.watchRepository(repo);
      }

      // Watch for new repos opening
      this.disposables.push(
        this.gitApi.onDidOpenRepository((repo) => this.watchRepository(repo))
      );

      // Capture initial state
      const state = this.getState();
      if (state) {
        this.currentBranch = state.branch;
        this.lastKnownCommit = state.headCommit;
      }
    } catch (err) {
      console.error("[KDK DevInsights] Failed to initialize git service:", err);
    }
  }

  private watchRepository(repo: GitRepository): void {
    const stateChangeDisposable = repo.state.onDidChange(() => {
      this.handleStateChange(repo);
    });
    this.disposables.push(stateChangeDisposable);
  }

  private async handleStateChange(repo: GitRepository): Promise<void> {
    const head = repo.state.HEAD;
    if (!head) {
      return;
    }

    const newBranch = head.name || "detached";
    const newCommit = head.commit || "";

    // Detect branch switch
    if (newBranch !== this.currentBranch && this.currentBranch !== "") {
      const tickets = this.ticketParser.extractTickets(newBranch, "branch");
      this.branchChangeEmitter.fire({
        previous: this.currentBranch,
        current: newBranch,
        tickets,
      });
    }

    // Detect new commit
    if (newCommit !== this.lastKnownCommit && this.lastKnownCommit !== "") {
      try {
        const recentLogs = await repo.log({ maxEntries: 1 });
        if (recentLogs.length > 0) {
          const latest = recentLogs[0];
          const repoName = this.extractRepoName(repo);
          const remoteUrl = this.extractRemoteUrl(repo);

          this.commitEmitter.fire({
            operation: "commit",
            branch: newBranch,
            commitHash: latest.hash,
            commitMessage: latest.message,
            repoName,
            repoRemoteUrl: remoteUrl,
          });
        }
      } catch (err) {
        // Log access might fail on some setups; swallow gracefully
        console.warn("[KDK DevInsights] Could not read git log:", err);
      }
    }

    this.currentBranch = newBranch;
    this.lastKnownCommit = newCommit;
  }

  /**
   * Get the current git state snapshot.
   */
  getState(): GitStateSnapshot | null {
    if (!this.gitApi || this.gitApi.repositories.length === 0) {
      return null;
    }

    const repo = this.gitApi.repositories[0];
    const head = repo.state.HEAD;
    const branch = head?.name || "detached";
    const headCommit = head?.commit || "";
    const repoName = this.extractRepoName(repo);
    const remoteUrl = this.extractRemoteUrl(repo);
    const detectedTickets = this.ticketParser.extractTickets(branch, "branch");

    return {
      branch,
      repoName,
      repoRemoteUrl: remoteUrl,
      headCommit,
      detectedTickets,
    };
  }

  getCurrentBranch(): string {
    return this.currentBranch || this.getState()?.branch || "unknown";
  }

  getCurrentRepo(): string {
    return this.getState()?.repoName || "unknown";
  }

  private extractRepoName(repo: GitRepository): string {
    const remoteFetch = repo.state.remotes.find((r) => r.name === "origin")?.fetchUrl;
    if (remoteFetch) {
      const match = remoteFetch.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return match[1];
      }
    }
    return repo.rootUri.path.split("/").pop() || "unknown";
  }

  private extractRemoteUrl(repo: GitRepository): string {
    return repo.state.remotes.find((r) => r.name === "origin")?.fetchUrl || "";
  }

  dispose(): void {
    this.branchChangeEmitter.dispose();
    this.commitEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
