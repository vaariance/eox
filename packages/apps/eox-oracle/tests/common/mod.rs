use chrono::Utc;
use eox_oracle::types::Observation;

const COUNTRIES: [&str; 5] = ["CHN", "DEU", "GHA", "NGA", "USA"];
const INDICATORS: [&str; 5] = [
    "gdp_real_growth_yoy",
    "cpi_headline_yoy",
    "unemployment_rate",
    "overnight_lending_rates",
    "fiscal_deficit_gdp",
];

pub fn full_observations() -> Vec<Observation> {
    let now = Utc::now();
    let mut observations = Vec::new();
    for (ci, country) in COUNTRIES.iter().enumerate() {
        for (ii, indicator) in INDICATORS.iter().enumerate() {
            observations.push(Observation {
                country_iso3: country.to_string(),
                indicator_id: indicator.to_string(),
                period_start: "2025-01-01".to_string(),
                period_end: "2025-12-31".to_string(),
                value: format!("{}.5", (ci * 3 + ii * 7) % 11 + 1),
                source_id: "official".to_string(),
                vintage: "first".to_string(),
                published_at: now,
                known_at: now,
                recipe_id: Some(1),
                raw_sha256: Some(
                    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
                ),
            });
        }
    }
    observations
}
