import { describe, expect, it } from "vitest";
import { humanError, walletError } from "./errors";

describe("humanError", () => {
  it("explains a program error without the raw log", () => {
    const raw = "Program log: AnchorError thrown in programs/cox/src/lib.rs:1967. Error Code: InsufficientUnlockedUnits. Error Number: 6022. Error Message: InsufficientUnlockedUnits.";
    const text = humanError("TRANSACTION_REJECTED", raw);
    expect(text).toMatch(/enough free units/);
    expect(text).not.toMatch(/Anchor|lib\.rs|6022/);
  });

  it("asks for a retry when the fee version moved", () => {
    expect(humanError("FEE_CHANGED", "stale")).toMatch(/fee changed/);
  });

  it("never passes an unknown message through", () => {
    expect(humanError("TRANSACTION_REJECTED", "custom program error: 0x1a2b at slot 9")).not.toMatch(/0x1a2b|slot/);
    expect(humanError("SOMETHING_NEW", "stack trace here")).not.toMatch(/stack/);
  });
});

describe("walletError", () => {
  it("recognises a declined signature", () => {
    expect(walletError(new Error("User rejected the request."))).toMatch(/declined/);
  });

  it("hides raw wallet errors", () => {
    expect(walletError(new Error("WalletSignTransactionError: e3f1"))).not.toMatch(/e3f1/);
  });
});
