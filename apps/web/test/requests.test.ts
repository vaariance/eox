import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { parseScaled } from "../src/lib/amounts";
import { coxProgram, requestInstruction, tokenAccount } from "../src/lib/chain";
import { type PlanInput, planRequest } from "../src/lib/requests";

const base: PlanInput = { operation: "deposit", fromIndex: null, toIndex: 3, amount: "250", minimum: "", validForBatches: 3, targetBatch: 120, collateralDecimals: 6 };

describe("amount parsing", () => {
  it("turns a decimal into exact integer units without floating point", () => {
    expect(parseScaled("250", 6)).toBe(250_000_000n);
    expect(parseScaled("0.000001", 6)).toBe(1n);
    expect(parseScaled("1450.25", 12)).toBe(1_450_250_000_000_000n);
    expect(parseScaled("9007199254740993", 0)).toBe(9007199254740993n);
  });

  it("refuses more decimals than the token has, signs, exponents and blanks", () => {
    for (const text of ["0.0000001", "-1", "1e3", "", "1,000", ".5", "01"]) expect(parseScaled(text, 6)).toBeNull();
  });
});

describe("request planning", () => {
  it("plans a buy in collateral base units with an inclusive expiry batch", () => {
    expect(planRequest(base)).toEqual({ plan: { operation: "deposit", to: 3, amount: 250_000_000n, minimumUnits: 0n, expiryBatch: 122n }, problem: null });
    expect(planRequest({ ...base, minimum: "238", validForBatches: 1 }).plan).toMatchObject({ minimumUnits: 238_000_000_000_000n, expiryBatch: 120n });
  });

  it("plans a redeem and a switch in unit quanta", () => {
    expect(planRequest({ ...base, operation: "redeem", fromIndex: 0, toIndex: null, amount: "10", minimum: "11.5" }).plan).toEqual({
      operation: "redeem",
      from: 0,
      units: 10_000_000_000_000n,
      minimumProceeds: 11_500_000n,
      expiryBatch: 122n,
    });
    expect(planRequest({ ...base, operation: "switch", fromIndex: 0, toIndex: 30, amount: "7.5" }).plan).toEqual({
      operation: "switch",
      from: 0,
      to: 30,
      units: 7_500_000_000_000n,
      minimumUnits: 0n,
      expiryBatch: 122n,
    });
  });

  it("refuses a switch into the same class, a zero amount, too many decimals and a missing batch", () => {
    expect(planRequest({ ...base, operation: "switch", fromIndex: 2, toIndex: 2 }).problem).toBe("A switch cannot end in the class it started from.");
    expect(planRequest({ ...base, amount: "0" }).problem).toBe("Enter an amount above zero.");
    expect(planRequest({ ...base, amount: "1.0000001" }).problem).toBe("Enter an amount with at most 6 decimal places.");
    expect(planRequest({ ...base, targetBatch: Number.NaN }).problem).toBe("There is no open batch to join.");
    expect(planRequest({ ...base, toIndex: 31 }).problem).toBe("Choose a class to buy into.");
  });
});

describe("request instruction", () => {
  const program = coxProgram({} as never);
  const owner = new PublicKey("HgC4Jn7XMLzNsDjVdsr1x7BDuGBb2SBvx5TFLSUYaEyU");
  const pool = new PublicKey("7TKNJWWpjcVWsnwo9TJvJyBMFLDwvgpKdDxPqmfw87cp");
  const collateralMint = new PublicKey("GBZafz1m5qSDc3br2zEa2YG4hvQqj5DESk694byEwcNa");
  const accounts = { owner, pool, collateralMint, nonce: 5n };

  it("targets the deployed program with the wallet as the only signer", () => {
    const plan = planRequest(base).plan!;
    const instruction = requestInstruction(program, plan, accounts);
    expect(instruction.programId.toBase58()).toBe("G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF");
    expect(instruction.keys).toHaveLength(9);
    expect(instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58())).toEqual([owner.toBase58()]);
    expect(instruction.keys[2]!.pubkey.equals(pool)).toBe(true);
    expect(instruction.keys[6]!.pubkey.equals(tokenAccount(owner, collateralMint))).toBe(true);
  });

  it("encodes the buy arguments after the instruction discriminator", () => {
    const data = requestInstruction(program, planRequest({ ...base, minimum: "238" }).plan!, accounts).data;
    expect(data).toHaveLength(8 + 1 + 8 + 16 + 8);
    expect(data[8]).toBe(3);
    expect(data.readBigUInt64LE(9)).toBe(250_000_000n);
    expect(data.readBigUInt64LE(17)).toBe(238_000_000_000_000n);
    expect(data.readBigUInt64LE(33)).toBe(122n);
  });

  it("uses a different request account for each request number, and a different instruction per operation", () => {
    const plan = planRequest(base).plan!;
    const first = requestInstruction(program, plan, accounts).keys[4]!.pubkey;
    const second = requestInstruction(program, plan, { ...accounts, nonce: 6n }).keys[4]!.pubkey;
    expect(first.equals(second)).toBe(false);
    const redeem = requestInstruction(program, planRequest({ ...base, operation: "redeem", fromIndex: 0, toIndex: null, amount: "10" }).plan!, accounts);
    const deposit = requestInstruction(program, plan, accounts);
    expect(redeem.data.subarray(0, 8).equals(deposit.data.subarray(0, 8))).toBe(false);
  });

  it("derives the standard associated token account", () => {
    const usdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const holder = new PublicKey("11111111111111111111111111111111");
    expect(PublicKey.isOnCurve(tokenAccount(holder, usdc).toBytes())).toBe(false);
    expect(tokenAccount(holder, usdc).equals(tokenAccount(holder, collateralMint))).toBe(false);
  });
});
