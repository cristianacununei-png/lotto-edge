# Lotto Edge v5 — Edge AI

Mobile-first offline PWA for UK Lotto and EuroMillions.

## v5 highlights

- Edge AI default model
- Explainable component scores:
  - long-term history
  - recent form
  - overdue fit
  - pair strength
  - structural fit
  - low-sharing score
- smart multi-line ticket diversification
- separate EuroMillions Lucky Star model
- heatmap
- walk-forward backtesting against random selections
- saved picks
- offline-first PWA behaviour

## Backtesting

The backtester uses only draws that occurred before each target draw. This avoids future-data leakage.
For mobile performance, the backtest uses a reduced candidate search compared with live Edge AI generation.

Historical backtest results are descriptive and do not establish that future lottery draws are predictable.

## Deployment

Upload all files in this folder over the existing GitHub Pages repository and commit to `main`.
GitHub Pages will redeploy automatically.

## v6 — Full UK Lotto data engine

UK Lotto no longer relies on the five-row demonstration set when internet access is available.
On first launch it downloads the full historical UK National Lottery archive (1994 onward)
from the configured public history API and stores it locally on the device. Thereafter the
app works offline and refreshes stale data when internet is available.

The same historical dataset is used by Edge AI, heatmaps, frequency analysis and walk-forward backtesting.
