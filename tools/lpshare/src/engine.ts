import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import {
  CITY,
  SUI,
  allocate,
  schedule,
  validateConfig,
  address,
  type Recipient,
} from "./domain.ts";
import type { Chain, Prepared, Receipt } from "./chain.ts";

export class Engine {
  constructor(
    public store: Store,
    public chain: Chain,
    private live: boolean | (() => boolean) = false,
  ) {}
  enabled() {
    return typeof this.live === "function" ? this.live() : this.live;
  }
  async transaction(
    run: any,
    step: string,
    prepare: () => Promise<Prepared>,
  ): Promise<Receipt> {
    if (!this.enabled())
      throw new Error(
        "Live execution disabled; run is held before the next transaction",
      );
    let tx = this.store.tx(run.id, step);
    if (tx?.receipt) return tx.receipt;
    if (!tx) {
      const signed = await prepare();
      tx = { id: randomUUID(), run: run.id, step, ...signed };
      this.store.saveTx(tx); // Durable BEFORE any network broadcast.
      this.store.audit("transaction.prepared", {
        run: run.id,
        step,
        digest: tx.digest,
      });
    } else {
      const receipt = await this.chain.lookup(tx.digest);
      if (receipt) {
        tx.receipt = receipt;
        this.store.saveTx(tx);
        return receipt;
      }
    }
    // Uncertain outcomes keep the signed payload. Resume never creates a replacement.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        tx.receipt = await this.chain.broadcast(tx);
        this.store.saveTx(tx);
        return tx.receipt;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 1000),
        );
        const receipt = await this.chain.lookup(tx.digest);
        if (receipt) {
          tx.receipt = receipt;
          this.store.saveTx(tx);
          return receipt;
        }
      }
    }
    throw new Error("Transaction outcome unresolved");
  }
  async execute(
    options: {
      tick?: boolean;
      runId?: string;
      fixed?: Recipient[];
      expectedVersion?: number;
    } = {},
  ) {
    if (!this.enabled())
      throw new Error(
        "Live execution is disabled. Complete setup and explicitly enable it locally.",
      );
    return this.store.locked(async () => {
      const current = this.store.config();
      if (
        options.expectedVersion !== undefined &&
        current.version !== options.expectedVersion
      )
        throw new Error(
          "Configuration changed since review. Refresh and preview again.",
        );
      if (options.tick && current.config.paused)
        return { skipped: "Schedule is paused" };
      let run = this.store.active();
      if (options.runId && run?.id !== options.runId)
        throw new Error("Only the active unfinished run can be resumed");
      if (run && !options.runId && !options.tick)
        throw new Error("Resume the unfinished run before starting another");
      if (!run) {
        const config = validateConfig(current.config);
        if (!config.recipients.length)
          throw new Error("Configure recipients first");
        const due = schedule(config).due;
        if (options.tick && (!due || this.store.hasSlot(due)))
          return { skipped: "Not due" };
        const preview = await this.chain.inspect(config);
        if (!preview.gasReady || preview.quotes.some((q: any) => !q.available))
          throw new Error(
            "Preflight failed: inspect gas balance and swap routes",
          );
        const recipients = options.fixed || config.recipients;
        if (
          recipients.some(
            (r) => address(r.address) === address(this.chain.owner),
          )
        )
          throw new Error(
            "Owner cannot be a payout recipient; use a separate recipient wallet",
          );
        if (options.fixed)
          allocate(
            BigInt(preview.estimatedCity),
            recipients,
            preview.cityDecimals,
            true,
          );
        run = {
          id: randomUUID(),
          created: new Date().toISOString(),
          status: "claiming",
          configVersion: current.version,
          config,
          recipients,
          fixed: !!options.fixed,
          owner: this.chain.owner,
          decimals: preview.cityDecimals,
          slot: due,
          claimed: null,
          swaps: {},
          payouts: null,
          paidBatches: [],
          transactions: [],
          city: "0",
          remainder: "0",
        };
        this.store.saveRun(run);
        this.store.audit("run.created", {
          id: run.id,
          version: current.version,
          fixed: run.fixed,
        });
      }
      if (address(this.chain.owner) !== address(run.owner))
        throw new Error("Signer differs from the frozen run owner");
      try {
        if (!run.claimed) {
          const receipt = await this.transaction(run, "claim", () =>
            this.chain.prepareClaim(run.config),
          );
          const amounts = { ...receipt.changes };
          amounts[SUI] = (
            BigInt(amounts[SUI] || "0") + BigInt(receipt.gas)
          ).toString();
          if (Object.values(amounts).some((a) => BigInt(a as string) < 0n))
            throw new Error(
              "Unexpected claim debit; inspect the claim transaction",
            );
          run.claimed = amounts;
          run.city = amounts[CITY] || "0";
          run.transactions.push({ step: "claim", digest: receipt.digest });
          this.store.saveRun(run);
        }
        run.status = "swapping";
        this.store.saveRun(run);
        for (const [type, amount] of Object.entries(run.claimed) as [
          string,
          string,
        ][]) {
          if (type === CITY || BigInt(amount) === 0n || run.swaps[type])
            continue;
          const receipt = await this.transaction(run, `swap:${type}`, () =>
            this.chain.prepareSwap(type, amount, run.config),
          );
          const output = BigInt(receipt.changes[CITY] || "0");
          if (output <= 0n)
            throw new Error("Swap produced no attributable CITY");
          run.swaps[type] = {
            input: amount,
            output: output.toString(),
            digest: receipt.digest,
          };
          run.city = (BigInt(run.city) + output).toString();
          run.transactions.push({
            step: `swap:${type}`,
            digest: receipt.digest,
          });
          this.store.saveRun(run);
        }
        if (!run.payouts) {
          if (BigInt(run.city) === 0n) {
            run.payouts = [];
            run.remainder = "0";
          } else {
            if (BigInt(run.city) < BigInt(run.config.minCity))
              throw new Error(
                "CITY proceeds below configured distribution threshold; held for this run",
              );
            const plan = allocate(
              BigInt(run.city),
              run.recipients,
              run.decimals,
              run.fixed,
            );
            run.payouts = plan.payouts.filter((p) => BigInt(p.amount) > 0n);
            run.remainder = plan.remainder;
          }
          this.store.saveRun(run);
        }
        run.status = "distributing";
        this.store.saveRun(run);
        for (let offset = 0; offset < run.payouts.length; offset += 50) {
          const batch = offset / 50;
          if (run.paidBatches.includes(batch)) continue;
          const receipt = await this.transaction(run, `payout:${batch}`, () =>
            this.chain.preparePayout(
              run.payouts.slice(offset, offset + 50),
              run.config,
            ),
          );
          run.paidBatches.push(batch);
          run.transactions.push({
            step: `payout:${batch}`,
            digest: receipt.digest,
          });
          this.store.saveRun(run);
        }
        run.status = "complete";
        run.error = null;
        run.completed = new Date().toISOString();
        this.store.saveRun(run);
        this.store.audit("run.complete", { id: run.id });
        return run;
      } catch (error) {
        run.status = "attention";
        run.error = (error as Error).message;
        this.store.saveRun(run);
        this.store.audit("run.attention", { id: run.id, error: run.error });
        throw error;
      }
    });
  }
}
