import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { renewIfNeeded } from "./renew-ai-t3.mjs";

const day = 86_400_000;
async function fixture(t, days, newSession = true, outage = false, wrongScopes = false) {
  const directory = await mkdtemp(join(tmpdir(), "weightings-renew-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "old\n");
  const now = Date.now();
  let calls = 0;
  const server = createServer((req, res) => {
    if (outage) { res.writeHead(503).end(); return; }
    const fresh = req.headers.authorization === "Bearer new";
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ authenticated: fresh ? newSession : days > 0,
      expiresAt: new Date(now + (fresh ? 30 : days) * day).toISOString(),
      scopes: fresh && wrongScopes ? ["admin"] : ["orchestration:read", "orchestration:operate"] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true }); });
  return { tokenFile, now, base: new URL(`http://127.0.0.1:${server.address().port}`),
    setup: async () => { calls++; await writeFile(tokenFile, "new\n"); }, calls: () => calls };
}

test("valid credentials are verified without rotation", async t => {
  const f = await fixture(t, 30);
  assert.equal((await renewIfNeeded(f)).renewed, false);
  assert.equal(f.calls(), 0);
});
test("renewal before expiry preserves the bind-mounted inode", async t => {
  const f = await fixture(t, 7);
  const inode = (await stat(f.tokenFile)).ino;
  assert.equal((await renewIfNeeded(f)).renewed, true);
  assert.equal(f.calls(), 1);
  assert.equal((await stat(f.tokenFile)).ino, inode);
  assert.equal(await readFile(f.tokenFile, "utf8"), "new\n");
});
test("expired sessions recover without a browser login", async t => {
  const f = await fixture(t, -1);
  assert.equal((await renewIfNeeded(f)).renewed, true);
});
test("failed verification restores the old credential in place", async t => {
  const f = await fixture(t, 3, false);
  const inode = (await stat(f.tokenFile)).ino;
  await assert.rejects(renewIfNeeded(f), /previous credential was preserved/);
  assert.equal(await readFile(f.tokenFile, "utf8"), "old\n");
  assert.equal((await stat(f.tokenFile)).ino, inode);
});
test("an outage does not rotate a potentially valid credential", async t => {
  const f = await fixture(t, 3, true, true);
  await assert.rejects(renewIfNeeded(f), /verification is unavailable/);
  assert.equal(f.calls(), 0);
  assert.equal(await readFile(f.tokenFile, "utf8"), "old\n");
});
test("missing recovery credentials are recreated", async t => {
  const f = await fixture(t, 30);
  await rm(f.tokenFile);
  assert.equal((await renewIfNeeded(f)).renewed, true);
  assert.equal(await readFile(f.tokenFile, "utf8"), "new\n");
});
test("a setup error after writing still restores the previous credential", async t => {
  const f = await fixture(t, 3);
  f.setup = async () => { await writeFile(f.tokenFile, "partial\n"); throw new Error("failed"); };
  await assert.rejects(renewIfNeeded(f), /previous credential was preserved/);
  assert.equal(await readFile(f.tokenFile, "utf8"), "old\n");
});
test("renewal refuses broader permissions and restores the previous credential", async t => {
  const f = await fixture(t, 3, true, false, true);
  await assert.rejects(renewIfNeeded(f), /previous credential was preserved/);
  assert.equal(await readFile(f.tokenFile, "utf8"), "old\n");
});
