export type RequestPayload = {
  id: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  duration: number;
  timestamp: number;
  streaming: boolean;
};

export type SessionMeta = {
  id: string;
  name: string;
  tabUrl: string;
  state: "recording" | "paused" | "completed";
  startedAt: number;
  endedAt: number | null;
  requestCount: number;
};

export type SnapshotMap = Record<string, {
  status: number;
  headers: Record<string, string>;
  body: string;
}>;

export type ATMFile = {
  version: "1.0";
  exportedAt: number;
  session: SessionMeta;
  requests: RequestPayload[];
};
