import React from "react";

/**
 * A compatibility page renders the original DSH settings cards against whatever
 * the local profile actually mounts. One card can therefore be missing its
 * settings namespace, its bundle, or the remote method it expects while every
 * other card still works.
 *
 * An uncaught exception used to reach `window`'s `error` handler, which reported
 * the whole page as failed and made the shell close it. These boundaries keep a
 * failure local: the affected region says it is unavailable and the rest of the
 * page stays mounted. Each failure is also kept on
 * `window.__nativeDSHPageError` (and `__nativeDSHCompatFailures`) so the QA
 * probe can read the real message and stack without a console hook.
 */

/** Where a failure happened: a whole page, one card region, or outside React. */
export type CompatFailureScope = "page" | "card" | "window";

/** One recorded failure, shaped for the shell's diagnostic probe. */
export interface CompatFailure {
  scope: CompatFailureScope;
  label?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  filename?: string;
  line?: number;
  column?: number;
  at: string;
}

declare global {
  interface Window {
    __nativeDSHPageError?: unknown;
    __nativeDSHCompatFailures?: CompatFailure[];
  }
}

const limit = 6000;
const clip = (value: string): string =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

/** The message of anything that was thrown, including non-`Error` values. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

/** How long this document has been running, for an otherwise anonymous error. */
function elapsed(): string {
  try {
    return `${Math.round(performance.now())}ms`;
  } catch {
    return "unknown";
  }
}

function failureText(failure: CompatFailure): string {
  return [
    `${failure.scope}${failure.label ? ` ${failure.label}` : ""}: ${failure.message}`,
    failure.filename
      ? `at ${failure.filename}:${failure.line ?? 0}:${failure.column ?? 0}`
      : "",
    failure.stack ? `stack:\n${failure.stack}` : "",
    failure.componentStack ? `component:\n${failure.componentStack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Record one failure for the page, the probe, and a developer's console.
 *
 * `window.__nativeDSHPageError` carries every failure recorded so far as one
 * `stack` string, which is the shape `NATIVE_DSH_COMPAT_PROBE` reads. It is a
 * plain assignment: the page must stay usable, so nothing here may throw.
 */
export function recordFailure(failure: CompatFailure): void {
  const failures = (window.__nativeDSHCompatFailures ??= []);
  failures.push(failure);
  // Every recorded failure, not just the newest: an opaque window error that
  // arrives later must not hide the card failure that explains the page.
  window.__nativeDSHPageError = {
    stack: clip(failures.map(failureText).join("\n---\n")),
  };
  // The shell has no console hook; this line is the only record an operator sees.
  console.error("[compat]", failureText(failure));
}

/**
 * Record a `window` `error`/`unhandledrejection` that happened outside React.
 *
 * This document's custom-scheme origin makes an error thrown by an injected
 * script arrive as the opaque `Script error.` with no file, no line, and no
 * stack. It is recorded, not fatal: an error this page cannot even name is not
 * evidence that the page cannot work.
 */
export function recordWindowFailure(
  kind: "error" | "unhandledrejection",
  event: any,
): void {
  const error = kind === "error" ? event?.error : event?.reason;
  recordFailure({
    scope: "window",
    label: `${kind} ${document.readyState} at ${elapsed()}`,
    message: describe(error ?? event?.message ?? event),
    stack: error instanceof Error ? error.stack : undefined,
    filename: event?.filename || undefined,
    line: event?.lineno || undefined,
    column: event?.colno || undefined,
    at: new Date().toISOString(),
  });
}

interface BoundaryProps {
  scope: CompatFailureScope;
  /** Names the card/region in the record and in the fallback's tooltip. */
  label?: string;
  /** Wording of the fallback line; card regions say the setting is unavailable. */
  message?: string;
  children?: React.ReactNode;
}

interface BoundaryState {
  failure: { message: string } | null;
}

/**
 * React error boundary for one region of a compatibility page.
 *
 * `getDerivedStateFromError` renders the fallback and `componentDidCatch`
 * records the real `Error` object, which is the only place a render failure's
 * message and stack survive: the same failure reaching `window` arrives masked.
 */
export class CompatBoundary extends React.Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failure: { message: describe(error) } };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    recordFailure({
      scope: this.props.scope,
      label: this.props.label,
      message: describe(error),
      stack: error instanceof Error ? error.stack : undefined,
      componentStack: info?.componentStack ?? undefined,
      at: new Date().toISOString(),
    });
  }

  render(): React.ReactNode {
    const failure = this.state.failure;
    if (!failure) return this.props.children;
    const text =
      this.props.message ??
      (this.props.scope === "page"
        ? "此兼容页面在本机无法显示。"
        : "该设置项在本机不可用");
    return (
      <p
        role="note"
        className={this.props.scope === "page" ? "notice" : "compat-boundary"}
        data-compat-boundary={this.props.scope}
        data-compat-label={this.props.label}
        title={failure.message}
      >
        {text}
      </p>
    );
  }
}
