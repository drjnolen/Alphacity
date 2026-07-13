# Walkthrough - SUI Token Safety Checker & Trading Widgets

We have successfully implemented the **Token Safety Checker** widget alongside the **Trending & Watchlist** and **APY Yield Radar** widgets in the Left Column of the `/analyze` dashboard page.

---

## 🛡️ SUI Token Safety Checker Widget

The Token Safety Checker is a smart contract audit tool designed to evaluate the risks of SUI-based tokens before users execute trades.

### 1. Data Source Integrations
- **GoPlus Token Security API:** Connects to GoPlus's dedicated SUI endpoint (`https://api.gopluslabs.io/api/v1/sui/token_security`) to scan for contract ownership privileges and wallet distribution.
- **DexScreener API:** Fetches liquidity pool details to assess liquidity levels and prevent trading on thin or ruggable markets.

### 2. Risk Checks & Security Mappings
- **Mint Privilege Status:** Flags active minting capabilities (value `1` and owner not `Immutable`), protecting users from supply dilution.
- **Blacklist / Freeze Rights:** Flags capability to blacklist or freeze accounts (honeypot protection).
- **Contract Upgradeability:** Checks if the smart contract code is upgradeable (medium risk warning).
- **Metadata Modifiability:** Warns if coin details (logo, name, symbol) can be modified by the publisher.
- **Holder Concentration:** Sums top holder percentages, flagging high concentration (>50% top 3 private wallets) which presents a dump risk. Automatically ignores exchange wallets (e.g. Binance, Gate, Bitget) labeled by GoPlus.
- **Liquidity Status:** Deducts points if total liquidity is low (<$10k is marked critical risk, <$50k is moderate warning, and no pool is flagged as untradable).

### 3. Safety Score Formula
- Starts at **100/100** points.
- Active Mint: **-35 points**
- Blacklist Rights: **-35 points**
- Upgradeable Code: **-10 points**
- Mutable Metadata: **-5 points**
- Low Liquidity (<$10k): **-20 points**
- No Liquidity Pool: **-30 points**
- High Wallet Concentration: **-15 points** (or **-5 points** for moderate concentration)
- **Overall Score** is displayed with color coding (Green: safe, Orange: warn, Red: high risk).

---

## Verification & Testing

### 1. Syntax Check
Ensured no script errors exist in `analyze/index.html`:
```bash
node scratch/verify_syntax.js
```
**Output:**
```
[PASS] Syntax check passed for script block 1
```

### 2. Sniffer Logic Unit Tests
We verified the address normalization and safety score calculations in `verify_sniffer_logic.js`:
```bash
node scratch/verify_sniffer_logic.js
```
**Output:**
```
Running sniffer address normalization tests...
[PASS] Norm 1
[PASS] Norm 2

Running safety score calculation tests...
[PASS] Test 1 (Perfect SUI Token)
[PASS] Test 2 (Risky Token)
[PASS] Test 3 (Honeypot Blacklist)

All sniffer safety calculation tests completed!
```
