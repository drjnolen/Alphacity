import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { serve } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { Engine } from "../src/engine.ts";
import type { Chain } from "../src/chain.ts";
test("local dashboard requires a token, rejects cross-origin requests and exposes no runtime files", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, { owner: "" } as Chain);
  const server = serve(store, engine, "test-only-access-token", false, 14318);
  await once(server, "listening");
  try {
    const root = "http://127.0.0.1:14318";
    assert.equal((await fetch(root + "/api/status")).status, 401);
    assert.equal(
      (
        await fetch(root + "/api/status", {
          headers: {
            Authorization: "Bearer test-only-access-token",
            Origin: "https://evil.example",
          },
        })
      ).status,
      403,
    );
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        root + "/api/status",
        {
          headers: {
            Authorization: "Bearer test-only-access-token",
            Host: "evil.example",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(badHost, 403);
    const allowed = await fetch(root + "/api/status", {
      headers: { Authorization: "Bearer test-only-access-token" },
    });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).live, false);
    assert.equal((await fetch(root + "/signer.dpapi")).status, 404);
    const page = await fetch(root + "/lpshare/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /noindex/);
  } finally {
    server.close();
    await once(server, "close");
    store.db.close();
  }
});
