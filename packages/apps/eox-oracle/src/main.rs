use clap::{Args, Parser, Subcommand};
use eox_oracle::bots::{self, ProposeOutcome, Verdict};
use eox_oracle::chain::RpcChain;
use eox_oracle::engine::{evaluate_methodology, hash_output_bundle};
use eox_oracle::types::Snapshot;
use solana_keypair::{read_keypair_file, Keypair};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "eox-oracle")]
#[command(about = "EOX Deterministic Resolution Oracle CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Args)]
struct Connection {
    /// RPC endpoint of the cluster the settlement program is deployed on.
    #[arg(long, default_value = "http://127.0.0.1:8899")]
    rpc: String,
    /// Keypair that signs and pays. Proposers and watchers also hold their bond in this
    /// wallet's associated token account for the bond mint.
    #[arg(long)]
    keypair: PathBuf,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the engine on a snapshot and print the evidence root, output hash and bundle.
    RunEngine {
        #[arg(short, long)]
        snapshot_file: PathBuf,
        #[arg(short, long)]
        epoch_id: String,
        #[arg(short, long, default_value = "v0.1")]
        version: String,
        #[arg(short, long)]
        methodology_image_id: String,
    },
    /// Post a claim for the epoch if it is accepting one.
    Propose {
        #[command(flatten)]
        connection: Connection,
        #[arg(long)]
        year: u16,
        #[arg(long)]
        snapshot_file: PathBuf,
        /// Where the snapshot and output bundle are published for watchers.
        #[arg(long)]
        resolution_uri: String,
        #[arg(long, default_value = "v0.1")]
        version: String,
    },
    /// Check the epoch's live claim against our own snapshot and challenge it if it differs.
    Watch {
        #[command(flatten)]
        connection: Connection,
        #[arg(long)]
        year: u16,
        #[arg(long)]
        snapshot_file: PathBuf,
        /// The snapshot the proposer published, needed to name a wrong observation.
        #[arg(long)]
        published_snapshot_file: Option<PathBuf>,
        /// Where our own snapshot and bundle are published, recorded with a challenge.
        #[arg(long)]
        resolution_uri: String,
        #[arg(long, default_value = "v0.1")]
        version: String,
    },
    /// Settle, void or burn for the epoch if a deadline has passed.
    Crank {
        #[command(flatten)]
        connection: Connection,
        #[arg(long)]
        year: u16,
    },
}

type CliResult<T> = Result<T, Box<dyn std::error::Error>>;

fn load_snapshot(path: &Path) -> CliResult<Snapshot> {
    let mut snapshot: Snapshot = serde_json::from_str(&fs::read_to_string(path)?)?;
    let computed_root = eox_oracle::services::compute_evidence_root(&snapshot.observations)?;
    if snapshot.evidence_root != [0u8; 32] && snapshot.evidence_root != computed_root {
        return Err(format!(
            "Supplied evidence root (0x{}) does not match computed root (0x{})",
            hex::encode(snapshot.evidence_root),
            hex::encode(computed_root)
        )
        .into());
    }
    snapshot.evidence_root = computed_root;
    Ok(snapshot)
}

fn connect(connection: &Connection) -> CliResult<(RpcChain, Keypair)> {
    let keypair = read_keypair_file(&connection.keypair)
        .map_err(|e| format!("cannot read keypair {}: {e}", connection.keypair.display()))?;
    Ok((RpcChain::new(&connection.rpc), keypair))
}

fn main() -> CliResult<()> {
    match Cli::parse().command {
        Commands::RunEngine {
            snapshot_file,
            epoch_id,
            version,
            methodology_image_id,
        } => {
            let snapshot = load_snapshot(&snapshot_file)?;
            let image_id_bytes = hex::decode(methodology_image_id.trim_start_matches("0x"))?;
            let image_id: [u8; 32] = image_id_bytes
                .try_into()
                .map_err(|_| "methodology_image_id must be exactly 32 bytes (64 hex characters)")?;

            let bundle = evaluate_methodology(&snapshot, &epoch_id, &version, image_id)?;
            let ho = hash_output_bundle(&bundle)?;

            println!("Evidence Root R: 0x{}", hex::encode(snapshot.evidence_root));
            println!("Claim Hash Ho:   0x{}", hex::encode(ho));
            println!("\nOutput Bundle:\n{}", serde_json::to_string_pretty(&bundle)?);
        }
        Commands::Propose {
            connection,
            year,
            snapshot_file,
            resolution_uri,
            version,
        } => {
            let (mut chain, proposer) = connect(&connection)?;
            let snapshot = load_snapshot(&snapshot_file)?;
            match bots::propose(&mut chain, year, &proposer, &snapshot, &version, &resolution_uri)? {
                ProposeOutcome::Proposed(body) => println!(
                    "Proposed epoch {year}: evidence root 0x{}, output hash 0x{}",
                    hex::encode(body.evidence_root),
                    hex::encode(body.output_hash)
                ),
                ProposeOutcome::NotAccepting => println!("Epoch {year} is not accepting a proposal"),
            }
        }
        Commands::Watch {
            connection,
            year,
            snapshot_file,
            published_snapshot_file,
            resolution_uri,
            version,
        } => {
            let (mut chain, disputer) = connect(&connection)?;
            let ours = load_snapshot(&snapshot_file)?;
            let published = published_snapshot_file.as_deref().map(load_snapshot).transpose()?;
            let verdict = bots::watch(
                &mut chain,
                year,
                &disputer,
                &ours,
                published.as_ref(),
                &version,
                &resolution_uri,
            )?;
            match verdict {
                None => println!("Epoch {year} has no claim open to challenge"),
                Some(Verdict::Agrees) => println!("The claim for epoch {year} matches our evidence"),
                Some(Verdict::Dispute { grounds, .. }) => {
                    println!("Challenged the claim for epoch {year}: {grounds:?}")
                }
                Some(Verdict::CannotVerify(reason)) => {
                    eprintln!("The claim for epoch {year} differs from ours: {reason}");
                    std::process::exit(2);
                }
            }
        }
        Commands::Crank { connection, year } => {
            let (mut chain, payer) = connect(&connection)?;
            match bots::crank(&mut chain, year, &payer)? {
                Some(action) => println!("Epoch {year}: {action:?}"),
                None => println!("Epoch {year}: nothing due"),
            }
        }
    }
    Ok(())
}
