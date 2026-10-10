import { type Hex, bytesToHex, hexToBytes } from "viem";

const CONTEXT_LENGTH = 198;

export function snapshotEvidence(claim: Hex): Hex[] {
  const data = hexToBytes(claim);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = CONTEXT_LENGTH + 64;
  const fail = (): never => {
    throw new Error("InvalidSnapshotClaim");
  };
  const skip = (length: number) => {
    if (at + length > data.length) fail();
    at += length;
  };
  const u32 = () => {
    skip(4);
    return view.getUint32(at - 4, true);
  };
  const flag = () => {
    skip(1);
    const value = data[at - 1]!;
    if (value > 1) fail();
    return value === 1;
  };
  const binding = () => {
    skip(u32());
    skip(96);
  };

  if (flag()) skip(32);
  skip(8);
  for (let slots = u32(); slots > 0; slots--) {
    skip(2);
    binding();
    if (flag()) binding();
  }
  const evidence: Hex[] = [];
  for (let count = u32(); count > 0; count--) {
    skip(32);
    evidence.push(bytesToHex(data.subarray(at - 32, at)));
  }
  if (at !== data.length || evidence.length === 0) fail();
  return evidence;
}
