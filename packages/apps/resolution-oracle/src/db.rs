use crate::error::OracleError;
use crate::types::Observation;
use chrono::{DateTime, Utc};
use tokio_postgres::{Client, NoTls};

pub async fn connect(connection_str: &str) -> Result<Client, OracleError> {
    let (client, connection) = tokio_postgres::connect(connection_str, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("Database connection error: {}", e);
        }
    });
    Ok(client)
}

pub async fn get_as_of(
    client: &Client,
    as_of: DateTime<Utc>,
    universe: &[String],
    indicators: &[String],
) -> Result<Vec<Observation>, OracleError> {
    let query = "
        SELECT DISTINCT ON (country_iso3, indicator_id)
            country_iso3,
            indicator_id,
            to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end,
            value::text AS value,
            source_id,
            vintage,
            published_at,
            known_at,
            recipe_id,
            raw_sha256
        FROM observations
        WHERE known_at <= $1
          AND country_iso3 = ANY($2)
          AND indicator_id = ANY($3)
        ORDER BY country_iso3, indicator_id, known_at DESC, id DESC
    ";

    let rows = client
        .query(query, &[&as_of, &universe, &indicators])
        .await?;

    let mut observations = Vec::new();
    for row in rows {
        observations.push(Observation {
            country_iso3: row.get("country_iso3"),
            indicator_id: row.get("indicator_id"),
            period_start: row.get("period_start"),
            period_end: row.get("period_end"),
            value: row.get("value"),
            source_id: row.get("source_id"),
            vintage: row.get("vintage"),
            published_at: row.get("published_at"),
            known_at: row.get("known_at"),
            recipe_id: row.get("recipe_id"),
            raw_sha256: row.get("raw_sha256"),
        });
    }

    Ok(observations)
}
