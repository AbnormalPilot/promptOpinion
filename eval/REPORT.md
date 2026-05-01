# Self-Learning Eval Report

Generated: 2026-05-01T05:20:33.204Z
Scenarios: 20

## Headline

| Metric | Cold | Warm | Delta |
|---|---|---|---|
| Brier score (lower better) | 0.052 | 0.039 | 0.014 |
| 0.5-threshold accuracy | 95.0% | 95.0% | 0.0% |
| In expected-band rate | 65.0% | 40.0% | -25.0% |

## Cold pass per scenario
- S01-dm-semaglutide-clean predicted=0.85 actual=1 in_band=true
- S02-dm-semaglutide-no-step predicted=0.08 actual=0 in_band=true
- S03-cardio-pcsk9 predicted=0.92 actual=1 in_band=false
- S04-onc-bcma-multiple-myeloma predicted=0.85 actual=1 in_band=true
- S05-pain-opioid-no-justification predicted=0.10 actual=0 in_band=true
- S06-psych-spravato predicted=0.85 actual=1 in_band=true
- S07-rare-spinraza-pediatric predicted=0.85 actual=1 in_band=true
- S08-off-label-no-compendium predicted=0.17 actual=0 in_band=true
- S09-renal-metformin-block predicted=0.05 actual=0 in_band=true
- S10-pregnancy-statin predicted=0.32 actual=0 in_band=false
- S11-geriatric-beers predicted=0.17 actual=0 in_band=true
- S12-appeal-prior-denial predicted=0.85 actual=1 in_band=false
- S13-quantity-limit predicted=0.80 actual=0 in_band=false
- S14-rare-genetic-test-required predicted=0.92 actual=1 in_band=true
- S15-cardio-eliquis-renal-borderline predicted=0.89 actual=1 in_band=false
- S16-onc-immuno-prior-irae predicted=0.85 actual=1 in_band=false
- S17-incomplete-data predicted=0.14 actual=0 in_band=true
- S18-pediatric-fluoroquinolone predicted=0.08 actual=0 in_band=true
- S19-strong-cardio-tnka predicted=0.85 actual=1 in_band=true
- S20-borderline-formulary predicted=0.85 actual=1 in_band=false

## Warm pass per scenario
- S01-dm-semaglutide-clean predicted=0.90 actual=1 in_band=true
- S02-dm-semaglutide-no-step predicted=0.02 actual=0 in_band=false
- S03-cardio-pcsk9 predicted=0.95 actual=1 in_band=false
- S04-onc-bcma-multiple-myeloma predicted=0.92 actual=1 in_band=true
- S05-pain-opioid-no-justification predicted=0.02 actual=0 in_band=true
- S06-psych-spravato predicted=0.92 actual=1 in_band=false
- S07-rare-spinraza-pediatric predicted=0.92 actual=1 in_band=false
- S08-off-label-no-compendium predicted=0.12 actual=0 in_band=true
- S09-renal-metformin-block predicted=0.05 actual=0 in_band=true
- S10-pregnancy-statin predicted=0.29 actual=0 in_band=false
- S11-geriatric-beers predicted=0.06 actual=0 in_band=true
- S12-appeal-prior-denial predicted=0.92 actual=1 in_band=false
- S13-quantity-limit predicted=0.78 actual=0 in_band=false
- S14-rare-genetic-test-required predicted=0.98 actual=1 in_band=false
- S15-cardio-eliquis-renal-borderline predicted=0.94 actual=1 in_band=false
- S16-onc-immuno-prior-irae predicted=0.92 actual=1 in_band=false
- S17-incomplete-data predicted=0.04 actual=0 in_band=true
- S18-pediatric-fluoroquinolone predicted=0.07 actual=0 in_band=true
- S19-strong-cardio-tnka predicted=0.92 actual=1 in_band=false
- S20-borderline-formulary predicted=0.92 actual=1 in_band=false

## Top weakness patterns harvested
(none)

## Reliability (warm)
- bin 0.0-0.2: predicted_avg=0.05 actual_rate=0.00 n=7
- bin 0.2-0.4: predicted_avg=0.29 actual_rate=0.00 n=1
- bin 0.4-0.6: predicted_avg=0.00 actual_rate=0.00 n=0
- bin 0.6-0.8: predicted_avg=0.78 actual_rate=0.00 n=1
- bin 0.8-1.0: predicted_avg=0.93 actual_rate=1.00 n=11
