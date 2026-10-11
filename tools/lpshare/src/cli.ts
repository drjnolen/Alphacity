import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.ts";
import { SuiChain } from "./chain.ts";
import { Engine } from "./engine.ts";
import { serve } from "./server.ts";
import { dataDirectory, adminToken, signer } from "./runtime.ts";
import { schedule, allocate } from "./domain.ts";

const command = process.argv[2] || "help";
if (command === "help" || command === "--help") {
  console.log(
    "LP Share: serve | status | preview | simulate | run [fixed.json] | resume <id> | tick | import <config.json> | export | enable-live --accept-mainnet-risk --accept-unpriced-routes | disable-live",
  );
} else {
  const dir = dataDirectory();
  const store = new Store(join(dir, "lpshare.sqlite"));
  const marker = join(dir, "live-enabled.json");
  const keypair = signer(dir);
  const chain = new SuiChain(keypair);
  const activation = existsSync(marker)
    ? JSON.parse(readFileSync(marker, "utf8"))
    : null;
  const live =
    !!activation && !!keypair && activation.owner === keypair.toSuiAddress();
  const engine = new Engine(store, chain, () => live && existsSync(marker));
  try {
    if (command === "serve") {
      const token = adminToken(dir);
      serve(store, engine, token, live);
      console.log(
        `LP Share: http://127.0.0.1:4318/lpshare/\nLocal access token: ${token}\nLive execution: ${live ? "enabled" : "disabled"}\nData: ${dir}`,
      );
    } else if (command === "status")
      console.log(
        JSON.stringify(
          {
            ...store.config(),
            schedule: schedule(store.config().config),
            runs: store.runs(),
            live,
          },
          null,
          2,
        ),
      );
    else if (command === "export")
      console.log(JSON.stringify(store.config().config, null, 2));
    else if (command === "import")
      console.log(
        await store.locked(async () =>
          store.saveConfig(
            JSON.parse(
              readFileSync(process.argv[3], "utf8").replace(/^\uFEFF/, ""),
            ),
            store.config().version,
          ),
        ),
      );
    else if (command === "preview") {
      const config = store.config().config;
      const preview = await chain.inspect(config);
      console.log(
        JSON.stringify(
          {
            ...preview,
            allocation: config.recipients.length
              ? allocate(
                  BigInt(preview.estimatedCity),
                  config.recipients,
                  preview.cityDecimals,
                )
              : null,
          },
          null,
          2,
        ),
      );
    } else if (command === "simulate")
      console.log(
        JSON.stringify(
          await chain.simulateClaim(store.config().config),
          null,
          2,
        ),
      );
    else if (command === "enable-live") {
      if (
        !process.argv.includes("--accept-mainnet-risk") ||
        !process.argv.includes("--accept-unpriced-routes")
      )
        throw new Error(
          "Both risk acceptance flags are required. Independent price-impact assessment is not available.",
        );
      if (!keypair) throw new Error("Set up the local signer first");
      const preview = await chain.inspect(store.config().config);
      if (
        !preview.gasReady ||
        preview.quotes.some((q: any) => !q.available) ||
        !store.config().config.recipients.length
      )
        throw new Error(
          "Complete recipients, gas funding, and route checks first",
        );
      await chain.simulateClaim(store.config().config);
      writeFileSync(
        marker,
        JSON.stringify({
          owner: keypair.toSuiAddress(),
          enabled: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
      store.audit("live.enabled", { owner: keypair.toSuiAddress() });
      console.log(
        "Live execution enabled. Restart the local server to apply. Scheduling still follows the pause setting.",
      );
    } else if (command === "disable-live") {
      if (existsSync(marker)) unlinkSync(marker);
      store.audit("live.disabled", {});
      console.log(
        "Live execution disabled. Any transaction already submitted can still complete.",
      );
    } else if (
      command === "run" ||
      command === "tick" ||
      command === "resume"
    ) {
      if (command === "resume" && !process.argv[3])
        throw new Error("Run ID required for resume");
      console.log(
        JSON.stringify(
          await engine.execute({
            tick: command === "tick",
            runId: command === "resume" ? process.argv[3] : undefined,
            fixed:
              command === "run" && process.argv[3]
                ? JSON.parse(readFileSync(process.argv[3], "utf8"))
                : undefined,
          }),
          null,
          2,
        ),
      );
    } else throw new Error("Unknown command. Use help.");
  } catch (error) {
    const message = (error as Error).message;
    store.audit("command.failed", { command, error: message });
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (command !== "serve") store.db.close();
  }
}
