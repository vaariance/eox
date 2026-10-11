use anchor_lang_idl::build::IdlBuilder;
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("Expected absolute COX workspace path")?,
    );
    let idl = IdlBuilder::new()
        .program_path(root.join("programs/cox"))
        .no_docs(true)
        .resolution(true)
        .skip_lint(true)
        .build()?;
    fs::create_dir_all(root.join("idl"))?;
    fs::write(
        root.join("idl/cox.json"),
        format!("{}\n", serde_json::to_string_pretty(&idl)?),
    )?;
    Ok(())
}
