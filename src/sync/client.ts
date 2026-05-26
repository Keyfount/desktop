/**
 * Thin typed HTTP client for the Keyfount sync server (see
 * server/src/routes). Every method returns either a success payload or
 * throws a `SyncApiError` with the HTTP status + parsed body.
 *
 * The client knows nothing about OPAQUE or AES — it just shuttles
 * already-serialized bytes (encoded as `number[]`) on behalf of higher
 * layers.
 *
 * All requests go through `api.syncHttp` (Tauri IPC → Rust `ureq`)
 * rather than the WebKit `fetch`. The webview's origin is
 * `tauri://localhost`, which is cross-origin to any sync server URL,
 * so `fetch` triggers a CORS preflight. Self-hosted Keyfount servers
 * don't enable CORS unless `CORS_ORIGINS` is set, and the OPTIONS
 * response 404s, blocking the real request with "Load failed". Going
 * through Rust skips the preflight contract entirely.
 */

import { api } from "../api.js";

export class SyncApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `sync API error (HTTP ${status})`);
  }
}

export interface RegisterStartResponse {
  response: number[];
}
export interface RegisterFinishResponse {
  userId: string;
  deviceId: string;
  /** Always "pending" since the admin-approval workflow landed. The
   * caller polls /auth/approval-status/:userId to get a session. */
  approvalStatus: "pending";
}
export interface ApprovalStatusResponse {
  status: "pending" | "approved" | "rejected";
  sessionToken?: string;
  expiresAt?: number;
  reason?: string;
}
export interface LoginStartResponse {
  ke2: number[];
  challengeToken: string;
  kdfParams: string;
}
export interface LoginFinishResponse {
  userId: string;
  deviceId: string;
  sessionToken: string;
  expiresAt: number;
}
export interface EventDto {
  serverSeq: number;
  deviceId: string;
  lamport: number;
  ciphertext: number[];
  nonce: number[];
  signature: number[] | null;
  createdAt: number;
}
export interface EventListResponse {
  events: EventDto[];
  nextCursor: number;
  hasMore: boolean;
}
export interface AppendEventResponse {
  serverSeq: number;
  acceptedAt: number;
}
export interface LatestSnapshotResponse {
  id: string;
  upToSeq: number;
  ciphertext: number[];
  nonce: number[];
  signature: number[] | null;
  createdAt: number;
}
export interface PutSnapshotResponse {
  snapshotId: string;
  compactedEvents: number;
}
export interface DevicesResponse {
  devices: {
    id: string;
    label: string | null;
    createdAt: number;
    lastSeenAt: number;
    current: boolean;
  }[];
}

/**
 * Low-level transport used by `SyncClient`. The default routes through
 * the Tauri Rust backend; tests can inject a `fetch`-compatible stub by
 * wrapping it with the helper at the bottom of this file.
 */
export interface SyncTransport {
  request(input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string }>;
}

const tauriTransport: SyncTransport = {
  async request({ method, url, headers, body }) {
    const args: { method: string; url: string; headers?: Record<string, string>; body?: string } = {
      method,
      url,
      headers,
    };
    if (body !== undefined) args.body = body;
    return api.syncHttp(args);
  },
};

/** Adapter so the existing `fetch`-based test stubs still plug in. */
export function fetchTransport(fetchImpl: typeof fetch): SyncTransport {
  return {
    async request({ method, url, headers, body }) {
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      const res = await fetchImpl(url, init);
      const text = await res.text();
      return { status: res.status, body: text };
    },
  };
}

export interface SyncClientOpts {
  /** Server base URL, no trailing slash. */
  baseUrl: string;
  /** Optional bearer token for authenticated calls. */
  sessionToken?: string;
  /** Override the transport (tests). */
  transport?: SyncTransport;
}

export class SyncClient {
  private readonly baseUrl: string;
  private readonly transport: SyncTransport;
  private sessionToken: string | undefined;

  constructor(opts: SyncClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.transport = opts.transport ?? tauriTransport;
    this.sessionToken = opts.sessionToken;
  }

  setSessionToken(token: string | undefined): void {
    this.sessionToken = token;
  }

  // --- unauthenticated --------------------------------------------------

  async health(): Promise<{ status: string }> {
    return this.req("GET", "/health");
  }
  registerStart(body: { email: string; request: number[] }): Promise<RegisterStartResponse> {
    return this.req("POST", "/auth/opaque/register/start", body);
  }
  registerFinish(body: {
    email: string;
    record: number[];
    kdfParams: string;
    devicePubkey: number[];
    deviceLabel?: string;
  }): Promise<RegisterFinishResponse> {
    return this.req("POST", "/auth/opaque/register/finish", body);
  }
  loginStart(body: { email: string; ke1: number[] }): Promise<LoginStartResponse> {
    return this.req("POST", "/auth/opaque/login/start", body);
  }
  loginFinish(body: {
    challengeToken: string;
    ke3: number[];
    devicePubkey: number[];
    deviceLabel?: string;
  }): Promise<LoginFinishResponse> {
    return this.req("POST", "/auth/opaque/login/finish", body);
  }
  approvalStatus(userId: string): Promise<ApprovalStatusResponse> {
    return this.req("GET", `/auth/approval-status/${encodeURIComponent(userId)}`);
  }

  // --- authenticated ----------------------------------------------------

  logout(): Promise<{ ok: boolean }> {
    return this.req("POST", "/auth/logout", undefined, true);
  }
  deleteAccount(): Promise<{ ok: boolean }> {
    return this.req("DELETE", "/account", undefined, true);
  }
  listDevices(): Promise<DevicesResponse> {
    return this.req("GET", "/devices", undefined, true);
  }
  revokeDevice(id: string): Promise<{ ok: boolean }> {
    return this.req("DELETE", `/devices/${encodeURIComponent(id)}`, undefined, true);
  }
  pullEvents(since: number, limit = 100): Promise<EventListResponse> {
    return this.req("GET", `/events?since=${since}&limit=${limit}`, undefined, true);
  }
  pushEvent(body: {
    lamport: number;
    ciphertext: number[];
    nonce: number[];
    signature?: number[];
  }): Promise<AppendEventResponse> {
    return this.req("POST", "/events", body, true);
  }
  latestSnapshot(): Promise<LatestSnapshotResponse | null> {
    return this.req("GET", "/snapshots/latest", undefined, true);
  }
  putSnapshot(body: {
    upToSeq: number;
    ciphertext: number[];
    nonce: number[];
    signature?: number[];
  }): Promise<PutSnapshotResponse> {
    return this.req("POST", "/snapshots", body, true);
  }

  // --- private ----------------------------------------------------------

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    needsAuth = false,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (needsAuth) {
      if (!this.sessionToken) {
        throw new SyncApiError(401, { error: "no_session" }, "no session token");
      }
      headers["Authorization"] = `Bearer ${this.sessionToken}`;
    }
    const input: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: string;
    } = { method, url: `${this.baseUrl}${path}`, headers };
    if (body !== undefined) input.body = JSON.stringify(body);

    const res = await this.transport.request(input);
    if (res.status === 204) return null as T;

    let parsed: unknown = res.body;
    if (res.body.length > 0) {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        // keep as text
      }
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SyncApiError(res.status, parsed);
    }
    return parsed as T;
  }
}
