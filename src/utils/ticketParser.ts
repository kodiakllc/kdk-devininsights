import { TicketInfo, DevInsightsConfig } from "../types";

/**
 * Extracts ticket/story identifiers from branch names, commit messages,
 * and PR titles using configurable regex patterns.
 */
export class TicketParser {
  private patterns: RegExp[];
  private provider: DevInsightsConfig["ticketProvider"];
  private baseUrl: string;

  constructor(config: DevInsightsConfig) {
    this.patterns = config.ticketPatterns.map((p) => new RegExp(p, "gi"));
    this.provider = config.ticketProvider;
    this.baseUrl = config.ticketProviderBaseUrl.replace(/\/+$/, "");
  }

  updateConfig(config: DevInsightsConfig): void {
    this.patterns = config.ticketPatterns.map((p) => new RegExp(p, "gi"));
    this.provider = config.ticketProvider;
    this.baseUrl = config.ticketProviderBaseUrl.replace(/\/+$/, "");
  }

  /**
   * Parse a string (branch name, commit message, etc.) and extract all ticket IDs.
   */
  extractTickets(input: string, detectedFrom: TicketInfo["detectedFrom"]): TicketInfo[] {
    const found = new Set<string>();
    const tickets: TicketInfo[] = [];

    for (const pattern of this.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(input)) !== null) {
        const ticketId = match[1] || match[0];
        const normalized = ticketId.toUpperCase().trim();

        if (!found.has(normalized)) {
          found.add(normalized);
          tickets.push({
            id: normalized,
            provider: this.provider,
            url: this.buildTicketUrl(normalized),
            detectedFrom,
          });
        }
      }
    }

    return tickets;
  }

  /**
   * Extract the first (primary) ticket from a branch name.
   */
  extractPrimaryTicket(branchName: string): TicketInfo | null {
    const tickets = this.extractTickets(branchName, "branch");
    return tickets.length > 0 ? tickets[0] : null;
  }

  /**
   * Build a URL for the ticket based on the configured provider.
   */
  private buildTicketUrl(ticketId: string): string | undefined {
    if (!this.baseUrl) {
      return undefined;
    }

    switch (this.provider) {
      case "jira":
        return `${this.baseUrl}/browse/${ticketId}`;
      case "azure-devops":
        return `${this.baseUrl}/_workitems/edit/${ticketId.replace(/\D/g, "")}`;
      case "github-issues":
        return `${this.baseUrl}/issues/${ticketId.replace(/\D/g, "")}`;
      case "rally":
        return `${this.baseUrl}/detail/userstory/${ticketId}`;
      case "custom":
        return `${this.baseUrl}/${ticketId}`;
      default:
        return undefined;
    }
  }

  /**
   * Infer ticket type from the branch name prefix convention.
   * e.g., feature/PROJ-123 -> "feature", bugfix/PROJ-456 -> "bug"
   */
  static inferTicketType(branchName: string): TicketInfo["type"] {
    const lower = branchName.toLowerCase();
    if (lower.startsWith("feature/") || lower.startsWith("feat/")) {
      return "feature";
    }
    if (lower.startsWith("bugfix/") || lower.startsWith("fix/") || lower.startsWith("hotfix/")) {
      return "bug";
    }
    if (lower.startsWith("story/") || lower.startsWith("us/")) {
      return "story";
    }
    if (lower.startsWith("task/") || lower.startsWith("chore/")) {
      return "task";
    }
    if (lower.startsWith("epic/")) {
      return "epic";
    }
    return "other";
  }
}
