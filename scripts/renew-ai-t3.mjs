// Run alongside connect-ai-t3.mjs on the T3 host. Never log credentials.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scopes = ["orchestration:operate", "orchestration:read"];
const renewalWindowMs = 7 * 86_400_000;

async function session(base, token) {
  const response = await fetch(new URL("/api/auth/session", base), {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("T3 session verification is unavailable.");
  const state = await response.json();
  if (!state.authenticated) return null;
  const expiresAt = Date.parse(state.expiresAt);
  if (!Number.isFinite(expiresAt) || JSON.stringify([...(state.scopes ?? [])].sort()) !== JSON.stringify(scopes)) {
    throw new Error("Unexpected T3 backend session permissions or expiry.");
  }
  return { expiresAt };
}

export async function renewIfNeeded({ base, tokenFile, setup, now = Date.now(), force = false }) {
  let previous;
  try { previous = await readFile(tokenFile, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read the T3 backend credential file."); }
  const current = previous?.trim() ? await session(base, previous.trim()) : null;
  if (!force && current && current.expiresAt - now > renewalWindowMs) return { renewed: false, ...current };
  try {
    await setup();
    const token = (await readFile(tokenFile, "utf8")).trim();
    const fresh = token && await session(base, token);
    if (!fresh || fresh.expiresAt - now <= renewalWindowMs || token === previous?.trim()) {
      throw new Error("The renewed T3 backend credential failed verification.");
    }
    return { renewed: true, ...fresh };
  } catch {
    // Keep the bind-mounted inode and restore the still-valid credential if setup fails.
    if (previous !== undefined) await writeFile(tokenFile, previous, { mode: 0o600 });
    throw new Error("T3 backend renewal failed; the previous credential was preserved. Retry required.");
  }
}

async function main() {
  const base = new URL(process.env.T3_BASE_URL || "http://127.0.0.1:3773");
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Invalid T3 origin.");
  }
  const home = resolve(process.env.AI_CODEX_ANALYSIS_HOME || join(homedir(), ".codex-weightings-analysis"));
  const tokenFile = resolve(process.env.T3_AUTH_TOKEN_FILE || join(home, "t3-backend-token"));
  const result = await renewIfNeeded({ base, tokenFile, force: process.argv.includes("--force"), setup: async () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./connect-ai-t3.mjs", import.meta.url))], {
      encoding: "utf8", timeout: 90_000, maxBuffer: 1_000_000,
    });
    // Capture subprocess output to prevent errors from leaking credentials to the journal.
    if (run.status !== 0) throw new Error("T3 setup failed.");
  } });
  console.log(`T3 backend credential: ${result.renewed ? "RENEWED" : "OK"}; expires ${new Date(result.expiresAt).toISOString()}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("T3 backend renewal failed. Check T3 availability and the private credential file; retry required."); process.exitCode = 1; });
}
