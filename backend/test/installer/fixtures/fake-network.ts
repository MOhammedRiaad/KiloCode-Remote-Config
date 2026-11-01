// Test-only Node preload (--import) that replaces globalThis.fetch with a deterministic fake.
// Never imported at runtime by product code. Without a scenario or matching answer, denies all calls.
import { appendFileSync, readFileSync } from "node:fs";

export type FakeStaticAnswer =
  | { status: number; content: string; headers?: Record<string, string> }
  | { status: number; body?: string; headers?: Record<string, string> };

export type FakeAnswer =
  | FakeStaticAnswer
  | { mode: "hang" }
  | { mode: "throw"; message?: string }
  | { mode: "auth"; authorization: string; answer: FakeStaticAnswer };

export interface FakeScenario {
  azdo?: FakeAnswer;
  bifrost?: FakeAnswer;
  azdoProbe?: FakeAnswer;
  bifrostProbe?: FakeAnswer;
}

interface ScenarioFile extends FakeScenario {
  log?: string;
}

const scenarioPath = process.env["KILO_TEST_FAKE_NET"] ?? "";
const scenario: ScenarioFile | undefined =
  scenarioPath !== "" ? (JSON.parse(readFileSync(scenarioPath, "utf8")) as ScenarioFile) : undefined;
const logPath = scenario?.log ?? "";

function appendLog(entry: Record<string, unknown>): void {
  if (logPath !== "") appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

appendLog({ event: "loaded" });

function toAbortError(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function waitForAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal));
      return;
    }
    signal?.addEventListener("abort", () => reject(toAbortError(signal)), { once: true });
  });
}

function renderStatic(answer: FakeStaticAnswer): Response {
  if ("content" in answer && typeof answer.content === "string") {
    return new Response(JSON.stringify({ content: answer.content }), {
      status: answer.status,
      headers: { "content-type": "application/json", ...(answer.headers ?? {}) },
    });
  }
  const body = "body" in answer ? answer.body : undefined;
  const nullBody = body === undefined && (answer.status === 204 || answer.status === 205 || answer.status === 304);
  return new Response(nullBody ? null : (body ?? ""), {
    status: answer.status,
    headers: answer.headers,
  });
}

function isOriginRequest(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
}

const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const mergedHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const headers: Record<string, string> = {};
  mergedHeaders.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");

  appendLog({ event: "request", url, method, headers, redirect });

  const isAzdo = url.startsWith("https://dev.azure.com/");
  const probeAnswer = isOriginRequest(url) ? (isAzdo ? scenario?.azdoProbe : scenario?.bifrostProbe) : undefined;
  const answer = probeAnswer ?? (isAzdo ? scenario?.azdo : scenario?.bifrost);
  if (answer === undefined) {
    throw new Error("fake-network: request denied");
  }
  if ("mode" in answer) {
    if (answer.mode === "throw") {
      throw new Error(answer.message ?? "fake-network: forced failure");
    }
    if (answer.mode === "auth") {
      if (headers["authorization"] === answer.authorization) return renderStatic(answer.answer);
      return new Response('{"error":"unauthorized"}', {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return waitForAbort(signal);
  }
  return renderStatic(answer);
};

globalThis.fetch = fakeFetch as typeof globalThis.fetch;
