import test from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import {
  address,
  defaults,
  allocate,
  units,
  schedule,
  validateConfig,
  CITY,
  SUI,
} from "../src/domain.ts";
import { Store } from "../src/store.ts";
import { Engine } from "../src/engine.ts";
import type { Chain, Prepared, Receipt } from "../src/chain.ts";
import { checkDebits } from "../src/chain.ts";

const recipients = [
  { address: "0x1", label: "A", weightBps: 5000 },
  { address: "0x2", label: "B", weightBps: 5000 },
];
test("integer allocation conserves every base unit, including amounts beyond safe JS numbers", () => {
  for (const total of [1n, 3n, 100n, 9007199254740993999n]) {
    const { payouts } = allocate(total, recipients, 9);
    assert.equal(
      payouts.reduce((n, p) => n + BigInt(p.amount), 0n),
      total,
    );
    assert.ok(BigInt(payouts[0].amount) >= BigInt(payouts[1].amount));
  }
});
test("duplicate aliases, invalid weights, and excess decimals are rejected", () => {
  assert.throws(
    () =>
      allocate(
        10n,
        [recipients[0], { ...recipients[1], address: address("0x1") }],
        9,
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...defaults,
        recipients: [{ ...recipients[0], weightBps: 9999 }],
      }),
    /100%/,
  );
  assert.throws(() => units("1.0000000001", 9), /decimals/);
  assert.throws(() => address("0x0"), /Zero/);
});
test("fixed overrides reject shortfalls and account for retained CITY", () => {
  const r = [{ ...recipients[0], amount: "1.1" }];
  assert.throws(() => allocate(100n, r, 2, true), /exceed/);
  assert.deepEqual(allocate(200n, r, 2, true), {
    payouts: [{ address: address("0x1"), amount: "110" }],
    remainder: "90",
  });
});
test("spring DST gap does not permanently shift later scheduled wall times", () => {
  const c = {
    ...defaults,
    startLocal: "2026-02-22T02:30",
    timezone: "America/Denver",
  };
  const result = schedule(c, Temporal.Instant.from("2026-03-08T10:00Z"));
  assert.equal(result.due, "2026-03-08T09:30:00Z");
  assert.equal(result.next, "2026-03-22T08:30:00Z");
});
test("biweekly schedule preserves Denver wall time over DST and catches up only latest slot", () => {
  const c = {
    ...defaults,
    startLocal: "2026-10-25T09:00",
    timezone: "America/Denver",
  };
  assert.equal(
    schedule(c, Temporal.Instant.from("2026-11-08T17:00Z")).due,
    "2026-11-08T16:00:00Z",
  );
  assert.equal(
    schedule(c, Temporal.Instant.from("2026-11-08T17:00Z")).next,
    "2026-11-22T16:00:00Z",
  );
  assert.equal(
    schedule(c, Temporal.Instant.from("2026-10-24T00:00Z")).due,
    null,
  );
  assert.throws(() => validateConfig({ ...c, startLocal: "2026-11-01T01:30" }));
});
class FakeChain implements Chain {
  owner = address("0x99");
  prepared: string[] = [];
  broadcasts: string[] = [];
  receipts = new Map<string, Receipt>();
  failPayout = false;
  uncertain = false;
  async inspect(): Promise<any> {
    return { estimatedCity: "30", cityDecimals: 0, gasReady: true, quotes: [] };
  }
  async prepareClaim() {
    return this.prepare("claim");
  }
  async prepareSwap() {
    return this.prepare("swap");
  }
  async preparePayout() {
    if (this.failPayout) throw Error("gas unavailable");
    return this.prepare("payout");
  }
  prepare(step: string): Prepared {
    this.prepared.push(step);
    return { digest: step, bytes: "bytes", signature: "signature" };
  }
  async lookup(digest: string) {
    return this.receipts.get(digest) || null;
  }
  async broadcast(tx: Prepared) {
    this.broadcasts.push(tx.digest);
    const r: Receipt = {
      digest: tx.digest,
      changes:
        tx.digest === "claim"
          ? { [CITY]: "10", [SUI]: "8" }
          : tx.digest === "swap"
            ? { [CITY]: "20" }
            : { [CITY]: "-30" },
      gas: "2",
    };
    this.receipts.set(tx.digest, r);
    if (this.uncertain) {
      this.uncertain = false;
      throw Error("timeout after execution");
    }
    return r;
  }
}
function setup() {
  const store = new Store(":memory:");
  store.saveConfig({ ...defaults, recipients }, 1);
  const chain = new FakeChain();
  return { store, chain, engine: new Engine(store, chain, true) };
}
test("claim gas is excluded from earnings, and actual swap output determines payouts", async () => {
  const { store, engine } = setup();
  const run = await engine.execute();
  assert.equal(run.claimed[SUI], "10");
  assert.equal(run.city, "30");
  assert.deepEqual(
    run.payouts.map((p: any) => p.amount),
    ["15", "15"],
  );
  assert.equal(run.status, "complete");
  store.db.close();
});
test("network timeout after execution reconciles digest without rebuilding or paying twice", async () => {
  const { store, chain, engine } = setup();
  chain.uncertain = true;
  const run = await engine.execute();
  assert.equal(run.status, "complete");
  assert.equal(chain.prepared.filter((s) => s === "claim").length, 1);
  assert.equal(chain.broadcasts.filter((s) => s === "claim").length, 1);
  store.db.close();
});
test("resume preserves original config and never reclaims or reswaps after payout preparation fails", async () => {
  const { store, chain, engine } = setup();
  chain.failPayout = true;
  await assert.rejects(engine.execute(), /gas unavailable/);
  const run = store.active();
  store.saveConfig(
    {
      ...defaults,
      recipients: [{ address: "0x3", label: "changed", weightBps: 10000 }],
    },
    2,
  );
  chain.failPayout = false;
  const resumed = await engine.execute({ runId: run.id });
  assert.deepEqual(
    resumed.payouts.map((p: any) => p.address),
    recipients.map((r) => address(r.address)),
  );
  assert.deepEqual(chain.prepared, ["claim", "swap", "payout"]);
  store.db.close();
});
test("crash after confirmed payout but before run checkpoint uses stored receipt", async () => {
  const { store, chain, engine } = setup();
  const run = await engine.execute();
  run.status = "distributing";
  run.paidBatches = [];
  store.saveRun(run);
  await engine.execute({ runId: run.id });
  assert.equal(chain.broadcasts.filter((s) => s === "payout").length, 1);
  store.db.close();
});
test("concurrent operations cannot acquire the run lock", async () => {
  const store = new Store(":memory:");
  await store.locked(async () => {
    await assert.rejects(
      store.locked(async () => {}),
      /running/,
    );
  });
  store.db.close();
});
test("disabled execution and paused scheduled runs never submit transactions", async () => {
  const { store, chain } = setup();
  await assert.rejects(new Engine(store, chain, false).execute(), /disabled/);
  assert.deepEqual(
    await new Engine(store, chain, true).execute({ tick: true }),
    { skipped: "Schedule is paused" },
  );
  assert.equal(chain.broadcasts.length, 0);
  store.db.close();
});
test("scheduled tick executes one catch-up and ignores repeated checks for the same slot", async () => {
  const { store, chain, engine } = setup();
  store.saveConfig(
    { ...defaults, recipients, paused: false, startLocal: "2026-01-01T09:00" },
    2,
  );
  await engine.execute({ tick: true });
  assert.deepEqual(await engine.execute({ tick: true }), {
    skipped: "Not due",
  });
  assert.equal(chain.prepared.filter((s) => s === "claim").length, 1);
  store.db.close();
});
test("configuration save detects stale editor versions", () => {
  const { store } = setup();
  assert.throws(
    () => store.saveConfig({ ...defaults, recipients }, 1),
    /changed/,
  );
  store.db.close();
});
test("manual execution rejects a configuration changed after review", async () => {
  const { store, chain, engine } = setup();
  await assert.rejects(
    engine.execute({ expectedVersion: 1 }),
    /changed since review/,
  );
  assert.equal(chain.prepared.length, 0);
  store.db.close();
});
test("preflight route failure never claims or distributes", async () => {
  const { store, chain, engine } = setup();
  chain.inspect = async () => ({
    estimatedCity: "30",
    cityDecimals: 0,
    gasReady: true,
    quotes: [{ available: false }],
  });
  await assert.rejects(engine.execute(), /Preflight failed/);
  assert.equal(chain.prepared.length, 0);
  store.db.close();
});
test("a failed swap holds all proceeds and resume does not reclaim", async () => {
  const { store, chain, engine } = setup();
  chain.prepareSwap = async () => {
    throw Error("route disappeared");
  };
  await assert.rejects(engine.execute(), /route disappeared/);
  assert.deepEqual(chain.broadcasts, ["claim"]);
  const run = store.active();
  chain.prepareSwap = async () => chain.prepare("swap");
  await engine.execute({ runId: run.id });
  assert.deepEqual(chain.broadcasts, ["claim", "swap", "payout"]);
  store.db.close();
});
test("simulation guards reject unrelated debits and distinguish SUI spend from gas", () => {
  checkDebits(
    { digest: "test", changes: { [SUI]: "-12", [CITY]: "50" }, gas: "2" },
    SUI,
    10n,
  );
  assert.throws(
    () =>
      checkDebits(
        { digest: "test", changes: { [SUI]: "-12", [CITY]: "-1" }, gas: "2" },
        SUI,
        10n,
      ),
    /unaccounted/,
  );
  assert.throws(
    () =>
      checkDebits(
        { digest: "test", changes: { [SUI]: "-22", [CITY]: "50" }, gas: "2" },
        SUI,
        10n,
      ),
    /unaccounted/,
  );
});
