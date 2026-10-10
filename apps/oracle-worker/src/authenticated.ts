import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import anchor, { type Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { atomicWrite, Journal } from "./journal.js";
import { encodeEvidenceClaim, encodeSnapshotClaim, evidenceClaimDigest, snapshotClaimDigest, type EvidenceClaim, type SnapshotClaim, type RelayMessage, relayMessageDigest, encodeRelayMessage } from "./protocol.js";

export interface AuthenticatedBinding {
  program: string;
  proposal: string;
  receiver: string;
}
export interface AuthenticatedOperation {
  id: string;
  instruction: TransactionInstruction;
  finalized: () => Promise<boolean>;
}
interface StoredOperation {
  instructionDigest: string;
  signature: string | null;
  complete: boolean;
}
interface AuthenticatedState {
  version: 1;
  binding: AuthenticatedBinding;
  operations: Record<string, StoredOperation>;
  plans: Record<string, string>;
}
export interface ClaimUpload {
  digest: number[];
  bytes: Buffer;
}
export function evidenceClaimUpload(claim: EvidenceClaim): ClaimUpload {
  return { digest: [...evidenceClaimDigest(claim)], bytes: encodeEvidenceClaim(claim) };
}
export function snapshotClaimUpload(claim: SnapshotClaim): ClaimUpload {
  return { digest: [...snapshotClaimDigest(claim)], bytes: encodeSnapshotClaim(claim) };
}
export function instructionDigest(instruction: TransactionInstruction): string {
  const length = Buffer.alloc(4); length.writeUInt32LE(instruction.keys.length);
  return createHash("sha256").update(Buffer.concat([
    Buffer.from("EOX/WORKER/AUTHENTICATED-INSTRUCTION/V1\0"), instruction.programId.toBuffer(), length,
    ...instruction.keys.map(key => Buffer.concat([key.pubkey.toBuffer(), Buffer.from([Number(key.isSigner), Number(key.isWritable)])])),
    instruction.data,
  ])).digest("hex");
}
export function transactionSize(instruction: TransactionInstruction, payer: PublicKey): number {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() }).add(instruction);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}
export class AuthenticatedProgress {
  private readonly binding: AuthenticatedBinding;
  constructor(readonly path: string, binding: AuthenticatedBinding) {
    this.binding = { program: new PublicKey(binding.program).toBase58(), proposal: new PublicKey(binding.proposal).toBase58(), receiver: new PublicKey(binding.receiver).toBase58() };
  }
  private async load(): Promise<AuthenticatedState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as AuthenticatedState;
      if (!state || state.version !== 1 || !state.binding || !state.operations || !state.plans || state.binding.program !== this.binding.program || state.binding.proposal !== this.binding.proposal || state.binding.receiver !== this.binding.receiver) throw new Error("AuthenticatedJournalBindingConflict");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, binding: this.binding, operations: {}, plans: {} };
      throw error;
    }
  }
  async freezePlan(id: string, digest: string): Promise<void> {
    if (!id || ["__proto__", "constructor", "prototype"].includes(id) || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("InvalidAuthenticatedPlan");
    const unlock = await new Journal(this.path).lock();
    try {
      const state = await this.load();
      const previous = Object.hasOwn(state.plans, id) ? state.plans[id] : undefined;
      if (previous !== undefined && previous !== digest) throw new Error("AuthenticatedPlanConflict");
      state.plans[id] = digest;
      await atomicWrite(this.path, state);
    } finally { await unlock(); }
  }
  async run(operation: AuthenticatedOperation, submit: (instruction: TransactionInstruction) => Promise<string>): Promise<{ signature: string | null; recovered: boolean }> {
    if (!operation.id || operation.id.length > 256 || ["__proto__", "constructor", "prototype"].includes(operation.id)) throw new Error("InvalidAuthenticatedOperationId");
    if (operation.instruction.programId.toBase58() !== this.binding.program) throw new Error("AuthenticatedProgramMismatch");
    const unlock = await new Journal(this.path).lock();
    try {
      const state = await this.load();
      const digest = instructionDigest(operation.instruction);
      let saved = Object.hasOwn(state.operations, operation.id) ? state.operations[operation.id]! : undefined;
      if (saved && saved.instructionDigest !== digest) throw new Error("AuthenticatedOperationConflict");
      if (!saved) {
        saved = { instructionDigest: digest, signature: null, complete: false };
        state.operations[operation.id] = saved;
        await atomicWrite(this.path, state);
      }
      if (await operation.finalized()) {
        saved.complete = true;
        await atomicWrite(this.path, state);
        return { signature: saved.signature, recovered: true };
      }
      if (saved.complete) throw new Error("FinalizedAuthenticatedStateMissing");
      saved.signature = await submit(operation.instruction);
      await atomicWrite(this.path, state);
      if (!await operation.finalized()) throw new Error("AuthenticatedOperationNotFinalized");
      saved.complete = true;
      await atomicWrite(this.path, state);
      return { signature: saved.signature, recovered: false };
    } finally { await unlock(); }
  }
}
export class AuthenticatedSender {
  constructor(readonly program: Program, readonly progress: AuthenticatedProgress) {}
  async run(operation: AuthenticatedOperation): Promise<{ signature: string | null; recovered: boolean }> {
    const provider = this.program.provider;
    if (!provider.publicKey || !provider.sendAndConfirm) throw new Error("AuthenticatedTransactionProviderRequired");
    if (transactionSize(operation.instruction, provider.publicKey) > 1232) throw new Error("AuthenticatedTransactionTooLarge");
    return this.progress.run(operation, instruction => provider.sendAndConfirm!(new Transaction().add(instruction), [], { commitment: "finalized", preflightCommitment: "confirmed" }));
  }
}

export interface ReceiverSettings {
  wormholeProgram: PublicKey;
  evmChainId: string;
  wormholeChain: number;
  emitter: number[];
  adapter: number[];
  uma: number[];
  consistencyLevel: number;
  schemaVersion: number;
  methodologyManifest: number[];
  evidencePolicy: number[];
}
function little64(value: string): Buffer {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("InvalidReceiverInteger");
  const n = BigInt(value); if (n > 0xffffffffffffffffn) throw new Error("InvalidReceiverInteger");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(n); return bytes;
}
function fixed(value: number[], length: number): Buffer {
  if (value.length !== length || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("InvalidReceiverBytes");
  return Buffer.from(value);
}
export class ReceiverAddresses {
  readonly registry: PublicKey;
  readonly receiver: PublicKey;
  readonly auth: PublicKey;
  readonly epochAuth: PublicKey;
  constructor(readonly programId: PublicKey, readonly epoch: PublicKey, readonly snapshot: PublicKey, readonly receiverId: string, readonly evmChainId: string, readonly uma: number[]) {
    this.registry = this.pda(Buffer.from("registry"));
    this.receiver = this.pda(Buffer.from("receiver"), this.registry.toBuffer(), little64(receiverId));
    this.epochAuth = this.pda(Buffer.from("epoch-auth"), epoch.toBuffer());
    this.auth = this.pda(Buffer.from("authenticated"), snapshot.toBuffer());
    little64(evmChainId); fixed(uma, 20);
  }
  private pda(...seeds: Uint8Array[]): PublicKey { return PublicKey.findProgramAddressSync(seeds, this.programId)[0]; }
  claim(digest: number[]): PublicKey { return this.pda(Buffer.from("claim"), this.receiver.toBuffer(), fixed(digest, 32)); }
  assertion(id: number[]): PublicKey { return this.pda(Buffer.from("assertion"), little64(this.evmChainId), fixed(this.uma, 20), fixed(id, 32)); }
  binding(country: number, indicator: number, comparison: boolean): PublicKey {
    this.page(country, indicator);
    return this.pda(Buffer.from("binding"), this.auth.toBuffer(), Buffer.from([country]), Buffer.from([indicator]), Buffer.from([Number(comparison)]));
  }
  membership(id: number[]): PublicKey { return this.pda(Buffer.from("membership"), this.auth.toBuffer(), this.assertion(id).toBuffer()); }
  receipt(eventNumber: string): PublicKey { return this.pda(Buffer.from("relay"), this.auth.toBuffer(), little64(eventNumber)); }
  history(digest: number[]): PublicKey { return this.pda(Buffer.from("history"), fixed(digest, 32)); }
  page(country: number, indicator: number): PublicKey {
    if (!Number.isInteger(country) || country < 0 || country >= 30 || !Number.isInteger(indicator) || indicator < 0 || indicator >= 32) throw new Error("InvalidReceiverSlot");
    return this.pda(Buffer.from("page"), this.snapshot.toBuffer(), Buffer.from([country]), Buffer.from([Math.floor(indicator / 8)]));
  }
}
export class AuthenticatedInstructions {
  constructor(readonly program: Program, readonly addresses: ReceiverAddresses, readonly payer: PublicKey) {
    if (!program.programId.equals(addresses.programId)) throw new Error("AuthenticatedProgramMismatch");
  }
  private async instruction(name: string, args: unknown[], extra: Record<string, PublicKey | null> = {}): Promise<TransactionInstruction> {
    const factory = this.program.methods[name]; if (!factory) throw new Error(`IDLMethodMissing:${name}`);
    const a = this.addresses;
    return factory(...args).accountsPartial({ registry: a.registry, epoch: a.epoch, epochAuth: a.epochAuth, snapshot: a.snapshot, receiver: a.receiver, auth: a.auth, authority: this.payer, payer: this.payer, systemProgram: SystemProgram.programId, ...extra }).instruction();
  }
  createReceiver(settings: ReceiverSettings): Promise<TransactionInstruction> {
    if (settings.evmChainId !== this.addresses.evmChainId || !fixed(settings.uma, 20).equals(fixed(this.addresses.uma, 20))) throw new Error("ReceiverSettingsMismatch");
    return this.instruction("createReceiver", [new anchor.BN(this.addresses.receiverId), { ...settings, evmChainId: new anchor.BN(settings.evmChainId) }]);
  }
  pinReceiver(): Promise<TransactionInstruction> { return this.instruction("pinReceiver", []); }
  uploadClaim(digest: number[], offset: number, bytes: Uint8Array): Promise<TransactionInstruction> {
    if (!Number.isInteger(offset) || offset < 0 || !bytes.length || bytes.length > 512 || offset + bytes.length > 4800) throw new Error("InvalidClaimChunk");
    return this.instruction("uploadClaim", [digest, offset, Buffer.from(bytes)], { claim: this.addresses.claim(digest) });
  }
  sealClaim(digest: number[]): Promise<TransactionInstruction> { return this.instruction("sealClaim", [], { claim: this.addresses.claim(digest) }); }
  precommitAuthenticated(): Promise<TransactionInstruction> { return this.instruction("precommitAuthenticated", []); }
  beginSnapshotClaim(): Promise<TransactionInstruction> { return this.instruction("beginSnapshotClaim", []); }
  bindClaim(country: number, indicator: number, comparison: boolean, claimDigest: number[], assertionId: number[]): Promise<TransactionInstruction> {
    return this.instruction("bindClaim", [country, indicator, comparison], { claim: this.addresses.claim(claimDigest), assertion: this.addresses.assertion(assertionId), membership: this.addresses.membership(assertionId), pageAccount: this.addresses.page(country, indicator), binding: this.addresses.binding(country, indicator, comparison) });
  }
  appendAssertion(assertionId: number[]): Promise<TransactionInstruction> {
    return this.instruction("appendAssertion", [], { assertion: this.addresses.assertion(assertionId), membership: this.addresses.membership(assertionId) });
  }
  auditAssertion(assertionId: number[]): Promise<TransactionInstruction> {
    return this.instruction("auditAssertion", [], { assertion: this.addresses.assertion(assertionId), membership: this.addresses.membership(assertionId) });
  }
  sealSnapshotClaim(): Promise<TransactionInstruction> { return this.instruction("sealSnapshotClaim", []); }
  receiveRelay(eventNumber: string, postedVaa: PublicKey): Promise<TransactionInstruction> {
    return this.instruction("receiveRelay", [new anchor.BN(eventNumber)], { receipt: this.addresses.receipt(eventNumber), postedVaa });
  }
  applyRelay(message: RelayMessage, evidenceDigest?: number[]): Promise<TransactionInstruction> {
    const event = message.event;
    const id = event.kind === "Closed" ? Array(32).fill(0) : event.assertion_id;
    const claim = event.kind === "Registered" && event.claim_kind === "Evidence" ? this.addresses.claim(event.claim_digest) : null;
    return this.instruction("applyRelay", [], { receipt: this.addresses.receipt(message.header.event_number), assertion: this.addresses.assertion(id), claim, history: evidenceDigest ? this.addresses.history(evidenceDigest) : null });
  }

}
interface ClaimAccount { receiver: PublicKey; digest: number[]; sealed: boolean; bytes: Buffer }
interface ProposalAccount { receiver: PublicKey; snapshot: PublicKey; started: boolean; frozen: boolean; incident: boolean; slotCursor: number; comparisonNext: boolean; claimDigest: number[] }
interface MembershipAccount { proposal: PublicKey; assertion: PublicKey; appended: boolean; audited: boolean }
export class AuthenticatedClient {
  readonly instructions: AuthenticatedInstructions;
  readonly sender: AuthenticatedSender;
  constructor(readonly program: Program, readonly addresses: ReceiverAddresses, journalPath: string) {
    if (!program.provider.publicKey) throw new Error("AuthenticatedTransactionProviderRequired");
    this.instructions = new AuthenticatedInstructions(program, addresses, program.provider.publicKey);
    this.sender = new AuthenticatedSender(program, new AuthenticatedProgress(journalPath, { program: program.programId.toBase58(), proposal: addresses.snapshot.toBase58(), receiver: addresses.receiver.toBase58() }));
  }
  private async account<T>(name: string, address: PublicKey): Promise<T | null> {
    const info = await this.program.provider.connection.getAccountInfo(address, "finalized");
    if (!info) return null;
    if (!info.owner.equals(this.program.programId)) throw new Error("AuthenticatedAccountOwnerMismatch");
    return this.program.coder.accounts.decode(name, info.data) as T;
  }
  private async proposal(): Promise<ProposalAccount | null> {
    const value = await this.account<ProposalAccount>("authenticatedProposal", this.addresses.auth);
    if (value && (!value.receiver.equals(this.addresses.receiver) || !value.snapshot.equals(this.addresses.snapshot))) throw new Error("AuthenticatedProposalMismatch");
    if (value?.incident) throw new Error("AuthenticatedReceiverIncident");
    return value;
  }
  async uploadEvidenceClaim(claim: EvidenceClaim): Promise<void> {
    const upload = evidenceClaimUpload(claim); const address = this.addresses.claim(upload.digest);
    if (upload.bytes.length > 4800) throw new Error("EvidenceClaimTooLarge");
    for (let offset = 0; offset < upload.bytes.length; offset += 512) {
      const bytes = upload.bytes.subarray(offset, offset + 512);
      await this.sender.run({ id: `claim:${address.toBase58()}:${offset}`, instruction: await this.instructions.uploadClaim(upload.digest, offset, bytes), finalized: async () => {
        const stored = await this.account<ClaimAccount>("authenticatedClaim", address);
        if (!stored) return false;
        if (!stored.receiver.equals(this.addresses.receiver) || !Buffer.from(stored.digest).equals(Buffer.from(upload.digest))) throw new Error("AuthenticatedClaimConflict");
        if (stored.bytes.length < offset + bytes.length) return false;
        if (!Buffer.from(stored.bytes).subarray(offset, offset + bytes.length).equals(bytes)) throw new Error("AuthenticatedClaimConflict");
        return true;
      } });
    }
    await this.sender.run({ id: `claim:${address.toBase58()}:seal`, instruction: await this.instructions.sealClaim(upload.digest), finalized: async () => {
      const stored = await this.account<ClaimAccount>("authenticatedClaim", address);
      if (!stored?.sealed) return false;
      if (!Buffer.from(stored.bytes).equals(upload.bytes)) throw new Error("AuthenticatedClaimConflict");
      return true;
    } });
  }
  async freezeSnapshotClaim(claim: SnapshotClaim, evidenceClaims: EvidenceClaim[]): Promise<void> {
    const encoded = snapshotClaimUpload(claim);
    await this.sender.progress.freezePlan("snapshot-claim", Buffer.from(encoded.digest).toString("hex"));
    if (!Buffer.from(claim.proposal).equals(this.addresses.snapshot.toBuffer())) throw new Error("AuthenticatedProposalMismatch");
    const claims = new Map<string, EvidenceClaim>();
    for (const value of evidenceClaims) {
      const key = JSON.stringify([value.record_id, value.evidence_digest, value.assessment_digest]);
      const prior = claims.get(key);
      if (prior && !evidenceClaimDigest(prior).equals(evidenceClaimDigest(value))) throw new Error("ConflictingEvidenceClaims");
      claims.set(key, value);
    }
    await this.sender.run({ id: "snapshot:begin", instruction: await this.instructions.beginSnapshotClaim(), finalized: async () => Boolean((await this.proposal())?.started) });
    for (let ordinal = 0; ordinal < claim.slots.length; ordinal++) {
      const slot = claim.slots[ordinal]!;
      for (const comparison of [false, true]) {
        const binding = comparison ? slot.comparison : slot.current; if (!binding) continue;
        const evidence = claims.get(JSON.stringify([binding.record_id, binding.evidence_digest, binding.assessment_digest]));
        if (!evidence) throw new Error("MissingEvidenceClaim");
        const digest = [...evidenceClaimDigest(evidence)];
        await this.sender.run({ id: `snapshot:bind:${ordinal}:${Number(comparison)}`, instruction: await this.instructions.bindClaim(slot.country, slot.indicator, comparison, digest, binding.assertion_id), finalized: async () => {
          const state = await this.proposal();
          return Boolean(state && (state.slotCursor > ordinal || (state.slotCursor === ordinal && !comparison && state.comparisonNext)));
        } });
      }
    }
    for (const assertionId of claim.evidence_assertions) {
      const membership = this.addresses.membership(assertionId);
      await this.sender.run({ id: `snapshot:append:${Buffer.from(assertionId).toString("hex")}`, instruction: await this.instructions.appendAssertion(assertionId), finalized: async () => Boolean((await this.account<MembershipAccount>("assertionMembership", membership))?.appended) });
    }
    await this.sender.run({ id: "snapshot:seal", instruction: await this.instructions.sealSnapshotClaim(), finalized: async () => {
      const state = await this.proposal(); if (!state?.frozen) return false;
      if (!Buffer.from(state.claimDigest).equals(Buffer.from(encoded.digest))) throw new Error("AuthenticatedSnapshotClaimConflict");
      return true;
    } });
  }
  async createReceiver(settings: ReceiverSettings): Promise<void> {
    const encoded = this.program.coder.types.encode("receiverSettings", { ...settings, evmChainId: new anchor.BN(settings.evmChainId) });
    await this.sender.run({ id: "receiver:create", instruction: await this.instructions.createReceiver(settings), finalized: async () => {
      const stored = await this.account<{ registry: PublicKey; epoch: PublicKey; id: anchor.BN; settings: unknown }>("receiverConfig", this.addresses.receiver);
      if (!stored) return false;
      if (!stored.registry.equals(this.addresses.registry) || !stored.epoch.equals(this.addresses.epoch) || stored.id.toString() !== this.addresses.receiverId || !this.program.coder.types.encode("receiverSettings", stored.settings).equals(encoded)) throw new Error("ReceiverSettingsMismatch");
      return true;
    } });
  }
  async pinReceiver(): Promise<void> {
    await this.sender.run({ id: "receiver:pin", instruction: await this.instructions.pinReceiver(), finalized: async () => Boolean(await this.proposal()) });
  }
  async precommit(): Promise<void> {
    await this.sender.run({ id: "snapshot:precommit", instruction: await this.instructions.precommitAuthenticated(), finalized: async () => {
      await this.proposal();
      const snapshot = await this.account<{ status: number }>("snapshot", this.addresses.snapshot);
      return Boolean(snapshot && snapshot.status > 0);
    } });
  }
  async receiveRelay(message: RelayMessage, postedVaa: PublicKey): Promise<void> {
    const digest = relayMessageDigest(message);
    const receiver = await this.account<{ settings: { wormholeProgram: PublicKey } }>("receiverConfig", this.addresses.receiver);
    const posted = await this.program.provider.connection.getAccountInfo(postedVaa, "finalized");
    const payload = encodeRelayMessage(message);
    if (!receiver || !posted || !posted.owner.equals(receiver.settings.wormholeProgram) || posted.data.length !== 95 + payload.length || !posted.data.subarray(0, 3).equals(Buffer.from("vaa")) || posted.data.readUInt32LE(91) !== payload.length || !posted.data.subarray(95).equals(payload)) throw new Error("PostedRelayPayloadMismatch");
    const receipt = this.addresses.receipt(message.header.event_number);
    await this.sender.run({ id: `relay:${message.header.event_number}:receive:${postedVaa.toBase58()}`, instruction: await this.instructions.receiveRelay(message.header.event_number, postedVaa), finalized: async () => {
      const auth = await this.account<ProposalAccount>("authenticatedProposal", this.addresses.auth);
      if (auth?.incident) return true;
      const value = await this.account<{ digest: number[] }>("authenticatedRelayReceipt", receipt);
      return Boolean(value && Buffer.from(value.digest).equals(digest));
    } });
    await this.proposal();
  }
  async applyRelay(message: RelayMessage): Promise<void> {
    const digest = relayMessageDigest(message);
    const receipt = this.addresses.receipt(message.header.event_number);
    const stored = await this.account<{ digest: number[] }>("authenticatedRelayReceipt", receipt);
    if (!stored || !Buffer.from(stored.digest).equals(digest)) throw new Error("AuthenticatedReceiptMismatch");
    let evidenceDigest: number[] | undefined;
    if (message.event.kind === "Disputed" || message.event.kind === "Settled") {
      const assertion = await this.account<{ snapshot: boolean; evidenceDigest: number[] }>("authenticatedAssertion", this.addresses.assertion(message.event.assertion_id));
      if (!assertion) throw new Error("AuthenticatedAssertionMissing");
      if (!assertion.snapshot) evidenceDigest = assertion.evidenceDigest;
    }
    await this.sender.run({ id: `relay:${message.header.event_number}:apply`, instruction: await this.instructions.applyRelay(message, evidenceDigest), finalized: async () => {
      const auth = await this.account<ProposalAccount>("authenticatedProposal", this.addresses.auth);
      if (auth?.incident) return true;
      return Boolean((await this.account<{ applied: boolean }>("authenticatedRelayReceipt", receipt))?.applied);
    } });
    await this.proposal();
  }
  async auditAssertions(assertionIds: number[][]): Promise<void> {
    for (const id of assertionIds) {
      await this.sender.run({ id: `assertion:${Buffer.from(id).toString("hex")}:audit`, instruction: await this.instructions.auditAssertion(id), finalized: async () => Boolean((await this.account<MembershipAccount>("assertionMembership", this.addresses.membership(id)))?.audited) });
    }
  }

}
