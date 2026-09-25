use crate::error::EngineError;
use crate::fixed_point::{Wad, WAD};
use crate::merkle::compute_evidence_root;
use crate::types::{CountryScore, IndicatorTrace, OutputBundle, RelativeScore, Snapshot};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct MethodologyConfig {
    pub universe: Vec<String>,
    pub indicator_weights: BTreeMap<String, Wad>,
    pub indicator_polarities: BTreeMap<String, Wad>,
    pub optional_indicators: BTreeSet<String>,
}

pub fn get_methodology_config(version: &str) -> Result<MethodologyConfig, EngineError> {
    match version {
        "v0.1" => {
            let mut weights = BTreeMap::new();
            let mut polarities = BTreeMap::new();

            weights.insert("gdp_real_growth_yoy".to_string(), Wad::ONE);
            polarities.insert("gdp_real_growth_yoy".to_string(), Wad::ONE);

            weights.insert("cpi_core_yoy".to_string(), Wad::ONE);
            polarities.insert("cpi_core_yoy".to_string(), Wad(-WAD));

            weights.insert("unemployment_rate".to_string(), Wad::ONE);
            polarities.insert("unemployment_rate".to_string(), Wad(-WAD));

            weights.insert("policy_rate".to_string(), Wad::ONE);
            polarities.insert("policy_rate".to_string(), Wad(-WAD));

            weights.insert("fiscal_deficit_gdp".to_string(), Wad::ONE);
            polarities.insert("fiscal_deficit_gdp".to_string(), Wad(-WAD));

            Ok(MethodologyConfig {
                universe: vec![
                    "CHN".to_string(),
                    "IND".to_string(),
                    "NGA".to_string(),
                    "USA".to_string(),
                ],
                indicator_weights: weights,
                indicator_polarities: polarities,
                optional_indicators: BTreeSet::new(),
            })
        }
        _ => Err(EngineError::InvalidMethodologyVersion(version.to_string())),
    }
}

pub fn evaluate_methodology(
    snapshot: &Snapshot,
    epoch_id: &str,
    version: &str,
    methodology_image_id: [u8; 32],
) -> Result<OutputBundle, EngineError> {
    let config = get_methodology_config(version)?;

    let computed_root = compute_evidence_root(&snapshot.observations)?;
    if snapshot.evidence_root != [0u8; 32] && snapshot.evidence_root != computed_root {
        return Err(EngineError::EvidenceRootMismatch);
    }

    let mut observation_map: BTreeMap<(&str, &str), (Wad, &str)> = BTreeMap::new();
    let mut indicator_values: BTreeMap<&str, Vec<Wad>> = BTreeMap::new();

    for obs in &snapshot.observations {
        let country = obs.country_iso3.as_str();
        let indicator = obs.indicator_id.as_str();
        if !config.universe.iter().any(|c| c == country) {
            return Err(EngineError::UnknownCountry(country.to_string()));
        }
        if !config.indicator_weights.contains_key(indicator)
            || !config.indicator_polarities.contains_key(indicator)
        {
            return Err(EngineError::UnknownIndicator(indicator.to_string()));
        }
        let parsed = Wad::from_decimal_str(&obs.value)?;
        if observation_map
            .insert((country, indicator), (parsed, obs.value.as_str()))
            .is_some()
        {
            return Err(EngineError::DuplicateObservation {
                country: country.to_string(),
                indicator: indicator.to_string(),
            });
        }
        indicator_values.entry(indicator).or_default().push(parsed);
    }

    for country in &config.universe {
        for indicator in indicator_values.keys() {
            if !config.optional_indicators.contains(*indicator)
                && !observation_map.contains_key(&(country.as_str(), *indicator))
            {
                return Err(EngineError::ObservationNotFound {
                    country: country.clone(),
                    indicator: indicator.to_string(),
                });
            }
        }
    }

    let mut stats: BTreeMap<&str, (Wad, Wad)> = BTreeMap::new();
    for (indicator, values) in &indicator_values {
        let count_wad = Wad::from_i128(values.len() as i128)?;

        let mut sum = Wad::ZERO;
        for val in values {
            sum = sum.checked_add(*val)?;
        }
        let mean = sum.checked_div(count_wad)?;

        let mut variance_sum = Wad::ZERO;
        for val in values {
            let diff = val.checked_sub(mean)?;
            variance_sum = variance_sum.checked_add(diff.checked_mul(diff)?)?;
        }

        let std_dev = variance_sum.checked_div(count_wad)?.isqrt()?;
        stats.insert(indicator, (mean, std_dev));
    }

    let mut country_scores_map: BTreeMap<&str, Wad> = BTreeMap::new();
    let mut attribution: Vec<IndicatorTrace> = Vec::new();

    for country in &config.universe {
        let mut total_score = Wad::ZERO;
        let mut indicator_count = 0i128;

        for (indicator, (mean, std_dev)) in &stats {
            let Some((val, raw)) = observation_map.get(&(country.as_str(), *indicator)) else {
                continue;
            };

            let raw_norm = if std_dev.0 > 0 {
                val.checked_sub(*mean)?.checked_div(*std_dev)?
            } else {
                Wad::ZERO
            };

            let polarity = config.indicator_polarities[*indicator];
            let weight = config.indicator_weights[*indicator];
            let normalized = raw_norm.checked_mul(polarity)?;
            total_score = total_score.checked_add(normalized.checked_mul(weight)?)?;
            indicator_count += 1;

            attribution.push(IndicatorTrace {
                country_iso3: country.clone(),
                indicator_id: indicator.to_string(),
                raw_value: raw.to_string(),
                normalized_score: normalized.to_string(),
                weight: weight.to_string(),
            });
        }

        let country_score = if indicator_count > 0 {
            total_score.checked_div(Wad::from_i128(indicator_count)?)?
        } else {
            Wad::ZERO
        };
        country_scores_map.insert(country, country_score);
    }

    let mut world_sum = Wad::ZERO;
    for score in country_scores_map.values() {
        world_sum = world_sum.checked_add(*score)?;
    }
    let world_benchmark = world_sum.checked_div(Wad::from_i128(country_scores_map.len() as i128)?)?;

    let mut country_scores = Vec::new();
    let mut relative_scores = Vec::new();

    for (country, score) in &country_scores_map {
        country_scores.push(CountryScore {
            country_iso3: country.to_string(),
            score: score.to_string(),
        });
        relative_scores.push(RelativeScore {
            country_iso3: country.to_string(),
            relative_performance: score.checked_sub(world_benchmark)?.to_string(),
        });
    }

    Ok(OutputBundle {
        epoch_id: epoch_id.to_string(),
        as_of: snapshot.as_of.to_rfc3339(),
        methodology_version: version.to_string(),
        evidence_root: computed_root,
        methodology_image_id,
        country_scores,
        world_benchmark: world_benchmark.to_string(),
        relative_scores,
        attribution,
    })
}
