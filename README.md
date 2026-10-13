# test-manager-library-3145556-tool

Demo data seeder for Manager Library. Uses only the API — never direct SQL.

## Run

```bash
cd seed
cp .env.example .env
# Edit .env with your admin credentials
node seed.mjs
```

## What it does

1. Logs in as admin
2. Creates a demo librarian
3. Creates 40+ books across all 5 categories
4. Creates 10 members
5. Creates 3 overdue loans (using CLOCK_OFFSET_DAYS=-20)
6. Creates 12 normal loans (respecting max 3 per member)
7. Returns some items
8. Verifies overdue loans and report data

## Evidence

After running:
- `GET /loans/overdue` returns 3 lines
- `GET /reports/most-borrowed` has rows
