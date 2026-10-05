// Run on the T3 host as the same OS user as T3. Secret values never go to stdout.
import { spawnSync } from "node:child_process";
import { mkdir, access, lstat, readlink, symlink, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.T3_BASE_URL || "http://127.0.0.1:3773");
const sourceHome = resolve(process.env.AI_CODEX_SOURCE_HOME || join(homedir(), ".codex"));
const analysisHome = resolve(process.env.AI_CODEX_ANALYSIS_HOME || join(homedir(), ".codex-weightings-analysis"));
const workspace = resolve(process.env.AI_WORKSPACE_ROOT || join(homedir(), "weightings-analysis"));
const tokenFile = resolve(process.env.T3_AUTH_TOKEN_FILE || join(analysisHome, "t3-backend-token"));
const instanceId = process.env.T3_PROVIDER_INSTANCE || "weightings-analysis";
const projectId = process.env.T3_PROJECT_ID || "weightings-analysis";
const checkMode = process.argv.includes("--check");
const ensureMode = process.argv.includes("--ensure");
if (sourceHome === analysisHome || !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Use a dedicated analysis home and a valid T3 origin.");
await access(join(sourceHome, "auth.json"));
if (!checkMode) {
  await mkdir(analysisHome, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
}
const authLink = join(analysisHome, "auth.json");
try {
  const stat = await lstat(authLink);
  if (!stat.isSymbolicLink() || resolve(analysisHome, await readlink(authLink)) !== join(sourceHome, "auth.json")) throw new Error("The analysis home already contains a different auth file. Choose another dedicated home.");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  if (!checkMode) await symlink(relative(analysisHome, join(sourceHome, "auth.json")), authLink, "file");
}
// This home inherits only the authenticated account, not its MCP credentials,
// plugins or administrative tools. T3 selects read-only mode on every turn.
if (!checkMode) await writeFile(join(analysisHome, "config.toml"), 'web_search = "live"\n', { mode: 0o600 });
const executable = process.env.T3_BINARY || (process.platform === "win32" ? "t3.cmd" : "t3");
const issue = spawnSync(executable, ["auth", "session", "issue", "--ttl", "5m", "--label", "Weightings setup", "--json", ...(process.env.T3CODE_HOME ? ["--base-dir", process.env.T3CODE_HOME] : [])], { encoding: "utf8", shell: process.platform === "win32" });
if (issue.status !== 0) throw new Error("Could not issue the temporary T3 setup session. Run this script as the T3 user with the correct T3CODE_HOME.");
const administrator = JSON.parse(issue.stdout);
async function http(path, token, body, form = false) {
  const response = await fetch(new URL(path, base), { method: body === undefined ? "GET" : "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" }) }, ...(body === undefined ? {} : { body: form ? new URLSearchParams(body) : JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`T3 setup request failed (${response.status}).`);
  return response.json();
}
async function rpc(tag, payload) {
  const { ticket } = await http("/api/auth/websocket-ticket", administrator.token, {});
  const url = new URL("/ws", base); url.protocol = base.protocol === "https:" ? "wss:" : "ws:"; url.searchParams.set("wsTicket", ticket);
  return new Promise((resolveResult, reject) => {
    const socket = new WebSocket(url); let done = false;
    const finish = (value, failed) => { if (done) return; done = true; clearTimeout(timer); socket.close(); if (failed) reject(new Error("T3 setup RPC failed.")); else resolveResult(value); };
    const timer = setTimeout(() => finish(null, true), 15_000);
    socket.onopen = () => socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }));
    socket.onmessage = (event) => { try { const values = JSON.parse(event.data); for (const frame of Array.isArray(values) ? values : [values]) { if (frame._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" })); if (frame._tag === "Exit" && frame.requestId === "1") finish(frame.exit.value, frame.exit._tag !== "Success"); } } catch { finish(null, true); } };
    socket.onerror = () => finish(null, true); socket.onclose = () => finish(null, true);
  });
}
try {
  const descriptor = await http("/.well-known/t3/environment", administrator.token);
  if (descriptor.orchestrationProtocolVersion !== 1) throw new Error("Unsupported T3 protocol version.");
  const config = await rpc("server.getConfig", {});
  const existing = config.settings.providerInstances[instanceId];
  if (existing && (existing.driver !== "codex" || resolve(existing.config?.homePath || "") !== analysisHome)) throw new Error("The provider instance ID is already used by another configuration. Choose another ID.");
  const shell = await http("/api/orchestration/shell", administrator.token);
  const project = shell.projects.find((p) => p.id === projectId);
  if (project && resolve(project.workspaceRoot) !== workspace) throw new Error("The project ID already refers to another workspace. Choose another ID.");
  const binary = process.env.AI_CODEX_BINARY || "codex";
  const needsUpdate = !existing || !existing.enabled || existing.config?.binaryPath !== binary || existing.config?.launchArgs !== '-c web_search="live"' || config.settings.projectAgentBrowserAccessOverrides?.[projectId] !== false || JSON.stringify(config.settings.projectScriptOverrides?.[projectId]) !== "[]";
  if (!checkMode && needsUpdate) await rpc("server.updateSettings", { patch: {
    providerInstances: { ...config.settings.providerInstances, [instanceId]: { driver: "codex", displayName: "Weightings analysis", enabled: true, config: { binaryPath: process.env.AI_CODEX_BINARY || "codex", homePath: analysisHome, launchArgs: '-c web_search="live"' } } },
    projectAgentBrowserAccessOverrides: { ...config.settings.projectAgentBrowserAccessOverrides, [projectId]: false },
    projectScriptOverrides: { ...config.settings.projectScriptOverrides, [projectId]: [] },
  } });
  if (!checkMode && !project) await http("/api/orchestration/dispatch", administrator.token, { type: "project.create", commandId: randomUUID(), projectId, title: "Weightings analysis", workspaceRoot: workspace, createdAt: new Date().toISOString() });
  if (!checkMode && (!ensureMode || needsUpdate || !project)) await rpc("server.refreshProviders", { instanceId, refreshModels: true });
  if (checkMode || ensureMode) console.log(`T3 analysis configuration: ${needsUpdate || !project ? "CHANGED" : "OK"}`);
  if (!checkMode && !ensureMode) {
  const pairing = await http("/api/auth/pairing-token", administrator.token, { label: "Weightings backend", scopes: ["orchestration:read", "orchestration:operate"] });
  const credential = await http("/oauth/token", administrator.token, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: pairing.credential,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap", requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: "orchestration:read orchestration:operate", client_label: "Weightings backend", client_device_type: "bot",
  }, true);
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, credential.access_token + "\n", { mode: 0o600 });
  await chmod(tokenFile, 0o600);
  console.log(`Analysis instance: ${instanceId}\nAnalysis project: ${projectId}\nBackend credential saved securely to: ${tokenFile}\nCredential lifetime: ${Math.round(credential.expires_in / 86400)} days\nConfigure T3_BASE_URL and T3_AUTH_TOKEN_FILE on the application host. No secret has been printed.`);
  }
} finally {
  const revoke = spawnSync(executable, ["auth", "session", "revoke", administrator.sessionId, ...(process.env.T3CODE_HOME ? ["--base-dir", process.env.T3CODE_HOME] : [])], { encoding: "utf8", shell: process.platform === "win32" });
  if (revoke.status !== 0) console.error("The temporary setup session could not be revoked; it expires within five minutes.");
}
