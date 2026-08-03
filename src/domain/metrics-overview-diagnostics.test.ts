import assert from "node:assert/strict";
import test from "node:test";

import { createMetricsOverviewDiagnostics } from "./metrics-overview-diagnostics";

test("records sequential phase timings and context in one log entry", () => {
  let currentTime = 100;
  const logs: string[] = [];
  const diagnostics = createMetricsOverviewDiagnostics({
    enabled: true,
    now: () => currentTime,
    logger: (message) => logs.push(message),
  });

  currentTime = 110;
  diagnostics.mark("bootstrap");
  currentTime = 135;
  diagnostics.addContext({ securityCount: 42 });
  diagnostics.mark("holdings");
  currentTime = 160;
  diagnostics.emit({ sourceStatus: "partial" });

  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0].replace("[metrics-overview] ", "")), {
    securityCount: 42,
    sourceStatus: "partial",
    totalMs: 60,
    phases: [
      { phase: "bootstrap", durationMs: 10 },
      { phase: "holdings", durationMs: 25 },
    ],
  });
});

test("does not read the clock or log when disabled", () => {
  let clockReads = 0;
  const logs: string[] = [];
  const diagnostics = createMetricsOverviewDiagnostics({
    enabled: false,
    now: () => {
      clockReads += 1;
      return 0;
    },
    logger: (message) => logs.push(message),
  });

  diagnostics.mark("ignored");
  diagnostics.addContext({ ignored: true });
  diagnostics.emit();

  assert.equal(clockReads, 0);
  assert.deepEqual(logs, []);
});
