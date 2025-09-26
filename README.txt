Driver Daily Log — Render backend

Key endpoints:

- POST /api/public/submit
  For your GitHub Pages driver form (CORS enabled for pricefarmtrucking-pixel.github.io).
  Body JSON:
    {
      "driver_token": "<driver's token from DRIVER_TOKENS_JSON>",
      "log_date": "YYYY-MM-DD",
      "truck_unit": "T660",
      "miles": 123.4,
      "value": 12.5,
      "detention_minutes": 0,
      "notes": "optional",
      "dup_action": "replace|append|new"   // optional, used after you receive 409 duplicate
    }

- GET  /api/period/current           -> { start, end }
- GET  /api/logs?from=...&to=...     -> filtered logs (admin or driver limited)
- GET  /api/payroll?from=...&to=...  -> totals by driver
- GET  /api/logs.csv?...             -> CSV export

Environment:
  ADMIN_TOKEN, DRIVER_TOKENS_JSON, PAY_WEEK_START, PAY_CUTOFF_HHMM,
  (optional) GOOGLE_* for Drive upload
