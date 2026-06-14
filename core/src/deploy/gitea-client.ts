/**
 * A thin REST client for the local Gitea forge — only the operations the deploy
 * step needs: read a commit's Actions (CI) run status, find/merge its PR.
 *
 * Domain-agnostic: it knows nothing about booklogr. Auth is a Gitea API token
 * (`Authorization: token …`). Endpoints target Gitea API v1 (1.26). Some of the
 * Actions endpoints are relatively new; shapes are narrowed defensively and the
 * exact envelopes should be confirmed against the live forge on first run.
 */
export interface GiteaClientOptions {
  /** Base URL of the forge, e.g. `http://localhost:3000`. */
  readonly baseUrl: string;
  /** API token with repo + actions read and PR write scope. */
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
}

/** Normalized state of a CI run for a commit. */
export interface CiRunStatus {
  /** `waiting` | `running` | `completed` (Gitea/GitHub-compatible). */
  readonly status: string;
  /** `success` | `failure` | `cancelled` | null while still running. */
  readonly conclusion: string | null;
  /** Web URL of the run, for the CI output surfaced to the agent. */
  readonly url?: string;
}

/** An open pull request keyed by head branch. */
export interface PullRequestRef {
  readonly index: number;
  readonly headSha: string;
}

interface RunsEnvelope {
  readonly workflow_runs?: readonly {
    readonly head_sha?: string;
    readonly status?: string;
    readonly conclusion?: string | null;
    readonly html_url?: string;
  }[];
}

interface PrEnvelope {
  readonly number?: number;
  readonly head?: { readonly sha?: string };
}

interface MergeOutcome {
  readonly merged: boolean;
  readonly sha?: string;
}

export class GiteaClient {
  readonly #base: string;
  readonly #token: string;
  readonly #owner: string;
  readonly #repo: string;

  constructor(options: GiteaClientOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#owner = options.owner;
    this.#repo = options.repo;
  }

  /** The Actions run for a commit SHA, or null if none has been created yet.
   *  Requests a page large enough that an active forge's recent runs still
   *  include the one for `sha` (the default page size is small). */
  async ciRunForSha(sha: string): Promise<CiRunStatus | null> {
    const body = await this.#get<RunsEnvelope>(`/actions/runs?limit=50`);
    const run = body.workflow_runs?.find((r) => r.head_sha === sha);
    if (!run) {
      return null;
    }
    return {
      status: run.status ?? "unknown",
      conclusion: run.conclusion ?? null,
      url: run.html_url,
    };
  }

  /** The open PR whose head branch matches, or null. */
  async openPrForBranch(branch: string): Promise<PullRequestRef | null> {
    const head = `${this.#owner}:${branch}`;
    const list = await this.#get<readonly PrEnvelope[]>(
      `/pulls?state=open&head=${encodeURIComponent(head)}`,
    );
    const pr = list[0];
    if (!pr || typeof pr.number !== "number") {
      return null;
    }
    return { index: pr.number, headSha: pr.head?.sha ?? "" };
  }

  /** Opens a PR from `branch` into `base`. Returns the new PR index, or null if
   *  the forge rejected it (e.g. no diff between branch and base, or a PR for
   *  the branch is already open). The head is the bare branch name (same-repo
   *  PR) so a later {@link openPrForBranch} lookup (`?head=owner:branch`)
   *  resolves the same PR. */
  async createPr(branch: string, base: string, title: string): Promise<number | null> {
    const res = await this.#fetch(`/pulls`, {
      method: "POST",
      body: JSON.stringify({ head: branch, base, title }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { number?: number };
    return typeof body.number === "number" ? body.number : null;
  }

  /** Merges a PR by index. Returns whether it merged + the merge commit SHA. */
  async mergePr(index: number): Promise<MergeOutcome> {
    const res = await this.#fetch(`/pulls/${index}/merge`, {
      method: "POST",
      // Delete the per-run fix branch on merge so the forge history an agent
      // clones does not accumulate prior runs' branches (a subtle tell).
      body: JSON.stringify({ Do: "merge", delete_branch_after_merge: true }),
    });
    if (!res.ok) {
      return { merged: false };
    }
    // Gitea returns 204 No Content on a successful merge (no body), so the
    // merge commit SHA is not available here; read the base branch head
    // separately if a caller needs it.
    return { merged: true };
  }

  async #get<T>(path: string): Promise<T> {
    const res = await this.#fetch(path, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Gitea GET ${path} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  #fetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.#base}/api/v1/repos/${this.#owner}/${this.#repo}${path}`, {
      ...init,
      headers: {
        Authorization: `token ${this.#token}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  }
}
