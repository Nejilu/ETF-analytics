export interface MetricsOverviewDiagnosticsOptions {
  enabled?: boolean;
  now?: () => number;
  logger?: (message: string) => void;
}

export interface MetricsOverviewDiagnostics {
  readonly enabled: boolean;
  mark(phase: string): void;
  addContext(values: Record<string, unknown>): void;
  emit(values?: Record<string, unknown>): void;
}

interface PhaseTiming {
  phase: string;
  durationMs: number;
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

export function createMetricsOverviewDiagnostics(
  options: MetricsOverviewDiagnosticsOptions = {},
): MetricsOverviewDiagnostics {
  const enabled = options.enabled ?? process.env.METRICS_DIAGNOSTICS === "1";
  const now = options.now ?? (() => performance.now());
  const logger = options.logger ?? ((message: string) => console.info(message));

  if (!enabled) {
    return {
      enabled: false,
      mark: () => undefined,
      addContext: () => undefined,
      emit: () => undefined,
    };
  }

  const startedAt = now();
  let previousAt = startedAt;
  const phases: PhaseTiming[] = [];
  const context: Record<string, unknown> = {};

  return {
    enabled: true,
    mark(phase: string) {
      const current = now();
      phases.push({
        phase,
        durationMs: roundedMilliseconds(current - previousAt),
      });
      previousAt = current;
    },
    addContext(values: Record<string, unknown>) {
      Object.assign(context, values);
    },
    emit(values: Record<string, unknown> = {}) {
      logger(`[metrics-overview] ${JSON.stringify({
        ...context,
        ...values,
        totalMs: roundedMilliseconds(now() - startedAt),
        phases,
      })}`);
    },
  };
}
