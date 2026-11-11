/**
 * The only logger. It records a scope and an error *kind*, never messages or request data:
 * database and library errors can echo input values (plates, contacts). See security checklist.
 */
export function logError(scope: string, err: unknown): void {
  const e = err as {
    name?: string;
    code?: string | number;
    status?: number;
    message?: string;
  } | null;
  const kind = [e?.name ?? typeof err, e?.code, e?.status].filter(Boolean).join(':');
  // ConfigError messages contain only environment variable names (see lib/env/server.ts).
  const detail = e?.name === 'ConfigError' && e.message ? ` ${e.message}` : '';
  console.error(`[${scope}] ${kind}${detail}`);
}
