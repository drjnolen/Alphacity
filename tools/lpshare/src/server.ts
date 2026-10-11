import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Store } from "./store.ts";
import { Engine } from "./engine.ts";
import { schedule, allocate } from "./domain.ts";

async function body(req: IncomingMessage) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 250000) throw new Error("Request too large");
  }
  return JSON.parse(value || "{}");
}
export function serve(
  store: Store,
  engine: Engine,
  token: string,
  live: boolean,
  port = 4318,
) {
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (
      req.headers.host !== `127.0.0.1:${port}` ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return json(403, { error: "Invalid request origin" });
    const path = new URL(req.url || "/", origin).pathname;
    try {
      if (path.startsWith("/api/")) {
        const supplied = Buffer.from(
          (req.headers.authorization || "").replace(/^Bearer /, ""),
        );
        const expected = Buffer.from(token);
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          return json(401, { error: "Enter the local worker access token" });
        if (req.method === "GET" && path === "/api/status")
          return json(200, {
            ...store.config(),
            schedule: schedule(store.config().config),
            runs: store.runs(),
            audit: store.history(),
            live,
            signer: engine.chain.owner || null,
          });
        if (
          req.method !== "POST" ||
          req.headers["content-type"] !== "application/json"
        )
          return json(405, { error: "JSON POST required" });
        const input = await body(req);
        if (path === "/api/config")
          return json(
            200,
            await store.locked(async () =>
              store.saveConfig(input.config, input.version),
            ),
          );
        if (path === "/api/preview") {
          const config = store.config().config;
          const preview = await engine.chain.inspect(config);
          return json(200, {
            ...preview,
            allocation: config.recipients.length
              ? allocate(
                  BigInt(preview.estimatedCity),
                  input.fixed || config.recipients,
                  preview.cityDecimals,
                  !!input.fixed,
                )
              : null,
          });
        }
        if (path === "/api/run" || path === "/api/resume") {
          if (path === "/api/run" && !Number.isInteger(input.version))
            throw new Error("Reviewed configuration version required");
          if (path === "/api/resume" && typeof input.runId !== "string")
            throw new Error("Run ID required");
          return json(
            200,
            await engine.execute(
              path === "/api/resume"
                ? { runId: input.runId }
                : { fixed: input.fixed, expectedVersion: input.version },
            ),
          );
        }
        return json(404, { error: "Unknown API endpoint" });
      }
      const assets: Record<string, string> = {
        "/": "index.html",
        "/lpshare": "index.html",
        "/lpshare/": "index.html",
        "/lpshare/app.js": "app.js",
        "/lpshare/style.css": "style.css",
      };
      const file = assets[path];
      if (!file || req.method !== "GET")
        return json(404, { error: "Not found" });
      const content = await readFile(
        new URL(`../../../lpshare/${file}`, import.meta.url),
      );
      res.setHeader(
        "Content-Type",
        file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".js")
            ? "text/javascript"
            : "text/html",
      );
      res.end(content);
    } catch (error) {
      json(400, { error: (error as Error).message });
    }
  });
  server.requestTimeout = 30000;
  server.listen(port, "127.0.0.1");
  return server;
}
