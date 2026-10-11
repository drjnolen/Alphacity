import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";

export function dataDirectory() {
  const dir = resolve(
    process.env.LPSHARE_DATA_DIR ||
      join(
        process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
        "AlphaCity",
        "LPShare",
      ),
  );
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  if (dir.toLowerCase().startsWith(resolve(repo).toLowerCase()))
    throw new Error("Runtime data must be outside the website repository");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function adminToken(dir: string) {
  const file = join(dir, "admin-token");
  if (!existsSync(file))
    writeFileSync(file, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  return readFileSync(file, "utf8").trim();
}
export function signer(dir: string) {
  let secret = process.env.LPSHARE_PRIVATE_KEY;
  const file = join(dir, "signer.dpapi");
  if (!secret && existsSync(file)) {
    if (process.platform !== "win32")
      throw new Error("DPAPI signer requires the same Windows user");
    secret = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        fileURLToPath(new URL("../read-signer.ps1", import.meta.url)),
        "-Path",
        file,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
  }
  if (!secret) return undefined;
  const { scheme: schema, secretKey } = decodeSuiPrivateKey(secret.trim());
  if (schema === "ED25519") return Ed25519Keypair.fromSecretKey(secretKey);
  if (schema === "Secp256k1") return Secp256k1Keypair.fromSecretKey(secretKey);
  if (schema === "Secp256r1") return Secp256r1Keypair.fromSecretKey(secretKey);
  throw new Error("Unsupported signer scheme");
}
