use crate::engine::fixed_point::Wad;
use crate::error::OracleError;
use crate::types::{CountryScore, IndicatorTrace, OutputBundle, RelativeScore, Snapshot};
use std::collections::{BTreeMap, BTreeSet};

pub fn evaluate_methodology(
    snapshot: &Snapshot,
    epoch_id: &str,
    version: &str,
) -> Result<OutputBundle, OracleError> {
    let mut indicator_values: BTreeMap<String, Vec<Wad>> = BTreeMap::new();
    let mut observation_map: BTreeMap<(String, String), Wad> = BTreeMap::new();
    let mut raw_value_map: BTreeMap<(String, String), String> = BTreeMap::new();
    let mut countries: BTreeSet<String> = BTreeSet::new();
    let mut indicators: BTreeSet<String> = BTreeSet::new();

    for obs in &snapshot.observations {
        let parsed = Wad::from_decimal_str(&obs.value)?;
        countries.insert(obs.country_iso3.clone());
        indicators.insert(obs.indicator_id.clone());

        indicator_values
            .entry(obs.indicator_id.clone())
            .or_default()
            .push(parsed);

        observation_map.insert((obs.country_iso3.clone(), obs.indicator_id.clone()), parsed);
        raw_value_map.insert((obs.country_iso3.clone(), obs.indicator_id.clone()), obs.value.clone());
    }

    let mut stats: BTreeMap<String, (Wad, Wad)> = BTreeMap::new();
    for (indicator, values) in &indicator_values {
        let count = values.len() as i128;
        if count == 0 {
            continue;
        }
        let count_wad = Wad::from_i128(count)?;

        let mut sum = Wad::ZERO;
        for val in values {
            sum = sum.checked_add(*val)?;
        }
        let mean = sum.checked_div(count_wad)?;

        let mut variance_sum = Wad::ZERO;
        for val in values {
            let diff = val.checked_sub(mean)?;
            let diff_sq = diff.checked_mul(diff)?;
            variance_sum = variance_sum.checked_add(diff_sq)?;
        }
        let variance = variance_sum.checked_div(count_wad)?;
        let std_dev = variance.isqrt()?;

        stats.insert(indicator.clone(), (mean, std_dev));
    }

    let mut country_scores_map: BTreeMap<String, Wad> = BTreeMap::new();
    let mut attribution: Vec<IndicatorTrace> = Vec::new();

    for country in &countries {
        let mut total_score = Wad::ZERO;
        let mut indicator_count = 0;

        for indicator in &indicators {
            if let Some(&raw_val) = observation_map.get(&(country.clone(), indicator.clone())) {
                let (mean, std_dev) = stats.get(indicator).copied().unwrap_or((Wad::ZERO, Wad::ONE));

                let normalized = if std_dev.0 > 0 {
                    let diff = raw_val.checked_sub(mean)?;
                    diff.checked_div(std_dev)?
                } else {
                    Wad::ZERO
                };

                let weight = Wad::ONE;
                let weighted = normalized.checked_mul(weight)?;
                total_score = total_score.checked_add(weighted)?;
                indicator_count += 1;

                let raw_str = raw_value_map
                    .get(&(country.clone(), indicator.clone()))
                    .cloned()
                    .unwrap_or_else(|| raw_val.to_string());

                attribution.push(IndicatorTrace {
                    country_iso3: country.clone(),
                    indicator_id: indicator.clone(),
                    raw_value: raw_str,
                    normalized_score: normalized.to_string(),
                    weight: weight.to_string(),
                });
            }
        }

        let country_score = if indicator_count > 0 {
            total_score.checked_div(Wad::from_i128(indicator_count as i128)?)?
        } else {
            Wad::ZERO
        };

        country_scores_map.insert(country.clone(), country_score);
    }

    let mut world_sum = Wad::ZERO;
    let country_count = countries.len() as i128;
    for score in country_scores_map.values() {
        world_sum = world_sum.checked_add(*score)?;
    }

    let world_benchmark = if country_count > 0 {
        world_sum.checked_div(Wad::from_i128(country_count)?)?
    } else {
        Wad::ZERO
    };

    let mut country_scores = Vec::new();
    let mut relative_scores = Vec::new();

    for (country, score) in &country_scores_map {
        country_scores.push(CountryScore {
            country_iso3: country.clone(),
            score: score.to_string(),
        });

        let rel = score.checked_sub(world_benchmark)?;
        relative_scores.push(RelativeScore {
            country_iso3: country.clone(),
            relative_performance: rel.to_string(),
        });
    }

    Ok(OutputBundle {
        epoch_id: epoch_id.to_string(),
        as_of: snapshot.as_of.to_rfc3339(),
        methodology_version: version.to_string(),
        country_scores,
        world_benchmark: world_benchmark.to_string(),
        relative_scores,
        attribution,
    })
}
