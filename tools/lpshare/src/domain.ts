import { Temporal } from "@js-temporal/polyfill";

export const POSITION =
  "0xc05bc41f0f1113d5a949dfcdf1c69addeb7f4b9660475e43ed78e20233fcb8eb";
export const CITY =
  "0x308fa16c7aead43e3a49a4ff2e76205ba2a12697234f4fe80a2da66515284060::city::CITY";
export const SUI =
  "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
export type Recipient = {
  address: string;
  label: string;
  weightBps: number;
  amount?: string;
};
export type Config = {
  recipients: Recipient[];
  paused: boolean;
  startLocal: string;
  timezone: string;
  slippageBps: number;
  gasReserve: string;
  gasBudget: string;
  minCity: string;
};
export const defaults: Config = {
  recipients: [],
  paused: true,
  startLocal: "",
  timezone: "America/Denver",
  slippageBps: 50,
  gasReserve: "1000000000",
  gasBudget: "100000000",
  minCity: "0",
};
export function address(value: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error("Invalid Sui address");
  const result = "0x" + value.slice(2).toLowerCase().padStart(64, "0");
  if (BigInt(result) === 0n) throw new Error("Zero address is not a recipient");
  return result;
}
export function coinType(value: string): string {
  const [pkg, module, name] = value.split("::");
  return `${address(pkg)}::${module}::${name}`;
}
export function units(value: string, decimals: number): bigint {
  if (
    !/^\d+(\.\d+)?$/.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 38
  )
    throw new Error("Invalid amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Amount supports at most ${decimals} decimals`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}
export function validateConfig(input: Config): Config {
  if (
    !input ||
    !Array.isArray(input.recipients) ||
    input.recipients.length > 1000
  )
    throw new Error("Invalid recipients");
  const recipients = input.recipients.map((r) => ({
    address: address(r.address.trim()),
    label: String(r.label || "").slice(0, 100),
    weightBps: r.weightBps,
  }));
  if (new Set(recipients.map((r) => r.address)).size !== recipients.length)
    throw new Error("Duplicate recipient");
  if (
    recipients.some(
      (r) => !Number.isSafeInteger(r.weightBps) || r.weightBps <= 0,
    ) ||
    (recipients.length &&
      recipients.reduce((n, r) => n + r.weightBps, 0) !== 10000)
  )
    throw new Error("Weights must total exactly 100%");
  if (typeof input.paused !== "boolean") throw new Error("Invalid pause state");
  if (!input.paused && (!recipients.length || !input.startLocal))
    throw new Error("Recipients and start time required to enable scheduling");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 1 ||
    input.slippageBps > 500
  )
    throw new Error("Slippage must be 1–500 basis points");
  for (const key of ["gasReserve", "gasBudget", "minCity"] as const)
    if (!/^\d+$/.test(input[key]))
      throw new Error(`${key} must be an integer in base units`);
  if (
    BigInt(input.gasBudget) <= 0n ||
    BigInt(input.gasReserve) < BigInt(input.gasBudget)
  )
    throw new Error("Gas reserve must cover the transaction budget");
  Temporal.Now.zonedDateTimeISO(input.timezone);
  if (input.startLocal)
    Temporal.PlainDateTime.from(input.startLocal).toZonedDateTime(
      input.timezone,
      { disambiguation: "reject" },
    );
  return { ...input, recipients };
}
export function allocate(
  total: bigint,
  recipients: Recipient[],
  decimals: number,
  fixed = false,
) {
  if (total < 0n || !recipients.length)
    throw new Error("No distributable amount or recipients");
  if (
    new Set(recipients.map((r) => address(r.address))).size !==
    recipients.length
  )
    throw new Error("Duplicate recipient");
  if (fixed) {
    const payouts = recipients.map((r) => ({
      address: address(r.address),
      amount: units(r.amount ?? "", decimals).toString(),
    }));
    const spent = payouts.reduce((n, r) => n + BigInt(r.amount), 0n);
    if (spent > total) throw new Error("Fixed payouts exceed run proceeds");
    if (spent === 0n) throw new Error("Fixed payouts must be positive");
    return { payouts, remainder: (total - spent).toString() };
  }
  validateConfig({ ...defaults, recipients });
  const rows = recipients.map((r, i) => ({
    address: address(r.address),
    amount: (total * BigInt(r.weightBps)) / 10000n,
    fraction: (total * BigInt(r.weightBps)) % 10000n,
    i,
  }));
  let left = total - rows.reduce((n, r) => n + r.amount, 0n);
  const ordered = [...rows].sort((a, b) =>
    a.fraction === b.fraction ? a.i - b.i : a.fraction > b.fraction ? -1 : 1,
  );
  for (const row of ordered)
    if (left > 0n) {
      row.amount++;
      left--;
    }
  return {
    payouts: rows.map((r) => ({
      address: r.address,
      amount: r.amount.toString(),
    })),
    remainder: "0",
  };
}
// Calendar weeks preserve the chosen local time through daylight saving changes.
export function schedule(config: Config, now = Temporal.Now.instant()) {
  if (!config.startLocal) return { due: null, next: null };
  let local = Temporal.PlainDateTime.from(config.startLocal);
  let next = local.toZonedDateTime(config.timezone, {
    disambiguation: "reject",
  });
  let due: string | null = null;
  for (
    let count = 0;
    Temporal.Instant.compare(next.toInstant(), now) <= 0;
    count++
  ) {
    if (count > 10000)
      throw new Error("Schedule anchor is too far in the past");
    due = next.toInstant().toString();
    local = local.add({ weeks: 2 });
    next = local.toZonedDateTime(config.timezone, {
      disambiguation: "compatible",
    });
  }
  return { due, next: next.toInstant().toString() };
}
