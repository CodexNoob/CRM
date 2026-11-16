# Practice CRM & Client Portal

A practice-management system for a U.S. tax and accounting firm: a staff CRM for clients, engagements and tasks, plus a secure client portal. This repository holds **milestone 1**, the foundation slice for the December 2026 pilot. It is not the full product. See [Status](#status-milestone-1) for what works and what is deferred.

## Stack

| Layer | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4 |
| Database | PostgreSQL via Drizzle ORM; SQL migrations in `drizzle/` |
| Local / test database | [PGlite](https://pglite.dev) (real Postgres compiled to WASM, in-process), so no Docker or Postgres install is needed |
| Validation | Zod |
| Passwords | argon2id (`@node-rs/argon2`, OWASP parameters) |
| Tests | Vitest, against a fresh in-memory Postgres per test file |

## Getting started

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local      # defaults use embedded Postgres in ./.data/dev
npm run db:seed                 # applies migrations + loads FICTIONAL demo data
npm run dev                     # http://localhost:3000
```

`db:seed` prints a one-time **set-password link** for each demo login: an admin, a preparer and two portal clients. Open a link, choose a password, then sign in. The links expire in 72 hours. To start over, stop the dev server, delete `.data/` and run `npm run db:seed` again.

Embedded PGlite allows **one process at a time**. Stop `npm run dev` before running `db:migrate`, `db:seed` or `user:invite` against the same `.data/dev` directory.

### First admin and staff accounts (in the app)

1. Set `SETUP_CODE` (24+ random characters) in the environment and start the app.
2. Open `/setup` (the sign-in page links to it while no accounts exist), enter the setup code, and create the first admin. You're signed in straight away.
3. Go to **Team** (admins only) to invite staff, change roles, send a new sign-in link (also a password reset), or deactivate or reactivate accounts.

`/setup` stops working permanently once any account exists. Admins can't deactivate or demote themselves, and the last active admin can't be removed. Client portal logins are created from a client's page: **Portal access → Create invitation link**.

To bootstrap the first platform-wide Super Admin, use the command-line invitation after creating the first firm. The command requires database access and prints a single-use, 72-hour set-password link; deliver that link only through a trusted channel:

```bash
npm run user:invite -- --email platform-admin@example.com --name "Platform Admin" --role super_admin --firm firm-slug
```

Command-line fallback for other staff invitations:

```bash
npm run user:invite -- --email jane@firm.example --name "Jane Doe" --role admin   # admin | manager | employee | read_only
```

### Using a real PostgreSQL server (e.g. Supabase)

1. Use a **dedicated** database or project for the CRM. Do not share one with another application.
2. Set `DATABASE_URL` (and optionally `DIRECT_URL` for migrations) in `.env.local` or your host's secret store. URL-encode special characters in the password (`!` → `%21`).
3. TLS is enforced. For any non-localhost host, the server certificate is verified (`DATABASE_SSL=verify`). Providers with their own CA need `DATABASE_SSL_CA_PATH`. `sslmode` and similar URL parameters are ignored so they cannot weaken this.
4. `npm run db:check` makes a read-only check of connectivity, existing tables, row-level security, and any privileges held by Supabase API roles.
5. `npm run db:migrate` applies migrations.

The seed script refuses to write demo data into PostgreSQL unless you pass `--allow-postgres`.

#### Supabase specifics

- Use the **session-mode pooler** URL (port 5432, user `postgres.<project-ref>`). The direct `db.<ref>.supabase.co` host is IPv6-only unless you buy the IPv4 add-on. The transaction pooler (port 6543) is only needed for serverless hosting.
- Supabase's public root CA (`Supabase Root 2021 CA`, SHA-256 `807025AD…E6CAFA`) is in `certs/supabase-ca-2021.crt`. Set `DATABASE_SSL_CA_PATH=./certs/supabase-ca-2021.crt`.
- Supabase exposes the `public` schema over its REST API to anyone with the publishable key. Every CRM table therefore has **row-level security enabled with no policies** (migration 0001; a test fails if a table lacks it), and the `anon` and `authenticated` roles are stripped of privileges on CRM tables (0002). Also consider turning off the Data API in project settings, since this app does not use it.
- The app does **not** use Supabase Auth, the publishable key, the secret key or JWKS. Do not add them to the app's environment.
- Choose a **U.S. region** for a project that will hold taxpayer data (see Security notes).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit and authorization tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run check` | All three above |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (`DIRECT_URL`, else `DATABASE_URL`) |
| `npm run db:check` | Read-only connection and hardening check (`-- --direct` for `DIRECT_URL`) |
| `npm run db:seed` | Demo data for local development |
| `npm run user:invite` | Create or re-invite a staff user |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://…` for PostgreSQL, or `pglite:<dir>` / `pglite:memory` for embedded Postgres |
| `DIRECT_URL` | no | Connection used for migrations (session-mode / direct); defaults to `DATABASE_URL` |
| `DATABASE_SSL` | no | `verify` (default for remote hosts) · `no-verify` (encrypted, server not authenticated; temporary only) · `disable` (localhost only) |
| `DATABASE_SSL_CA_PATH` | no | CA certificate file for providers with their own CA (Supabase: `./certs/supabase-ca-2021.crt`) |
| `DATABASE_POOL_MAX` | no | Max pooled connections (default 10) |
| `APP_URL` | yes | Public base URL, used in invitation links |
| `SETUP_CODE` | for first run | One-time code required by `/setup` to create the first admin (24+ characters) |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` | no | Reserved for the QuickBooks Online integration, which is **not implemented yet** |

Only `.env.example` (placeholders) is committed. `.env*` files are git-ignored. In production, keep secrets in the hosting platform's secret manager.

## Public website

`/` is the CRM product website. Its public identity and contact details are stored in the singleton `platform_settings` record and edited by a Super Admin at `/staff/platform-settings`. Public contact requests are stored in `platform_inquiries`; they are not firm leads and are not visible to subscribing firms.

Each subscribing firm has a separate, private organization profile, edited by that firm's Admin at `/staff/settings`. The profile is used in its authenticated workspace and client portal. Firm announcements are visible only to authenticated clients in that firm's portal. Public firm pages at `/f/<slug>` are not part of the product.

The marketing page includes the product features, pricing, sign-up and contact form. `robots.txt` blocks private application routes, and `sitemap.xml` uses `APP_URL` for the public domain.

**Billing limitation:** PayPal invoices currently use the platform's server-side PayPal account. A firm's organization profile does not change the PayPal merchant identity or settlement destination; per-firm PayPal authorization is not implemented.

## Architecture

```text
src/
  db/            schema.ts (tables), index.ts (Postgres/PGlite connection + migrations)
  lib/auth/      crypto (argon2id, tokens), sessions, login + lockout, Next.js cookie glue
  services/      business logic + ALL authorization (clients, engagements, tasks, portal, users, audit)
  integrations/  qbo/ — QuickBooks Online interface (boundary only)
  app/           pages and Server Actions (thin: authenticate → call service → render)
  components/    UI building blocks
drizzle/         generated SQL migrations
tests/           Vitest suites (auth, CRM behavior, authorization boundaries)
scripts/         migrate, seed, invite-user
```

**Authorization lives in the service layer.** Every service function takes the acting user and enforces access on the server:

| Role | Clients visible | Notes |
| --- | --- | --- |
| Firm admin | all | Only role that can read the audit log or invite staff |
| Partner / reviewer | all | |
| Preparer | only clients assigned to them | Assignment is automatic when they create a client or own an engagement |
| Client | none of the staff screens | Portal shows only their own engagements and client-facing tasks |

Requests for records the actor may not see return **not found**, never "forbidden", so record IDs cannot be probed. Page layouts are not relied on for protection: each page and Server Action re-checks the session.

## Status (milestone 1)

### Works now

- Staff and client sign-in: argon2id passwords; server-side sessions (tokens stored as SHA-256 hashes, httpOnly/SameSite cookies with the `__Host-` prefix in production; 8-hour idle and 12-hour absolute expiry); account lockout after 5 failed attempts for 15 minutes; one generic error message for every failure; sign-out.
- Invitation onboarding: single-use, 72-hour set-password links for staff (CLI) and clients (staff UI).
- Clients: create, view, edit, and search by name, email or phone. Individuals, households and businesses.
- Engagements: create for a client with service, tax year, owner, due date and status; edit; dashboard of open engagements (mine / all).
- Tasks: internal tasks (optionally assigned to staff) and client-facing tasks; complete and reopen.
- Client portal: plain-language engagement status, the firm contact's name, and client-facing to-do items the client can mark done. Internal tasks and other clients' data are never loaded.
- Audit log of sign-ins, failed sign-ins, lockouts, invitations, and record creation and changes. Changes record the **names** of changed fields, never their values.
- Responsive layouts (cards on phones, tables on desktop), with loading skeletons, empty states, field-level validation messages and safe error pages.
- Security headers (no framing, nosniff, strict referrer, HSTS in production).

### Phase 1: core CRM modules

- **Leads & Prospects** (`/staff/leads`): a pipeline (new, contacted, qualified, converted, lost) with owner, follow-up date and internal notes. **Convert to client** creates the client record. The website's contact form creates leads with consent recorded and anti-spam checks.
- **Documents** (`/staff/documents`, client page, `/portal/documents`): staff and client uploads of up to 25 MB.
  - Only allowed types are accepted, and the file's leading bytes must match its extension. File names are cleaned.
  - Staff choose which files to share with the client.
  - Downloads go through `/api/documents/[id]` with a permission check. They are served as attachments, uncached, under a sandbox CSP, and every download is audited.
- **Messages** (`/staff/messages`, `/portal/messages`): one private thread per client, with unread counts and read tracking. Message bodies are never logged or emailed.
- **Deadlines & Calendar** (`/staff/calendar`): appointments plus engagement and task due dates in a month grid and an agenda. Times are entered in `FIRM_TIMEZONE` (default `America/New_York`) and stored in UTC. Clients see their upcoming appointments in the portal.
- New tables have RLS enabled and no Supabase API-role grants (migrations 0003 and 0004).

### Verified

- 67 automated tests, including Phase 1 isolation tests: client A vs. client B documents and messages, unassigned staff, disguised files, spam submissions and daylight-saving time conversion. Before that: login, lockout, sessions, invitations, CRUD, validation, audit hygiene, and authorization boundaries (client A vs. client B, preparer vs. unassigned clients, portal users vs. every staff service).
- A deliberate authorization regression (preparers seeing all clients) was confirmed to fail the suite.
- Production build, plus an HTTP smoke test of the pages for each role.
- **Not yet verified:** forms clicked through in a real browser, and accessibility auditing.

### Deferred (not built, not stubbed with fake behavior)

| Area | Status |
| --- | --- |
| **QuickBooks Online** | Interface only (`src/integrations/qbo`). Every call throws `IntegrationNotConfiguredError`; the UI says billing is not connected. See next section. |
| Malware scanning | **Interface only** (`src/lib/storage.ts`). Every file is marked "Not scanned" in the UI until a scanner (e.g. ClamAV or a cloud API) is connected. |
| Object storage | Files are stored in the encrypted database (`document_blobs`) for the pilot. Moving to private Supabase Storage or S3 means swapping the `FileStorage` implementation. |
| Email notifications | Not built. No email is sent for messages, invitations or inquiries. |
| MFA | **Not built, and required before real client data is loaded.** Add TOTP/WebAuthn or move to a managed identity provider; auth is isolated in `src/lib/auth`. |
| Password reset (self-service) | Staff can re-issue an invitation link instead. |
| Rate limiting by IP | Per-account lockout only. Add edge or proxy rate limiting at deployment. |
| Workflow templates, reminders, automation | Not built (requires a background job runner). |
| E-signatures, payments, appointment booking | Not built. Plan to use third-party services. |
| CAPTCHA and edge rate limiting on the inquiry form | Not built. The form currently has a honeypot, a minimum fill time, a per-email hourly cap and a best-effort per-IP limit held in memory. |
| Online self-scheduling by clients | Not built. Staff book appointments; clients see them in the portal. |
| Staff user management UI, audit log viewer | CLI and service layer only. |
| Data retention, backups, deployment configuration | Not built. |

## QuickBooks Online: required setup and next steps

QBO stays the system of record for invoices and payments. To build the integration:

1. Register an app at developer.intuit.com (Accounting scope). Use the sandbox first.
2. Put the client ID, secret and redirect URI in the hosting secret store (`QBO_*` variables). **Never** in source or chat.
3. Implement the OAuth 2.0 connect and callback route (admin only). Store the refresh token encrypted, keep one connection per firm, and rotate on refresh.
4. Implement `AccountingProvider.listInvoices` against the QBO API. Map CRM clients to QBO customers with an explicit stored ID, and send mismatches to a review queue.
5. Sync in a background job. Show failures in an admin queue; never show stale data as current.
6. Link clients to QBO's hosted payment page. No card data touches this app.

## Security notes and items for professional review

These controls are engineering safeguards. They are **not** a claim of legal or regulatory compliance. Before real client data is loaded, have qualified professionals review at least:

- **FTC Safeguards Rule** (GLBA), which applies to tax preparers: written information security program, qualified individual, risk assessment, MFA, encryption, monitoring, vendor oversight and incident response.
- **IRS Publication 4557** and the written information security plan (WISP) expected of tax professionals; IRS e-file provider obligations; IRC §7216 limits on use and disclosure of tax return information (consent requirements for any non-preparation use).
- **State** data-breach notification and data-security laws for the states where clients live, plus state privacy laws and any state board of accountancy record-retention rules.
- Hosting and vendor agreements (data location, encryption, backup and restore, access logging), and penetration testing before launch.

Built-in rules: no SSNs, EINs, bank or card data are stored in this milestone. Unexpected errors are logged by name and code only, because database driver errors can contain query values. Audit metadata never contains field values, tokens or passwords.
