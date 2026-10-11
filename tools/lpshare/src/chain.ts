import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { CetusClmmSDK } from "@cetusprotocol/sui-clmm-sdk";
import { CetusBurnSDK } from "@cetusprotocol/burn-sdk";
import {
  AggregatorClient,
  getProvidersExcluding,
} from "@cetusprotocol/aggregator-sdk";
import type { Signer } from "@mysten/sui/cryptography";
import {
  POSITION,
  CITY,
  SUI,
  address,
  coinType,
  type Config,
} from "./domain.ts";

export type Receipt = {
  digest: string;
  changes: Record<string, string>;
  gas: string;
};
export type Prepared = { digest: string; bytes: string; signature: string };
export function checkDebits(
  receipt: Receipt,
  expectedType?: string,
  expectedAmount = 0n,
) {
  const changes = { ...receipt.changes };
  changes[SUI] = (BigInt(changes[SUI] || "0") + BigInt(receipt.gas)).toString();
  for (const [type, amount] of Object.entries(changes)) {
    if (
      BigInt(amount) < 0n &&
      (type !== expectedType || BigInt(amount) !== -expectedAmount)
    )
      throw new Error("Simulation would spend unaccounted wallet funds");
  }
  if (expectedType && BigInt(changes[expectedType] || "0") !== -expectedAmount)
    throw new Error("Simulation debit differs from the tracked amount");
}
export interface Chain {
  owner: string;
  inspect(config: Config): Promise<any>;
  prepareClaim(config: Config): Promise<Prepared>;
  prepareSwap(type: string, amount: string, config: Config): Promise<Prepared>;
  preparePayout(
    payouts: { address: string; amount: string }[],
    config: Config,
  ): Promise<Prepared>;
  lookup(digest: string): Promise<Receipt | null>;
  broadcast(tx: Prepared): Promise<Receipt>;
}
const include = { effects: true, balanceChanges: true } as const;
export class SuiChain implements Chain {
  client: SuiGrpcClient;
  sdk: CetusClmmSDK;
  burn: CetusBurnSDK;
  aggregator: AggregatorClient;
  owner = "";
  constructor(private signer?: Signer) {
    this.client = new SuiGrpcClient({
      network: "mainnet",
      baseUrl: process.env.LPSHARE_RPC || "https://fullnode.mainnet.sui.io:443",
      timeout: 30000,
    });
    this.sdk = CetusClmmSDK.createSDK({
      env: "mainnet",
      sui_client: this.client,
    });
    this.burn = CetusBurnSDK.createSDK({
      env: "mainnet",
      sui_client: this.client,
    });
    this.owner = signer?.toSuiAddress() ?? "";
    this.aggregator = new AggregatorClient({
      client: this.client,
      signer: this.owner,
    });
  }
  async position() {
    const { object } = await this.client.getObject({ objectId: POSITION });
    if (object.owner.$kind !== "AddressOwner")
      throw new Error(
        "Position is wrapped/staked or not address-owned. Its specific claim adapter is required; no unstaking or principal withdrawal will be attempted.",
      );
    const owner = address(object.owner.AddressOwner);
    if (this.signer && owner !== address(this.signer.toSuiAddress()))
      throw new Error("Configured signer does not own this position");
    this.owner = owner;
    this.sdk.setSenderAddress(owner);
    this.aggregator.signer = owner;
    const burned =
      object.type ===
      `${this.burn.sdkOptions.burn.package_id}::lp_burn::CetusLPBurnProof`;
    if (burned) {
      const proof = await this.burn.Burn.getBurnPosition(POSITION);
      if (!proof) throw new Error("Could not decode burn proof");
      const pool = await this.sdk.Pool.getPool(proof.clmm_pool_id, true);
      return {
        owner,
        position: {
          liquidity: proof.liquidity,
          pos_object_id: proof.clmm_position_id,
        },
        pool,
        burned,
      };
    }
    if (!object.type.endsWith("::position::Position"))
      throw new Error("Unsupported position object type");
    const position = await this.sdk.Position.getPositionById(POSITION, false);
    const pool = await this.sdk.Pool.getPool(position.pool, true);
    return { owner, position, pool, burned };
  }
  async quote(type: string, amount: string, config: Config) {
    // Exclude routes requiring unrelated DEEP balances. Never add referral/overlay fees.
    const route = await this.aggregator.findRouters({
      from: type,
      target: CITY,
      amount,
      byAmountIn: true,
      slippage: config.slippageBps / 10000,
      providers: getProvidersExcluding(["DEEPBOOKV3"]),
    });
    if (
      !route ||
      route.error ||
      route.insufficientLiquidity ||
      route.amountOut.lten(0) ||
      !route.paths.length ||
      route.amountIn.toString() !== amount
    )
      throw new Error(`No acceptable CITY route for ${type}`);
    return route;
  }
  async inspect(config: Config) {
    const { owner, position, pool, burned } = await this.position();
    const [{ coinMetadata }, fees, rewards, gas] = await Promise.all([
      this.client.getCoinMetadata({ coinType: CITY }),
      this.sdk.Position.fetchPosFeeAmount([
        {
          pool_id: pool.id,
          position_id: position.pos_object_id,
          coin_type_a: pool.coin_type_a,
          coin_type_b: pool.coin_type_b,
        },
      ]),
      this.sdk.Rewarder.fetchPositionRewarders(pool, position.pos_object_id),
      this.client.getBalance({ owner, coinType: SUI }),
    ]);
    if (!coinMetadata) throw new Error("CITY metadata could not be verified");
    if (!fees[0]) throw new Error("Could not read position fees");
    const amounts: Record<string, string> = {};
    const add = (type: string, amount: string) => {
      const key = coinType(type);
      amounts[key] = (BigInt(amounts[key] || "0") + BigInt(amount)).toString();
    };
    add(pool.coin_type_a, fees[0].fee_owned_a);
    add(pool.coin_type_b, fees[0].fee_owned_b);
    for (const reward of rewards) add(reward.coin_type, reward.amount_owned);
    const quotes: any[] = [];
    let city = BigInt(amounts[CITY] || "0");
    for (const [type, amount] of Object.entries(amounts)) {
      if (type === CITY || BigInt(amount) === 0n) continue;
      try {
        const q = await this.quote(type, amount, config);
        city += BigInt(q.amountOut.toString());
        quotes.push({
          type,
          amount,
          city: q.amountOut.toString(),
          available: true,
        });
      } catch (error) {
        quotes.push({
          type,
          amount,
          available: false,
          error: (error as Error).message,
        });
      }
    }
    return {
      position: POSITION,
      underlyingPosition: position.pos_object_id,
      burned,
      owner,
      pool: pool.id,
      liquidity: position.liquidity,
      amounts,
      quotes,
      estimatedCity: city.toString(),
      cityDecimals: coinMetadata.decimals,
      gasBalance: gas.balance.coinBalance,
      gasReady:
        BigInt(gas.balance.coinBalance) >=
        BigInt(config.gasReserve) + BigInt(config.gasBudget),
      priceImpact:
        "Unavailable: aggregator quotes are not an independent fair-value price. Review preview before enabling unattended swaps.",
    };
  }
  async gas(config: Config, extra = 0n) {
    const { balance } = await this.client.getBalance({
      owner: this.owner,
      coinType: SUI,
    });
    if (
      BigInt(balance.coinBalance) <
      BigInt(config.gasReserve) + BigInt(config.gasBudget) + extra
    )
      throw new Error(
        "Insufficient SUI coin balance to preserve the gas reserve",
      );
  }
  async prepare(
    tx: Transaction,
    config: Config,
    check: (receipt: Receipt) => void,
  ): Promise<Prepared> {
    if (!this.signer) throw new Error("Signer is not configured");
    tx.setSender(this.owner);
    tx.setGasBudget(BigInt(config.gasBudget));
    const bytes = await tx.build({ client: this.client });
    const simulated = await this.client.simulateTransaction({
      transaction: bytes,
      include,
    });
    if (simulated.$kind === "FailedTransaction")
      throw new Error(
        "Transaction simulation failed: " +
          JSON.stringify(simulated.FailedTransaction.status.error),
      );
    check(this.receipt(simulated));
    const signed = await this.signer.signTransaction(bytes);
    return {
      digest: await tx.getDigest({ client: this.client }),
      bytes: Buffer.from(bytes).toString("base64"),
      signature: signed.signature,
    };
  }
  async prepareClaim(config: Config) {
    const tx = await this.claimTransaction();
    await this.gas(config);
    return this.prepare(tx, config, (receipt) => checkDebits(receipt));
  }
  async claimTransaction() {
    const { pool, burned } = await this.position();
    const params = {
      pool_id: pool.id,
      pos_id: POSITION,
      coin_type_a: pool.coin_type_a,
      coin_type_b: pool.coin_type_b,
      account: this.owner,
      rewarder_coin_types: pool.rewarder_infos.map((r) => r.coin_type),
    };
    if (burned) {
      const tx = this.burn.Burn.createCollectFeePayload(params);
      if (params.rewarder_coin_types.length)
        this.burn.Burn.createCollectRewardPayload(params, tx);
      return tx;
    }
    return this.sdk.Rewarder.collectRewarderPayload({
      ...params,
      collect_fee: true,
    });
  }
  async simulateClaim(config: Config) {
    const tx = await this.claimTransaction();
    tx.setSender(this.owner);
    tx.setGasBudget(BigInt(config.gasBudget));
    return this.receipt(
      await this.client.simulateTransaction({ transaction: tx, include }),
    );
  }
  async prepareSwap(type: string, amount: string, config: Config) {
    await this.gas(config, coinType(type) === SUI ? BigInt(amount) : 0n);
    const route = await this.quote(type, amount, config); // Never reuse a preview quote.
    const tx = new Transaction();
    const input = tx.add(coinWithBalance({ type, balance: BigInt(amount) }));
    const output = await this.aggregator.routerSwap({
      router: route,
      inputCoin: input,
      txb: tx,
      slippage: config.slippageBps / 10000,
    });
    tx.transferObjects([output], this.owner);
    return this.prepare(tx, config, (receipt) => {
      checkDebits(receipt, coinType(type), BigInt(amount));
      if (BigInt(receipt.changes[CITY] || "0") <= 0n)
        throw new Error("Simulation produces no CITY");
    });
  }
  async preparePayout(
    payouts: { address: string; amount: string }[],
    config: Config,
  ) {
    await this.gas(config);
    const tx = new Transaction();
    const total = payouts.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const input = tx.add(
      coinWithBalance({ type: CITY, balance: total, useGasCoin: false }),
    );
    const coins = tx.splitCoins(
      input,
      payouts.map((r) => BigInt(r.amount)),
    );
    payouts.forEach((r, i) => tx.transferObjects([coins[i]], r.address));
    tx.moveCall({
      target: "0x2::coin::destroy_zero",
      typeArguments: [CITY],
      arguments: [input],
    });
    return this.prepare(tx, config, (receipt) =>
      checkDebits(receipt, CITY, total),
    );
  }
  receipt(result: any): Receipt {
    if (result.$kind !== "Transaction" || !result.Transaction.status.success)
      throw new Error(
        "Transaction failed on-chain; inspect its digest before recovery: " +
          JSON.stringify(result.FailedTransaction?.status.error),
      );
    const tx = result.Transaction;
    const changes: Record<string, string> = {};
    for (const change of tx.balanceChanges)
      if (address(change.address) === address(this.owner)) {
        const type = coinType(change.coinType);
        changes[type] = (
          BigInt(changes[type] || "0") + BigInt(change.amount)
        ).toString();
      }
    const gas = tx.effects.gasUsed;
    return {
      digest: tx.digest,
      changes,
      gas: (
        BigInt(gas.computationCost) +
        BigInt(gas.storageCost) -
        BigInt(gas.storageRebate)
      ).toString(),
    };
  }
  async lookup(digest: string): Promise<Receipt | null> {
    try {
      return this.receipt(
        await this.client.getTransaction({ digest, include }),
      );
    } catch (error: any) {
      // Only an explicit NOT_FOUND allows rebroadcast, always of the SAME signed bytes.
      if (
        error.code === "NOT_FOUND" ||
        error.code === 5 ||
        error.name === "TransactionNotFoundError"
      )
        return null;
      throw error;
    }
  }
  async broadcast(tx: Prepared) {
    return this.receipt(
      await this.client.executeTransaction({
        transaction: Buffer.from(tx.bytes, "base64"),
        signatures: [tx.signature],
        include,
      }),
    );
  }
}
