import anchor, { type Idl, type Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, type AccountMeta } from "@solana/web3.js";
import { mkdir, readFile } from "node:fs/promises";
import { atomicWrite } from "./journal.js";
import { join } from "node:path";
import { buildSlots, encodeEvidence, encodeRule, encodeSlot, evidenceDigest, evidenceDigestFromBytes, encodedEvidenceLength, type Configuration } from "./codec.js";
import type { EvidenceRecord, IndexReference, OracleTransport, ProposalProgress, ProposalStatus, SnapshotInput } from "./types.js";

const { AnchorProvider, BN, Wallet } = anchor;
const EMPTY = PublicKey.default;
interface Registry { nextSequence: anchor.BN; active: PublicKey; latest: PublicKey; paused: boolean; adapter: PublicKey; authority: PublicKey }
interface Epoch { sealed: boolean; configurationDigest: number[]; countries: number[][]; indicatorCounts: number[]; multiplier: number; baseline: anchor.BN[] }
interface Snapshot { status: number; cutoff: anchor.BN; sequence: anchor.BN; closed: boolean; pending: number; deadline: anchor.BN; evaluationTime: anchor.BN; eventCount: anchor.BN; eventDigest: number[]; predecessor: PublicKey }
interface Page { slots: Buffer[]; frozen: boolean; calculated: boolean }
interface RulePage { rules: Buffer[] }
interface Binding { sequence: string; snapshot: string; signatures: string[] }
const statuses: ProposalStatus[] = ["draft", "precommitted", "postcommitted", "calculating", "published", "rejected", "cancelled", "expired"];
const little = (value: string) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };

/** Real Anchor/RPC transport. No in-memory or simulated-chain fallback. */
export class SolanaTransport implements OracleTransport {
  readonly registry: PublicKey;
  readonly epoch: PublicKey;
  private configurationVerified = false;
  private constructor(readonly program: Program, readonly config: Configuration, private readonly directory: string) {
    this.registry = this.pda(Buffer.from("registry"));
    this.epoch = this.pda(Buffer.from("epoch"), little(config.epochId));
  }
  static async connect(rpc: string, idlFile: string, walletFile: string, config: Configuration, directory: string): Promise<SolanaTransport> {
    const idl = JSON.parse(await readFile(idlFile, "utf8")) as Idl;
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletFile, "utf8")) as number[]));
    const provider = new AnchorProvider(new Connection(rpc, "finalized"), new Wallet(payer), { commitment: "finalized", preflightCommitment: "confirmed" });
    return new SolanaTransport(new anchor.Program(idl, provider), config, directory);
  }
  private pda(...seeds: Uint8Array[]): PublicKey { return PublicKey.findProgramAddressSync(seeds, this.program.programId)[0]; }
  async chainTime(): Promise<number> {
    const clock = await this.program.provider.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    if (!clock || clock.data.length !== 40) throw new Error("RPC clock unavailable");
    const time = Number(clock.data.readBigInt64LE(32));
    if (!Number.isSafeInteger(time) || time < 0) throw new Error("InvalidChainClock");
    return time;
  }
  private base(snapshot?: PublicKey): Record<string, PublicKey> { return { registry: this.registry, epoch: this.epoch, authority: this.program.provider.publicKey!, systemProgram: SystemProgram.programId, ...(snapshot ? { snapshot } : {}) }; }
  private page(snapshot: PublicKey, country: number, page: number) { return { ...this.base(snapshot), rules: this.pda(Buffer.from("rules"), this.epoch.toBytes(), Uint8Array.of(country), Uint8Array.of(page)), pageAccount: this.pda(Buffer.from("page"), snapshot.toBytes(), Uint8Array.of(country), Uint8Array.of(page)) }; }
  private async account<T>(name: string, address: PublicKey, commitment: "confirmed" | "finalized" = "confirmed"): Promise<T | null> {
    const info = await this.program.provider.connection.getAccountInfo(address, commitment);
    if (!info) return null;
    if (!info.owner.equals(this.program.programId)) throw new Error("AccountOwnerMismatch");
    return this.program.coder.accounts.decode(name, info.data) as T;
  }
  private async send(method: string, args: unknown[], accounts: Record<string, PublicKey>, remaining: AccountMeta[] = [], program = this.program): Promise<string> {
    const factory = program.methods[method];
    if (!factory) throw new Error(`IDLMethodMissing:${method}`);
    const builder = factory(...args).accountsPartial(accounts).remainingAccounts(remaining);
    return builder.rpc({ commitment: method === "publish" ? "finalized" : "confirmed", preflightCommitment: "confirmed" });
  }
  async bootstrap(adapter: PublicKey): Promise<void> {
    let registry = await this.account<Registry>("registry", this.registry);
    if (!registry) { await this.send("initialize", [adapter], this.base()); registry = await this.account<Registry>("registry", this.registry); }
    if (!registry?.adapter.equals(adapter) || !registry.authority.equals(this.program.provider.publicKey!)) throw new Error("RegistryAuthorityMismatch");
    let epoch = await this.account<Epoch>("epoch", this.epoch);
    if (!epoch) {
      await this.send("createEpoch", [new BN(this.config.epochId), this.config.countries.map(c => [...Buffer.from(c.id)]), Buffer.from(this.config.countries.map(c => c.indicators.length)), this.config.multiplier], this.base());
      epoch = await this.account<Epoch>("epoch", this.epoch);
    }
    if (epoch!.multiplier !== this.config.multiplier || JSON.stringify(epoch!.countries) !== JSON.stringify(this.config.countries.map(c => [...Buffer.from(c.id)])) || JSON.stringify(Array.from(epoch!.indicatorCounts)) !== JSON.stringify(this.config.countries.map(c => c.indicators.length))) throw new Error("EpochConfigurationConflict");
    for (let c = 0; c < this.config.countries.length; c++) {
      const indicators = this.config.countries[c]!.indicators;
      for (let i = 0; i < indicators.length; i++) {
        const page = Math.floor(i / 8); const index = i % 8;
        const rules = this.pda(Buffer.from("rules"), this.epoch.toBytes(), Uint8Array.of(c), Uint8Array.of(page));
        const stored = await this.account<RulePage>("rulePage", rules);
        const encoded = encodeRule(indicators[i]!.rule);
        if (stored && index < stored.rules.length) { if (!Buffer.from(stored.rules[index]!).equals(encoded)) throw new Error("RuleConfigurationConflict"); continue; }
        if (epoch!.sealed) throw new Error("IncompleteSealedEpoch");
        await this.send("appendRule", [c, page, encoded], { ...this.base(), rules });
      }
    }
    if (!epoch!.sealed) await this.send("sealEpoch", [], this.base());
  }
  private async binding(input: SnapshotInput): Promise<Binding> {
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${input.proposalId}.json`);
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as Binding;
      try { value.signatures = JSON.parse(await readFile(join(this.directory, `${input.proposalId}.signatures.json`), "utf8")) as string[]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return value;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const registry = await this.account<Registry>("registry", this.registry);
    if (!registry) throw new Error("InitializeOracleFirst");
    if (registry.paused) throw new Error("OraclePaused");
    if (!registry.active.equals(EMPTY)) throw new Error("ForeignActiveProposal: recover its journal before starting another worker");
    if ((input.predecessor ?? EMPTY.toBase58()) !== registry.latest.toBase58()) throw new Error("StalePredecessor");
    const sequence = registry.nextSequence.toString();
    const binding = { sequence, snapshot: this.pda(Buffer.from("snapshot"), this.epoch.toBytes(), little(sequence)).toBase58(), signatures: [] };
    // Binding is durable before createSnapshot. A lost response always retries the same PDA.
    await atomicWrite(file, binding);
    return binding;
  }
  private async remember(input: SnapshotInput, binding: Binding, signature: string): Promise<void> {
    binding.signatures.push(signature);
    // Signatures are diagnostic; proposal/PDA binding was durably written before any send.
    await atomicWrite(join(this.directory, `${input.proposalId}.signatures.json`), binding.signatures);
  }
  private async verifyConfiguration(): Promise<void> {
    if (this.configurationVerified) return;
    const epoch = await this.account<Epoch>("epoch", this.epoch);
    if (!epoch?.sealed || epoch.multiplier !== this.config.multiplier || JSON.stringify(epoch.countries) !== JSON.stringify(this.config.countries.map(c => [...Buffer.from(c.id)])) || JSON.stringify(Array.from(epoch.indicatorCounts)) !== JSON.stringify(this.config.countries.map(c => c.indicators.length))) throw new Error("EpochConfigurationConflict");
    for (let c = 0; c < this.config.countries.length; c++) {
      const indicators = this.config.countries[c]!.indicators;
      for (let p = 0; p < Math.ceil(indicators.length / 8); p++) {
        const key = this.pda(Buffer.from("rules"), this.epoch.toBytes(), Uint8Array.of(c), Uint8Array.of(p));
        const page = await this.account<RulePage>("rulePage", key);
        const expected = indicators.slice(p * 8, p * 8 + 8);
        if (!page || page.rules.length !== expected.length || expected.some((rule, i) => !encodeRule(rule.rule).equals(Buffer.from(page.rules[i]!)))) throw new Error("RuleConfigurationConflict");
      }
    }
    this.configurationVerified = true;
  }
  private async publicationSignature(snapshot: PublicKey): Promise<string> {
    const signatures = await this.program.provider.connection.getSignaturesForAddress(snapshot, { limit: 100 }, "finalized");
    const parser = new anchor.EventParser(this.program.programId, this.program.coder);
    for (const item of signatures) {
      if (item.err) continue;
      const tx = await this.program.provider.connection.getTransaction(item.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      if (!tx?.meta?.logMessages) continue;
      for (const event of parser.parseLogs(tx.meta.logMessages)) {
        const published = event.data.snapshot as PublicKey | undefined;
        if (event.name === "referencePublished" && published?.equals(snapshot)) return item.signature;
      }
    }
    throw new Error("PublicationTransactionUnavailable: use an RPC with retained transaction history");
  }
  async advance(input: SnapshotInput): Promise<ProposalProgress> {
    await this.verifyConfiguration();
    const slots = buildSlots(this.config, input.records);
    const binding = await this.binding(input); const key = new PublicKey(binding.snapshot);
    let snapshot = await this.account<Snapshot>("snapshot", key);
    const send = async (method: string, args: unknown[], accounts = this.base(key), remaining: AccountMeta[] = []) => { await this.remember(input, binding, await this.send(method, args, accounts, remaining)); };
    if (!snapshot) { await send("createSnapshot", [new BN(binding.sequence), new BN(input.cutoff)]); snapshot = (await this.account<Snapshot>("snapshot", key))!; }
    if (snapshot.cutoff.toNumber() !== input.cutoff || snapshot.predecessor.toBase58() !== (input.predecessor ?? EMPTY.toBase58())) throw new Error("ProposalBindingConflict");
    if (snapshot.status === 0) {
      for (let c = 0; c < slots.length; c++) for (let p = 0; p < Math.ceil(slots[c]!.length / 8); p++) {
        const accounts = this.page(key, c, p); const pageSlots = slots[c]!.slice(p * 8, p * 8 + 8);
        let page = await this.account<Page>("evidencePage", accounts.pageAccount!);
        for (let index = 0; index < pageSlots.length; index++) {
          const slot = pageSlots[index]!;
          for (const evidence of [slot.current, ...(slot.comparison ? [slot.comparison] : [])]) {
            const history = this.pda(Buffer.from("history"), evidenceDigest(evidence));
            if (!await this.account("evidenceHistory", history)) await send("initializeHistory", [encodeEvidence(evidence)], { ...this.base(), history });
          }
          const encoded = encodeSlot(slot);
          if (page && index < page.slots.length) { if (!Buffer.from(page.slots[index]!).equals(encoded)) throw new Error("SlotRetryConflict"); }
          else await send("uploadSlot", [c, p, index, encoded], accounts);
        }
        if (!page?.frozen) await send("freezePage", [c, p], accounts);
      }
      await send("precommit", []);
      snapshot = (await this.account<Snapshot>("snapshot", key))!;
    }
    if (snapshot.status === 1 && snapshot.closed) { await send("postcommit", []); snapshot = (await this.account<Snapshot>("snapshot", key))!; }
    if (snapshot.status === 2 || snapshot.status === 3) {
      const slot = await this.program.provider.connection.getSlot("finalized");
      const now = await this.program.provider.connection.getBlockTime(slot);
      if (now !== null && now > snapshot.evaluationTime.toNumber() + 3600) { await send("expire", []); snapshot = (await this.account<Snapshot>("snapshot", key))!; }
      else {
        for (let c = 0; c < slots.length; c++) for (let p = 0; p < Math.ceil(slots[c]!.length / 8); p++) {
          const accounts = this.page(key, c, p);
          const page = await this.account<Page>("evidencePage", accounts.pageAccount!);
          if (page?.calculated) continue;
          const histories = slots[c]!.slice(p * 8, p * 8 + 8).flatMap(s => [s.current, ...(s.comparison ? [s.comparison] : [])]);
          await send("calculatePage", [c, p], accounts, histories.map(e => ({ pubkey: this.pda(Buffer.from("history"), evidenceDigest(e)), isWritable: false, isSigner: false })));
        }
        await send("publish", []); snapshot = (await this.account<Snapshot>("snapshot", key))!;
      }
    }
    // A rejected proposal retains the active registry lock until explicit adapter closure.
    const status = snapshot.status === 5 && !snapshot.closed ? "precommitted" : statuses[snapshot.status];
    if (!status) throw new Error("UnknownProposalStatus");
    if (["rejected", "cancelled", "expired"].includes(status)) {
      const finalized = await this.account<Snapshot>("snapshot", key, "finalized");
      if (!finalized || finalized.status !== snapshot.status || (status === "rejected" && !finalized.closed)) {
        return { status: "precommitted", transactionSignatures: binding.signatures };
      }
    }
    let publication: ProposalProgress["publication"];
    if (status === "published") {
      const finalized = await this.account<Snapshot>("snapshot", key, "finalized");
      if (finalized?.status !== 4) return { status: "calculating", transactionSignatures: binding.signatures };
      snapshot = finalized;
      publication = { proposalId: input.proposalId, sequence: snapshot.sequence.toNumber(), epoch: this.epoch.toBase58(), methodology: Buffer.from((await this.account<Epoch>("epoch", this.epoch))!.configurationDigest).toString("hex"), cutoff: input.cutoff, postcommittedAt: snapshot.evaluationTime.toNumber(), signature: await this.publicationSignature(key), finalized: true, snapshotAddress: key.toBase58() };
    }
    return { status, transactionSignatures: binding.signatures, publication };
  }
  async inspect(snapshot?: string): Promise<unknown> {
    const registry = await this.account<Registry>("registry", this.registry, "finalized");
    const address = snapshot ? new PublicKey(snapshot) : registry?.latest;
    return address && !address.equals(EMPTY) ? this.account("snapshot", address, "finalized") : registry;
  }
  async previewInput(snapshotAddress: string, records: EvidenceRecord[]): Promise<unknown> {
    const snapshot = await this.account<Snapshot>("snapshot", new PublicKey(snapshotAddress));
    const epoch = await this.account<Epoch>("epoch", this.epoch);
    if (!snapshot || !epoch || snapshot.status < 2) throw new Error("PreviewRequiresPostcommitment");
    const slots = buildSlots(this.config, records);
    const countries = [];
    for (let i = 0; i < slots.length; i++) {
      const histories = [];
      for (const slot of slots[i]!) {
        const pair = [];
        for (const evidence of [slot.current, slot.comparison]) {
          if (!evidence) { pair.push({ pending: 0, rejected: 0 }); continue; }
          const history = await this.account<{ pending: number; rejected: number }>("evidenceHistory", this.pda(Buffer.from("history"), evidenceDigest(evidence)));
          if (!history) throw new Error("MissingEvidenceHistory");
          pair.push({ pending: history.pending, rejected: history.rejected });
        }
        histories.push(pair);
      }
      countries.push({ id: this.config.countries[i]!.id, rules: this.config.countries[i]!.indicators.map(x => x.rule), slots: slots[i], histories });
    }
    return { evaluation_time: snapshot.evaluationTime.toNumber(), multiplier: this.config.multiplier, countries, baseline: epoch.baseline.length ? epoch.baseline.map(x => x.toString()) : null };
  }
  async readCountry(country: number, snapshot?: string): Promise<IndexReference> {
    const registry = await this.account<Registry>("registry", this.registry, "finalized");
    const address = snapshot ? new PublicKey(snapshot) : registry?.latest;
    if (!address || address.equals(EMPTY)) throw new Error("NoPublishedReference");
    const state = await this.account<Snapshot & { epoch: PublicKey; countries: { ratio: anchor.BN; change: anchor.BN; expressed: anchor.BN; referenceConfidence: anchor.BN }[] }>("snapshot", address, "finalized");
    if (!state || state.status !== 4 || !state.epoch.equals(this.epoch)) throw new Error("UnpublishedOrWrongEpoch");
    const value = state.countries[country];
    const identity = this.config.countries[country];
    if (!value || !identity) throw new Error("UnknownCountry");
    return { snapshot: address.toBase58(), epoch: this.epoch.toBase58(), base: identity.id, quote: "WORLD",
      ratio: value.ratio.toString(), change: value.change.toString(), expressed: value.expressed.toString(), confidence: value.referenceConfidence.toString() };
  }
  async readPair(snapshot: string, base: number, quote: number): Promise<IndexReference> {
    const method = this.program.methods.readPair;
    if (!method) throw new Error("IDLMethodMissing:readPair");
    const tx = await method(base, quote).accountsPartial({ epoch: this.epoch, snapshot: new PublicKey(snapshot) }).transaction();
    const simulation = await this.program.provider.simulate!(tx, [], "finalized");
    const returned = simulation.returnData;
    if (!returned || returned.programId !== this.program.programId.toBase58() || returned.data[1] !== "base64") throw new Error("MissingPairReturnData");
    const bytes = Buffer.from(returned.data[0], "base64");
    if (bytes.length !== 32) throw new Error("InvalidPairReturnData");
    return { snapshot, epoch: this.epoch.toBase58(), base: this.config.countries[base]!.id, quote: this.config.countries[quote]!.id,
      ratio: bytes.readBigInt64LE(0).toString(), change: bytes.readBigInt64LE(8).toString(), expressed: bytes.readBigInt64LE(16).toString(), confidence: bytes.readBigInt64LE(24).toString() };
  }
  async simulateChallenge(adapterWallet: string, snapshot: string, action: "register" | "upheld" | "invalid" | "close", challengeId: string, country = 0, page = 0, index = 0, comparison = false): Promise<string> {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(adapterWallet, "utf8")) as number[]));
    const provider = new AnchorProvider(this.program.provider.connection, new Wallet(keypair), { commitment: "finalized" });
    const program = new anchor.Program(this.program.idl, provider); const key = new PublicKey(snapshot);
    const common = { registry: this.registry, snapshot: key, adapter: keypair.publicKey, systemProgram: SystemProgram.programId };
    if (action === "close") {
      const s = (await this.account<Snapshot>("snapshot", key))!;
      return this.send("closeWindow", [s.eventCount, s.eventDigest], common, [], program);
    }
    const id = Buffer.from(challengeId, "hex"); if (id.length !== 32) throw new Error("ChallengeIdMustBe32Bytes");
    const challenge = this.pda(Buffer.from("challenge"), id);
    if (action === "register") {
      // Evidence digest supplied from the canonical uploaded slot, never from caller claims.
      const accounts = this.page(key, country, page); const p = (await this.account<Page>("evidencePage", accounts.pageAccount!))!;
      const raw = Buffer.from(p.slots[index]!); const currentLength = encodedEvidenceLength(raw);
      const encoded = comparison ? raw.subarray(currentLength + 1) : raw.subarray(0, currentLength);
      if (comparison && raw[currentLength] !== 1) throw new Error("MissingComparison");
      const digest = evidenceDigestFromBytes(encoded);
      const history = this.pda(Buffer.from("history"), digest);
      return this.send("registerChallenge", [[...id], [...digest], index, comparison], { ...common, challenge, history, pageAccount: accounts.pageAccount! }, [], program);
    }
    const receipt = await this.account<{ evidence: number[] }>("challenge", challenge);
    if (!receipt) throw new Error("ChallengeNotRegistered");
    return this.send("resolveChallenge", [action === "invalid"], { ...common, challenge, history: this.pda(Buffer.from("history"), Buffer.from(receipt.evidence)) }, [], program);
  }
}
