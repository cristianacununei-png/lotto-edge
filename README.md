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
