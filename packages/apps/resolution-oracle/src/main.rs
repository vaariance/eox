use clap::{Parser, Subcommand};
use resolution_oracle::engine::{evaluate_methodology, hash_output_bundle};
use resolution_oracle::services::ProposerService;
use resolution_oracle::types::Snapshot;
use std::fs;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "resolution-oracle")]
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
        } => {
            let content = fs::read_to_string(snapshot_file)?;
            let snapshot: Snapshot = serde_json::from_str(&content)?;
            let bundle = evaluate_methodology(&snapshot, &epoch_id, &version)?;
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
        } => {
            let content = fs::read_to_string(snapshot_file)?;
            let snapshot: Snapshot = serde_json::from_str(&content)?;
            let image_id = [0u8; 32];
            let uri = format!("ipfs://resolution/{}/{}", epoch_id, version);

            let (claim, bundle) = ProposerService::create_proposal(
                &snapshot,
                &epoch_id,
                &version,
                image_id,
                &uri,
                &proposer,
                bond,
                liveness,
            )?;

            println!("Proposal created successfully:");
            println!("{}", serde_json::to_string_pretty(&claim)?);
            println!("\nOutput Bundle:");
            println!("{}", serde_json::to_string_pretty(&bundle)?);
        }
    }

    Ok(())
}
