/* Static configuration editor; authenticated APIs exist only on the local worker. */
"use strict";
const $ = (id) => document.getElementById(id);
const local = location.hostname === "127.0.0.1" && location.port === "4318";
let token = "",
  version = 1,
  live = false,
  busy = false,
  dirty = false;
let config = {
  recipients: [],
  paused: true,
  startLocal: "",
  timezone: "America/Denver",
  slippageBps: 50,
  gasReserve: "1000000000",
  gasBudget: "100000000",
  minCity: "0",
};
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function format(value, decimals = 9) {
  const s = BigInt(value)
    .toString()
    .padStart(decimals + 1, "0");
  return decimals
    ? s.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
        "." +
        s.slice(-decimals).replace(/0+$/, "").padEnd(1, "0")
    : s;
}
function base(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw Error("Enter a positive decimal amount");
  const [a, b = ""] = value.split(".");
  if (b.length > decimals) throw Error("Too many decimal places");
  return (
    BigInt(a) * 10n ** BigInt(decimals) +
    BigInt(b.padEnd(decimals, "0") || "0")
  ).toString();
}
function readConfig() {
  const recipients = [...$("recipients").children].map((tr) => ({
    label: tr.querySelector("[data-field=label]").value.trim(),
    address: tr.querySelector("[data-field=address]").value.trim(),
    weightBps: Number(base(tr.querySelector("[data-field=weight]").value, 2)),
  }));
  for (const r of recipients)
    if (
      !/^0x[\da-fA-F]{1,64}$/.test(r.address) ||
      BigInt(r.address) === 0n ||
      r.weightBps <= 0
    )
      throw Error("Each recipient needs a valid wallet and a positive weight");
  if (
    new Set(recipients.map((r) => BigInt(r.address).toString())).size !==
    recipients.length
  )
    throw Error("Duplicate wallet address");
  if (
    recipients.length &&
    recipients.reduce((n, r) => n + r.weightBps, 0) !== 10000
  )
    throw Error("Weights must total exactly 100%");
  return {
    ...config,
    recipients,
    startLocal: $("start").value,
    timezone: $("timezone").value.trim(),
    paused: $("paused").checked,
    slippageBps: Number(base($("slippage").value, 2)),
    gasReserve: base($("gas").value, 9),
  };
}
function row(recipient = { label: "", address: "", weightBps: 0 }) {
  const tr = document.createElement("tr");
  for (const [field, value, label] of [
    ["label", recipient.label, "Recipient label"],
    ["address", recipient.address, "Sui wallet address"],
    ["weight", String(recipient.weightBps / 100), "Percentage weight"],
  ]) {
    const td = document.createElement("td"),
      input = document.createElement("input");
    input.value = value;
    input.dataset.field = field;
    input.setAttribute("aria-label", label);
    if (field === "weight") input.inputMode = "decimal";
    td.append(input);
    tr.append(td);
  }
  const td = document.createElement("td"),
    remove = document.createElement("button");
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove recipient");
  remove.onclick = () => {
    tr.remove();
    changed();
  };
  td.append(remove);
  tr.append(td);
  $("recipients").append(tr);
  updateWeight();
}
function updateWeight() {
  let sum = 0;
  for (const el of document.querySelectorAll("[data-field=weight]"))
    sum += Number(el.value) || 0;
  $("weight-total").textContent =
    `${sum.toFixed(2).replace(/\.00$/, "")}% allocated`;
  $("empty").hidden = !!$("recipients").children.length;
}
function changed() {
  dirty = true;
  updateWeight();
  $("preview-panel").hidden = true;
  $("estimated").textContent = "— CITY";
  $("estimate-note").textContent = "Preview to fetch current earnings";
  $("save-note").textContent = token
    ? "Unsaved changes. Save before previewing or running."
    : "Download your configuration, then import it into the local worker.";
}
function renderConfig() {
  $("recipients").replaceChildren();
  config.recipients.forEach(row);
  $("start").value = config.startLocal;
  $("timezone").value = config.timezone;
  $("paused").checked = config.paused;
  $("slippage").value = config.slippageBps / 100;
  $("gas").value = format(config.gasReserve).replaceAll(",", "");
  dirty = false;
  updateWeight();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}
function csvRecipients(text, fixed = false) {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  const expected = fixed ? "amount" : "weight";
  if (rows.shift()?.join(",").trim() !== `label,address,${expected}`)
    throw Error(`CSV header must be label,address,${expected}`);
  return rows.map((r) => {
    if (r.length !== 3) throw Error("Each CSV row must have 3 columns");
    return {
      label: r[0],
      address: r[1].trim(),
      weightBps: fixed ? 0 : Number(base(r[2].trim(), 2)),
      ...(fixed ? { amount: r[2].trim() } : {}),
    };
  });
}
function fixed() {
  return $("fixed").value.trim()
    ? csvRecipients($("fixed").value, true)
    : undefined;
}
async function api(path, data) {
  if (!token) throw Error("Open and unlock the local dashboard first");
  const res = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await res.json();
  if (!res.ok) throw Error(value.error || "Request failed");
  return value;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    message(e.message, true);
  } finally {
    busy = false;
  }
}
async function refresh() {
  const state = await api("status");
  version = state.version;
  live = state.live;
  if (!dirty) {
    config = state.config;
    renderConfig();
  }
  $("mode").textContent = live
    ? "Live execution enabled"
    : "Live execution disabled";
  $("next").textContent = state.config.paused
    ? "Paused"
    : state.schedule.next
      ? new Date(state.schedule.next).toLocaleString(undefined, {
          timeZone: state.config.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Not scheduled";
  $("run").disabled = !live;
  $("save").textContent = "Save configuration";
  $("save-note").textContent = dirty
    ? "Unsaved changes. Save before running."
    : `Configuration v${version} · saved on this computer`;
  $("audit").textContent =
    state.audit
      .map((a) => `${a.created} · ${a.action}\n${a.json}`)
      .join("\n\n") || "No changes recorded.";
  renderRuns(state.runs);
}
function renderRuns(runs) {
  const history = $("history");
  history.replaceChildren();
  history.classList.toggle("empty", !runs.length);
  if (!runs.length) {
    history.textContent = "No runs yet. Start with a read-only preview.";
    return;
  }
  for (const run of runs) {
    const el = document.createElement("article");
    el.className = "run";
    const title = document.createElement("b");
    title.textContent = `${new Date(run.created).toLocaleString()} · ${run.status}`;
    const p = document.createElement("p");
    p.textContent = `Config v${run.configVersion} · ${format(run.city, run.decimals)} CITY · ${run.paidBatches.length} batches sent · ${format(run.remainder, run.decimals)} retained`;
    el.append(title, p);
    if (run.error) {
      const error = document.createElement("p");
      error.textContent = run.error;
      el.append(error);
    }
    for (const tx of run.transactions) {
      const a = document.createElement("a");
      a.href =
        "https://suiscan.xyz/mainnet/tx/" + encodeURIComponent(tx.digest);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = tx.step + " ↗";
      el.append(a);
    }
    if (run.status !== "complete") {
      const resume = document.createElement("button");
      resume.textContent = "Resume run";
      resume.disabled = !live;
      resume.onclick = () =>
        action(async () => {
          message("Resuming the saved run…");
          await api("resume", { runId: run.id });
          await refresh();
          message("Run reconciled.");
        });
      el.append(resume);
    }
    history.append(el);
  }
}
$("add").onclick = () => {
  row();
  changed();
};
$("recipients").oninput = changed;
for (const id of ["start", "timezone", "paused", "slippage", "gas"])
  $(id).oninput = changed;
$("import-csv").onclick = () => $("csv-file").click();
$("csv-file").onchange = () =>
  action(async () => {
    const file = $("csv-file").files[0];
    if (!file) return;
    const values = csvRecipients(await file.text());
    $("recipients").replaceChildren();
    values.forEach(row);
    changed();
    $("csv-file").value = "";
  });
$("export-csv").onclick = () =>
  action(async () => {
    const c = readConfig();
    const quote = (s) => '"' + String(s).replaceAll('"', '""') + '"';
    download(
      "lpshare-recipients.csv",
      "label,address,weight\n" +
        c.recipients
          .map((r) =>
            [r.label, r.address, r.weightBps / 100].map(quote).join(","),
          )
          .join("\n"),
      "text/csv",
    );
  });
$("import-config").onclick = () => $("config-file").click();
$("config-file").onchange = () =>
  action(async () => {
    const file = $("config-file").files[0];
    if (!file) return;
    const value = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (!Array.isArray(value.recipients)) throw Error("Invalid configuration");
    config = { ...config, ...value };
    renderConfig();
    changed();
    $("config-file").value = "";
    message("Configuration imported. Save to apply it.");
  });
$("save").onclick = () =>
  action(async () => {
    const value = readConfig();
    if (token) {
      const result = await api("config", { config: value, version });
      config = result.config;
      version = result.version;
      dirty = false;
      await refresh();
      message(
        "Configuration saved. Existing runs keep their original recipients.",
      );
    } else {
      download(
        "lpshare-config.json",
        JSON.stringify(value, null, 2),
        "application/json",
      );
      message(
        "Configuration downloaded. Import it using the local dashboard or CLI.",
      );
    }
  });
$("login").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    token = $("token").value.trim();
    try {
      await refresh();
      $("token").value = "";
      $("login").hidden = true;
      $("connection-title").textContent = "Local worker connected.";
      $("connection-copy").textContent =
        "Configuration and transaction history are stored on this computer. Your access token stays in this tab’s memory.";
      message("Dashboard unlocked.");
    } catch (e) {
      token = "";
      throw e;
    }
  });
};
$("refresh").onclick = () => action(refresh);
$("preview").onclick = () =>
  action(async () => {
    if (dirty && token)
      throw Error("Save your configuration before previewing");
    message("Reading current fees and fetching CITY routes…");
    const p = await api("preview", { fixed: fixed() });
    $("estimated").textContent =
      format(p.estimatedCity, p.cityDecimals) + " CITY";
    $("estimate-note").textContent =
      "Estimated · " + new Date().toLocaleTimeString();
    $("preview-panel").hidden = false;
    $("preview-details").textContent =
      `Gas balance: ${format(p.gasBalance)} SUI. ${p.quotes.every((q) => q.available) ? "All required routes available." : "Some tokens have no available route."} ${p.priceImpact}`;
    $("preview-payouts").replaceChildren();
    for (const r of p.allocation?.payouts || []) {
      const el = document.createElement("div");
      el.className = "payout";
      const addr = document.createElement("span"),
        amount = document.createElement("b");
      addr.textContent = r.address;
      amount.textContent = format(r.amount, p.cityDecimals) + " CITY";
      el.append(addr, amount);
      $("preview-payouts").append(el);
    }
    message("Preview complete. No transactions were signed or sent.");
  });
$("run").onclick = () => {
  if (dirty) return message("Save your configuration first.", true);
  $("confirm-version").textContent =
    `Saved configuration v${version}. ${$("fixed").value.trim() ? "A fixed payout override is entered." : "Percentage payouts will be used."}`;
  $("confirm").showModal();
};
$("cancel-run").onclick = () => $("confirm").close();
$("confirm-run").onclick = () => {
  $("confirm").close();
  action(async () => {
    message(
      "Executing claim → swap → distribution. Keep this window open to follow progress.",
    );
    try {
      await api("run", { fixed: fixed(), version });
      message("Run completed.");
    } finally {
      await refresh();
    }
  });
};
if (local) {
  $("remote-setup").hidden = true;
  $("login").hidden = false;
} else {
  $("preview").disabled = true;
  $("refresh").disabled = true;
}
renderConfig();
