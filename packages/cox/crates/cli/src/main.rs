use cox_math::*;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::{
    error::Error,
    io::{self, Read},
    str::FromStr,
};

#[derive(Debug, Clone)]
struct Decimal<T>(T);
impl<'de, T> Deserialize<'de> for Decimal<T>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let value = String::deserialize(d)?;
        if value.is_empty()
            || value.len() > 40
            || value.bytes().any(|b| !b.is_ascii_digit())
            || (value.len() > 1 && value.starts_with('0'))
        {
            return Err(serde::de::Error::custom(
                "expected canonical nonnegative decimal string",
            ));
        }
        value.parse().map(Decimal).map_err(serde::de::Error::custom)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassInput {
    backing: Decimal<u64>,
    units: Decimal<u128>,
}
impl From<ClassInput> for Class {
    fn from(v: ClassInput) -> Self {
        Self {
            backing: v.backing.0,
            units: v.units.0,
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum RequestInput {
    Deposit {
        id: String,
        to: usize,
        amount: Decimal<u64>,
        minimum: Decimal<u128>,
        expiry: u64,
    },
    Redeem {
        id: String,
        from: usize,
        units: Decimal<u128>,
        minimum: Decimal<u64>,
        expiry: u64,
    },
    Switch {
        id: String,
        from: usize,
        to: usize,
        units: Decimal<u128>,
        minimum: Decimal<u128>,
        expiry: u64,
    },
}
impl From<RequestInput> for Request {
    fn from(v: RequestInput) -> Self {
        match v {
            RequestInput::Deposit {
                id,
                to,
                amount,
                minimum,
                expiry,
            } => Self {
                id,
                expiry,
                operation: Operation::Deposit {
                    to,
                    amount: amount.0,
                    min_units: minimum.0,
                },
            },
            RequestInput::Redeem {
                id,
                from,
                units,
                minimum,
                expiry,
            } => Self {
                id,
                expiry,
                operation: Operation::Redeem {
                    from,
                    units: units.0,
                    min_proceeds: minimum.0,
                },
            },
            RequestInput::Switch {
                id,
                from,
                to,
                units,
                minimum,
                expiry,
            } => Self {
                id,
                expiry,
                operation: Operation::Switch {
                    from,
                    to,
                    units: units.0,
                    min_units: minimum.0,
                },
            },
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferenceInput {
    previous: Vec<Decimal<u64>>,
    current: Vec<Decimal<u64>>,
    origin: Vec<Decimal<u64>>,
    previous_benchmark: Decimal<i128>,
    #[serde(default)]
    previous_batch: Option<u64>,
    #[serde(default)]
    missed_batches: Vec<u64>,
    #[serde(default)]
    publication_batch: Option<u64>,
}
impl ReferenceInput {
    fn calculate(&self) -> Result<Reference> {
        if let (Some(previous), Some(current)) = (self.previous_batch, self.publication_batch) {
            if current <= previous
                || self
                    .missed_batches
                    .iter()
                    .any(|b| *b <= previous || *b >= current)
            {
                return Err(MathError::InvalidReferenceInput);
            }
        }
        reference(
            &self.previous.iter().map(|v| v.0).collect::<Vec<_>>(),
            &self.current.iter().map(|v| v.0).collect::<Vec<_>>(),
            &self.origin.iter().map(|v| v.0).collect::<Vec<_>>(),
            self.previous_benchmark.0,
        )
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevalueInput {
    classes: Vec<ClassInput>,
    h: Vec<Decimal<i128>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BatchInput {
    classes: Vec<ClassInput>,
    requests: Vec<RequestInput>,
    publication_batch: u64,
    #[serde(default)]
    pending: Option<Decimal<u64>>,
    #[serde(default)]
    vault: Option<Decimal<u64>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LedgerInput {
    vault: Decimal<u64>,
    active: Decimal<u64>,
    pending: Decimal<u64>,
    payable: Decimal<u64>,
    residual: Decimal<u64>,
}
impl From<LedgerInput> for Ledger {
    fn from(v: LedgerInput) -> Self {
        Self {
            vault: v.vault.0,
            active: v.active.0,
            pending: v.pending.0,
            payable: v.payable.0,
            residual: v.residual.0,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicationInput {
    reference: ReferenceInput,
    classes: Vec<ClassInput>,
    requests: Vec<RequestInput>,
    publication_batch: u64,
    ledger: LedgerInput,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PriceInput {
    asset_id: String,
    venue: u8,
    step: u8,
    candle_start: Decimal<u64>,
    price_e8: Decimal<u64>,
    trade_age_minutes: u16,
}
impl From<PriceInput> for Price {
    fn from(v: PriceInput) -> Self {
        Self {
            asset_id: v.asset_id,
            venue: v.venue,
            step: v.step,
            candle_start: v.candle_start.0,
            price_e8: v.price_e8.0,
            trade_age_minutes: v.trade_age_minutes,
        }
    }
}
fn classes_json(v: &[Class]) -> Value {
    Value::Array(
        v.iter()
            .map(|c| json!({"backing":c.backing.to_string(),"units":c.units.to_string()}))
            .collect(),
    )
}
fn reference_json(v: &Reference) -> Value {
    json!({"gross":v.gross.iter().map(ToString::to_string).collect::<Vec<_>>(),"benchmarkGross":v.benchmark_gross.to_string(),"benchmark":v.benchmark.to_string(),"relative":v.relative.iter().map(ToString::to_string).collect::<Vec<_>>(),"h":v.h.iter().map(ToString::to_string).collect::<Vec<_>>()})
}
fn batch_json(v: &BatchResult) -> Value {
    json!({"classes":classes_json(&v.classes),"payable":v.payable.to_string(),"refunds":v.refunds.to_string(),"residual":v.residual.to_string(),"receipts":v.receipts.iter().map(|r|json!({"id":r.id,"outcome":format!("{:?}",r.outcome),"minted":r.minted.to_string(),"proceeds":r.proceeds.to_string()})).collect::<Vec<_>>()})
}
fn ledger_json(v: &Ledger) -> Value {
    json!({"vault":v.vault.to_string(),"active":v.active.to_string(),"pending":v.pending.to_string(),"payable":v.payable.to_string(),"residual":v.residual.to_string()})
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|v| format!("{v:02x}")).collect()
}
fn calculate(command: &str, input: Value) -> std::result::Result<Value, Box<dyn Error>> {
    match command {
        "reference" => Ok(reference_json(
            &serde_json::from_value::<ReferenceInput>(input)?.calculate()?,
        )),
        "revalue" => {
            let v: RevalueInput = serde_json::from_value(input)?;
            let r = revalue(
                &v.classes.into_iter().map(Into::into).collect::<Vec<_>>(),
                &v.h.iter().map(|v| v.0).collect::<Vec<_>>(),
            )?;
            Ok(json!({"classes":classes_json(&r.classes),"residual":r.residual.to_string()}))
        }
        "batch" => {
            let v: BatchInput = serde_json::from_value(input)?;
            let classes = v.classes.into_iter().map(Into::into).collect::<Vec<_>>();
            let requests = v.requests.into_iter().map(Into::into).collect::<Vec<_>>();
            let result = batch(&classes, &requests, v.publication_batch)?;
            if let (Some(pending), Some(vault)) = (v.pending, v.vault) {
                let ledger = Ledger {
                    vault: vault.0,
                    active: classes.iter().map(|v| v.backing).try_fold(0u64, |a, b| {
                        a.checked_add(b).ok_or(MathError::ArithmeticOverflow)
                    })?,
                    pending: pending.0,
                    payable: 0,
                    residual: 0,
                };
                ledger.apply_batch(&result)?;
            }
            Ok(batch_json(&result))
        }
        "publication" => {
            let v: PublicationInput = serde_json::from_value(input)?;
            let reference = v.reference.calculate()?;
            let classes = v.classes.into_iter().map(Into::into).collect::<Vec<_>>();
            let ledger: Ledger = v.ledger.into();
            let marked = revalue(&classes, &reference.h)?;
            let marked_ledger = ledger.apply_revaluation(&marked)?;
            let result = batch(
                &marked.classes,
                &v.requests.into_iter().map(Into::into).collect::<Vec<_>>(),
                v.publication_batch,
            )?;
            let final_ledger = marked_ledger.apply_batch(&result)?;
            Ok(
                json!({"reference":reference_json(&reference),"revaluation":{"classes":classes_json(&marked.classes),"residual":marked.residual.to_string()},"batch":batch_json(&result),"ledger":ledger_json(&final_ledger)}),
            )
        }
        "verify-vectors" => {
            if input["schema"] != "COX/VECTORS/V1" {
                return Err("InvalidFixtureSchema".into());
            }
            let cases = input["cases"].as_array().ok_or("MissingCases")?;
            for case in cases {
                let kind = case["kind"].as_str().ok_or("MissingKind")?;
                let actual = calculate(kind, case["input"].clone())?;
                if actual != case["output"] {
                    return Err(format!("VectorMismatch: {}", case["name"]).into());
                }
            }
            let mut prices = Vec::new();
            let wire = input["wire"]["prices"].as_array().ok_or("MissingWire")?;
            for entry in wire {
                let price: Price =
                    serde_json::from_value::<PriceInput>(entry["input"].clone())?.into();
                let bytes = price_bytes(&price)?;
                if Value::String(hex(&bytes)) != entry["bytes"]
                    || Value::String(hex(&artifact_digest(&bytes))) != entry["digest"]
                {
                    return Err("PriceWireMismatch".into());
                }
                prices.push(price);
            }
            let snapshot = &input["wire"]["snapshot"];
            let cutoff = snapshot["cutoff"]
                .as_str()
                .ok_or("MissingCutoff")?
                .parse()?;
            let roster: Vec<String> = serde_json::from_value(snapshot["roster"].clone())?;
            let bytes = snapshot_bytes(cutoff, &prices, &roster)?;
            if Value::String(hex(&bytes)) != snapshot["bytes"]
                || Value::String(hex(&artifact_digest(&bytes))) != snapshot["digest"]
            {
                return Err("SnapshotWireMismatch".into());
            }
            Ok(
                json!({"status":"passed","arithmeticVectors":cases.len(),"priceVectors":wire.len(),"snapshotVectors":1}),
            )
        }
        _ => Err("UnknownCommand".into()),
    }
}
fn run() -> std::result::Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "help".into());
    if command == "help" {
        println!("cox reference | revalue | batch | publication | verify-vectors [input.json]; otherwise read stdin");
        return Ok(());
    }
    let input = if let Some(path) = args.next() {
        std::fs::read_to_string(path)?
    } else {
        let mut s = String::new();
        io::stdin().read_to_string(&mut s)?;
        s
    };
    if args.next().is_some() {
        return Err("UnexpectedArgument".into());
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&calculate(&command, serde_json::from_str(&input)?)?)?
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
