use clap::{Parser, Subcommand};
use eox_oracle::engine::{evaluate_methodology, hash_output_bundle};
use eox_oracle::services::ProposerService;
use eox_oracle::types::Snapshot;
use std::fs;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "eox-oracle")]
#[command(about = "EOX Deterministic Resolution Oracle CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
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
    Propose {
        #[arg(short, long)]
        snapshot_file: PathBuf,
        #[arg(short, long)]
        epoch_id: String,
        #[arg(short, long, default_value = "v0.1")]
        version: String,
        #[arg(short, long, default_value = "oracle_proposer_1")]
        proposer: String,
        #[arg(short, long, default_value_t = 1000)]
        bond: u64,
        #[arg(short, long, default_value_t = 7200)]
        liveness: u64,
        #[arg(short, long)]
        methodology_image_id: String,
        #[arg(short, long)]
        resolution_uri: String,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::RunEngine {
            snapshot_file,
            epoch_id,
            version,
            methodology_image_id,
        } => {
            let content = fs::read_to_string(snapshot_file)?;
            let mut snapshot: Snapshot = serde_json::from_str(&content)?;
            let computed_root = eox_oracle::services::compute_evidence_root(&snapshot.observations)?;
            if snapshot.evidence_root != [0u8; 32] && snapshot.evidence_root != computed_root {
                return Err(format!(
                    "Supplied evidence root (0x{}) does not match computed root (0x{})",
                    hex::encode(snapshot.evidence_root),
                    hex::encode(computed_root)
                ).into());
            }
            snapshot.evidence_root = computed_root;
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
            snapshot_file,
            epoch_id,
            version,
            proposer,
            bond,
            liveness,
            methodology_image_id,
            resolution_uri,
        } => {
            let content = fs::read_to_string(snapshot_file)?;
            let mut snapshot: Snapshot = serde_json::from_str(&content)?;
            let computed_root = eox_oracle::services::compute_evidence_root(&snapshot.observations)?;
            if snapshot.evidence_root != [0u8; 32] && snapshot.evidence_root != computed_root {
                return Err(format!(
                    "Supplied evidence root (0x{}) does not match computed root (0x{})",
                    hex::encode(snapshot.evidence_root),
                    hex::encode(computed_root)
                ).into());
            }
            snapshot.evidence_root = computed_root;
            let image_id_bytes = hex::decode(methodology_image_id.trim_start_matches("0x"))?;
            let image_id: [u8; 32] = image_id_bytes
                .try_into()
                .map_err(|_| "methodology_image_id must be exactly 32 bytes (64 hex characters)")?;

            let (claim, bundle) = ProposerService::create_proposal(
                &snapshot,
                eox_oracle::services::ProposalParams {
                    epoch_id: &epoch_id,
                    version: &version,
                    methodology_image_id: image_id,
                    resolution_uri: &resolution_uri,
                    proposer: &proposer,
                    bond,
                    liveness_seconds: liveness,
                },
            )?;

            println!("Proposal created successfully:");
            println!("{}", serde_json::to_string_pretty(&claim)?);
            println!("\nOutput Bundle:");
            println!("{}", serde_json::to_string_pretty(&bundle)?);
        }
    }

    Ok(())
}
