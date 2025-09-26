# Driver Daily Log (API + Admin UI)

- Server: Express + better-sqlite3
- DB Path: `DB_FILE` env var or `/tmp/driverlog.db` by default
- Admin token: set `ADMIN_TOKEN`
- Optional: `MAIL_WEBHOOK_URL` (POST target to send edited logs)
- Static: `/public/admin.html` (admin grid), `/public/driver-edit.html` (edit form)

