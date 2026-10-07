# AI analysis

The fifth workspace panel sends ETF or portfolio analysis to an existing T3
Code server, using its authenticated Codex account. There is no LLM API key or
visitor sign-in flow. Models and reasoning options come from T3's provider
catalog. Responses are displayed as Markdown with links, with follow-up
questions, interruption and the last 30 conversations available in the panel.

The Custom template requires your own question and adds no predefined analysis
prompt. The selected holdings snapshot and shared research instructions still
accompany the question.

## Access and branches

On `main`, AI APIs are restricted to loopback hosts and same-origin mutations.
Use the application on `localhost`; bind local development to loopback when
connecting an agent. The deployment branch replaces `requireAiAccess` with
the existing signed Cloudflare Access owner check and hides the panel from
visitors. Every AI endpoint, including history, interruption and live events,
passes this check. Stream requests revalidate access during polling.

## Connect T3

Use T3 0.0.45 (or a compatible protocol version 1 implementation) with a current
Codex CLI already signed in. Node.js 22.13+ is required for the setup script.
Run the script **on the T3 host as the T3 OS user**, with the correct
`T3CODE_HOME` when using a non-default T3 data directory:

```bash
node scripts/connect-ai-t3.mjs
```

`--ensure` reconciles the dedicated instance and project without issuing a new
backend credential. `--check` reports configuration drift without changing the
instance or project. Both preserve settings for other T3 projects and instances.

The script creates a dedicated Codex home and an empty research workspace. Its
`auth.json` is a symbolic link to the existing account's auth file; credentials
are not copied or printed. This preserves the original provider configuration
and avoids inheriting administrative MCP servers or plugins. Windows requires
permission to create a file symlink (for example Developer Mode).

The `weightings-analysis` T3 instance uses live built-in web search. Turns use
Codex's read-only sandbox and untrusted command approval policy. Elevated tool
requests are declined. Agent browser access and project startup scripts are
disabled for the dedicated project. The sandbox restricts shell writes; the
isolated Codex home also avoids external tools with write permissions.

The script writes a separate, scoped T3 bearer credential to a private file.
This authenticates the application's backend to T3; it is unrelated to ChatGPT
login. The temporary setup session is revoked. The backend credential expires;
the script reports its lifetime, and can be rerun to renew it. Revoke superseded
backend sessions in T3's access settings. Never commit credential files.

For unattended renewal, run `node scripts/renew-ai-t3.mjs` daily on the same
T3 host. It verifies the current session, renews only within seven days of expiry
or after expiration/revocation, and verifies the new credential and its scopes.
Failed renewal restores the previous file contents. Writes preserve the file
inode so a running application's bind mount sees the new token. Existing
sessions remain valid until their natural expiry, preserving in-flight analyses.
`--force` performs an immediate rotation for operational validation.
The VPS Ansible role installs and enables a persistent systemd timer; local
installations need their own scheduler. This does not renew a revoked Codex login.

| Environment variable | Default / purpose |
| --- | --- |
| `T3_BASE_URL` | Required in the app; T3 origin, e.g. `http://127.0.0.1:3773` locally or `http://agents-codex:3773` on the VPS private Docker network |
| `T3_AUTH_TOKEN_FILE` | Required in the app; absolute path to the protected backend credential file |
| `T3_PROVIDER_INSTANCE` | `weightings-analysis` |
| `T3_PROJECT_ID` | `weightings-analysis` |
| `AI_CODEX_SOURCE_HOME` | Setup only; `~/.codex`, containing the existing signed-in account |
| `AI_CODEX_ANALYSIS_HOME` | Setup only; `~/.codex-weightings-analysis` |
| `AI_WORKSPACE_ROOT` | Setup only; `~/weightings-analysis` |
| `AI_CODEX_BINARY` | Setup only; `codex`, use the current executable if PATH points to an older CLI |
| `T3_BINARY` | Setup only; `t3` (`t3.cmd` on Windows) |

Restart the application after configuring its environment. The panel shows
connection failures, expired sessions and incompatible protocol versions. The
connector does not change providers or accounts from a browser request.

## VPS integration

The existing application and `agents-codex` share `dokploy-network`; no new
container or public port is needed. Provision the dedicated instance on the
T3 host, and mount **only the backend bearer credential** read-only into the
application container. Do not mount the Codex home, Docker socket or host root
into the application. Set the app's token-file path to the mounted path and
use `http://agents-codex:3773` as its T3 origin.

Persistent VPS configuration must be recorded in the VPS workspace's Ansible
desired state and documentation, with secrets in Vault. Preparing the feature
on either Git branch does not publish it or configure production.

## Data and streaming

The first turn reads canonical application data on the server. Follow-ups reuse
the last snapshot sent in that conversation for less than 24 hours; they send
the question and research instructions without repeating the holdings JSON or
reading a new composition. After 24 hours, or when the owner uses **Send with
updated holdings**, the next follow-up includes a new snapshot. The deadline
starts at the last snapshot send, not at the latest question, and survives
application restarts. Older conversations without a recorded snapshot timestamp
refresh on their next follow-up. Failed sends do not reset the deadline.

Each snapshot includes full sector/country/asset-class aggregates, top-ten
concentration, signed exposure and cash. The position slider selects 0–200
holdings ranked by absolute weight; zero sends only the summary. Defaults are
20 for Custom, Global analysis and Portfolio coherence, 30 for Main positions,
and 10 for Diversification or Recent news. Each holding contains only ticker,
name and weight; percentages are rounded to at most two decimals after
aggregation. Omitted counts and gross weight remain explicit. Allocation
sleeves, also capped by the slider, accompany Custom, Global, Diversification
and Coherence templates; news and position research omit them. Prices and
internal security IDs are not repeated. Source dates, failures and coverage
remain available. Changing the limit sends a fresh snapshot even within
24 hours; the accepted limit survives restarts and failed dispatches. Older
conversations refresh once to adopt the compact format.
Quantities, account values and cash amounts are excluded. Cached app quotes
are not presented as real-time prices; the prompt requires web verification
and dated sources, and disclosure if live research fails.

T3 owns the full conversation. SQLite stores the analysis-to-thread mapping
and settings, allowing restart-safe access without accepting arbitrary T3
thread IDs from the browser. Each SSE response polls T3's authenticated thread
snapshot once per second, replaces cumulative text and reconnects after four
minutes; reconnecting or leaving the panel does not stop the agent. Only Stop
requests an interruption. Up to 12 recent turns are shown per conversation.
The connector is tied to T3's internal API and checks protocol version 1.
