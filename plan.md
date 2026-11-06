# Plan — Momento Planner API (backend)

> Status: **APPROVED (2026-11-06)**. Phase 3 of the workflow. Implements [spec.md](spec.md).
> Executed in **3 batches** (regrouped 2026-11-06 for speed), with your review between batches.
>
> Progress: T0.1 ✅ · T0.2 ✅ · **Batch A ✅** (T1.1–T3.1, awaiting your review)

## Batches

| Batch                      | Milestones                                          | What you get at the end                                                          |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| **A. Core server & users** | M1 Foundation + M2 Authentication + M3 Profile      | A running API: health, register, login, Google sign-in, refresh, logout, profile |
| **B. Events & AI**         | M4 Events + M5 Saved events + M6 AI personalization | Search, details, categories, My Events, Personalize                              |
| **C. Hardening & review**  | M7                                                  | Security pass, real-service smoke test, README, independent code review          |

## How each batch is executed (TDD)

1. **Red:** for each task, write the tests from the acceptance criteria, run them, and confirm they fail.
2. **Green:** write the smallest amount of code that makes the tests pass.
3. **Refactor:** clean up the code while keeping the tests passing.
4. **Gate:** `npm run lint`, `npm run typecheck` and `npm test` all pass, then one commit per task (e.g. `feat(auth): T2.3 register/login routes`).
5. **Batch end:** you review the tests **and** the code together, with a summary, the test results and the actual diff,
   before the next batch starts. Tests are still written first and seen failing; you review them at the end instead of
   before the code.
6. **Stop early** only if something needs your decision (e.g. a spec conflict). I'll ask instead of guessing.

Tests use only fakes or in-memory services: in-memory MongoDB, and fake Ticketmaster, Claude and Google. The real
services are used only in the manual smoke test (T7.2).

## Prerequisites from you

| Needed by      | Item                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| T0.2           | Ticketmaster API key in `.env` (you have an account)                                                                       |
| T7.2           | A free MongoDB Atlas cluster and its connection string. Add your current IP to the cluster's allowed IPs (Network Access). |
| T7.2           | An Anthropic API key (optional: without one, the fake AI provider is used)                                                 |
| Frontend phase | Google OAuth client IDs (Web + Android). The backend can be fully built and tested without them.                           |

---

## M0 — Project setup

### T0.1 Scaffold the project

- `git init` and a `.gitignore` (node_modules, dist, .env, coverage).
- Change `package.json` to `"type": "module"` and add the scripts: `dev` (tsx watch), `build` (tsc), `start`, `test`, `test:watch`,
  `coverage`, `lint`, `format`, `typecheck`.
- Strict `tsconfig.json`, ESLint (typescript-eslint) with Prettier, and `vitest.config.ts`.
- Create the folder layout from spec §2 and an `.env.example`.
- **Acceptance:** a placeholder test passes, and `lint`, `typecheck` and `test` all exit 0. This is the first commit on `main`.
- **Depends on:** nothing.

### T0.2 Ticketmaster spike (check the API facts the spec left open)

- `scripts/tm-spike.ts` calls the real API and saves the responses to `test/fixtures/ticketmaster/`. It checks:
  - a search,
  - an event's details,
  - an unknown ID,
  - several IDs in one `id=` request,
  - the classifications (segments).
- Record what it finds in spec §8:
  - the response for an unknown ID,
  - whether `id=` accepts several IDs,
  - the segment IDs,
  - whether `info`, `pleaseNote` and `priceRanges` are present.
- **Acceptance:** the fixtures are committed with no API key in them, and every item in spec §8 "To check early" is answered.
- **Depends on:** T0.1 and your Ticketmaster key.

## M1 — Foundation

### T1.1 Env config

- `config/env.ts`: a zod schema, read once and frozen.
- **Tests:**
  - Missing required variables fail with clear messages.
  - Defaults are applied (`PORT`, `AI_MODEL`, `AI_DAILY_LIMIT_PER_USER`).
  - A `JWT_ACCESS_SECRET` under 32 bytes is rejected.
  - `ANTHROPIC_API_KEY` is optional.

### T1.2 App shell, errors and logging

- `lib/errors.ts` (an `AppError` class plus the error codes from spec §7), `middleware/errorHandler`, `middleware/notFound`,
  a pino logger that hides secrets, `app.ts` (helmet, 100 KB JSON limit) and `GET /health`.
- **Tests:**
  - An unknown route returns 404 in the standard error shape.
  - A thrown `AppError` returns its status and code.
  - An unexpected error returns 500 `INTERNAL`, with no stack trace outside development.
  - A body over 100 KB returns 413.
  - `/health` returns `{status:'ok', db}`.
  - The log output doesn't contain the Authorization header.

### T1.3 Database and test setup

- `lib/db.ts` (connect and disconnect).
- `test/setup/mongo.ts`: an in-memory MongoDB, with the collections cleared between tests.
- **Tests:** connect, then a write and read round trip. `/health` reports `db:'down'` when disconnected.

### T1.4 Validation middleware

- `validate({ body?, query?, params? })` using zod. Unknown fields are removed, and failures return 400 `VALIDATION_ERROR` with details.
- **Tests:** valid input passes through already parsed (e.g. numbers converted), invalid input returns 400, and extra fields are removed.

**Depends on:** M0. T1.2 depends on T1.1, and T1.3 on T1.2.

## M2 — Authentication

### T2.1 User model and password rules

- The `User` Mongoose model (spec §5), with lowercase email, a unique email index and a sparse unique `googleId` index.
  `toJSON` returns the public `user` shape (no `passwordHash`).
- `passwordPolicy` (at least 8 characters, at most 72 bytes, at least one letter and one digit) and `hashPassword` / `verifyPassword` (bcryptjs, cost 12).
- **Tests:** the password rules, including edge cases. The hash checks against the correct password and fails on a wrong one.
  Duplicate emails are rejected regardless of letter case. `passwordHash` never appears in the JSON output.

### T2.2 Token service

- Access tokens: `signAccessToken` / `verifyAccessToken` (jose, HS256, 15 minutes).
- The `RefreshToken` model, with a TTL index.
- `issueRefreshToken`, `rotateRefreshToken` (with reuse detection: reusing an old token revokes its whole chain) and `revokeRefreshToken`.
- **Tests:**
  - Access token round trip; expired or tampered tokens are rejected.
  - Refresh tokens are stored hashed, never raw.
  - Rotation gives a new token and marks the old one as replaced.
  - Reusing a replaced token revokes every token in its chain, so the newest one stops working too.
  - Expired tokens are rejected.

### T2.3 Register, login, refresh and logout routes

- **Tests (integration):**
  - Register returns 201 with `user`, `accessToken` and `refreshToken`.
  - Registering an existing email returns 409 `EMAIL_TAKEN`.
  - A weak password returns 400.
  - Login succeeds with the correct password.
  - A wrong password and an unknown email return the **same** 401 `INVALID_CREDENTIALS`.
  - Logging in to a Google-only account with a password returns the same 401.
  - Refresh rotates the tokens. Reusing a refresh token returns 401 and revokes its chain.
  - Logout returns 204 and the refresh token no longer works. Logging out with an invalid token also returns 204.

### T2.4 `requireAuth` middleware

- **Tests:**
  - A missing, malformed, expired or tampered token returns 401 `UNAUTHENTICATED`.
  - A token for a deleted user returns 401.
  - A valid token sets `req.user`.

### T2.5 Google sign-in

- A `GoogleVerifier` interface: the real implementation uses google-auth-library, and the fake is used in tests.
- `POST /auth/google`.
- **Tests:**
  - A new Google user is created with their first and last name, and `isNewUser` is true.
  - An existing `googleId` signs in.
  - A verified email that matches a password account is **linked** (`authProviders` then includes both).
  - An unverified Google email that matches an existing account is **not** linked; the request returns 409 `EMAIL_TAKEN`.
  - A token the verifier rejects returns 401.
  - The real verifier is set up with `GOOGLE_CLIENT_IDS` as the allowed audiences (unit test with a mocked library).

### T2.6 Auth rate limits

- 10 requests per 15 minutes per IP on login, register and Google sign-in; 30 per 15 minutes on refresh.
- **Tests:** the 11th login attempt returns 429 `RATE_LIMITED` in the standard error shape.
  The test env can raise the limits so other tests aren't affected.

**Depends on:** M1. Order: T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6.

## M3 — Profile

### T3.1 `GET /me` and `PATCH /me`

- **Tests:**
  - Both routes require auth.
  - `GET` returns the public user.
  - `PATCH` updates first name, last name and language. A phone number is normalized to E.164, and `phone: null` clears it.
  - An invalid phone number, an unsupported language, or an empty name returns 400.
  - `email`, `passwordHash` and `googleId` can't be changed (they're removed from the request).

**Depends on:** T2.4.

## M4 — Events

### T4.1 Event type and Ticketmaster mapping

- The `Event` / `EventSummary` types, and `mapTicketmasterEvent` using the spike fixtures.
- **Tests:**
  - All fields are mapped from the real fixtures.
  - The best 16:9 image is chosen.
  - The status is converted to our values (`canceled` becomes `cancelled`).
  - Missing venue, price, time or description become `null` without errors.
  - The description is built from `description`, `info` and `pleaseNote`.

### T4.2 Ticketmaster provider

- `search`, `getById`, `getByIds` (at most 20 IDs per batch) and `listCategories` with:
  - an 8-second timeout,
  - the 4 calls/second limiter,
  - the lru-cache lifetimes from spec §8,
  - errors converted to our codes (404 becomes not found; 401, 429 and 5xx become `UPSTREAM_UNAVAILABLE`),
  - `locale=*`, `sort=date,asc`, `startDateTime=now` and (on search) `countryCode=GB,US,IE,AU,NZ,CA` from config.
- **Tests (fetch is mocked):**
  - Request parameters are built correctly.
  - A second identical call is served from the cache.
  - A not-found result is also cached.
  - A timeout returns `UPSTREAM_UNAVAILABLE`.
  - The limiter spaces out bursts of calls.
  - The API key never appears in errors or logs.

### T4.3 Categories

- A fixed list of category IDs and names, using the segment IDs from T0.2.
- `listCategories` returns this list.
- **Tests:** the list matches the spec, and an unknown category ID is rejected by validation.

### T4.4 Events routes

- `GET /events`, `GET /events/categories` and `GET /events/:id`, using a fake provider.
- **Tests:**
  - All three require auth.
  - Pagination and the response shape are correct.
  - `size` over 50, or a page past item 1,000, returns 400.
  - Search and category are passed to the provider.
  - Details return 404 for an unknown ID.
  - An upstream failure returns 502.

**Depends on:** T0.2 and M1, plus T2.4 for auth. Order: T4.1 → T4.2 → T4.3 → T4.4.

## M5 — Saved events

### T5.1 SavedEvent model and service

- `save` checks that the event exists, does nothing if it's already saved, and enforces the 100 limit.
- `list` is paginated, loads a page of details with one `getByIds` batch (skipping cached events), and marks IDs missing from the response as `available:false`.
- `remove` does nothing if the event wasn't saved.
- **Tests:**
  - Saving the same event twice keeps one record.
  - The 101st save returns 409 `SAVED_LIMIT_REACHED`.
  - Saving an event that doesn't exist returns 404.
  - The list is sorted newest first, and a missing event shows as `available:false, event:null`.
  - A page of 20 saved events makes at most one provider call (zero if all are cached).
  - Users can't see each other's saved events.

### T5.2 Saved events routes

- **Tests (integration):** `POST` returns 201 the first time and 200 after that. `GET` returns the paginated shape.
  `DELETE` returns 204, both when the event was saved and when it wasn't. All routes require auth.

**Depends on:** M4.

## M6 — AI personalization

### T6.1 Prompt, facts and cache key (pure functions)

- `buildFacts(event, language)`: date, time and venue text written in the target language, plus the ticket URL.
- `buildPrompt(event, options)`: the fixed system prompt (`PROMPT_VERSION=1`) and the event data in a marked block, limited to 4,000 characters.
- `cacheKey(...)`.
- **Tests:**
  - `facts` come only from the event's data.
  - Snapshot tests of the prompt.
  - Long descriptions are cut to 4,000 characters.
  - Changing any part of the key gives a different key.

### T6.2 AI provider

- The `AiProvider` interface and a `FakeAiProvider`.
- `ClaudeProvider` uses `@anthropic-ai/sdk` structured output (Zod) with `AI_MODEL`. The exact SDK calls will be checked in the docs at this point.
- **Tests (SDK mocked):**
  - A parsed result is returned.
  - A `refusal` or `max_tokens` stop, and an SDK error, each return `UPSTREAM_UNAVAILABLE`.
  - The fake provider is chosen when there's no API key.

### T6.3 Personalize service

- **Tests:**
  - A cache hit returns `cached:true`, doesn't call the AI and doesn't count towards the limit.
  - A cache miss calls the AI once, stores the result and adds one to `ai_usage`.
  - The 21st uncached call in a day returns 429 `AI_LIMIT_REACHED`.
  - `{ shorten:false, translateTo:'en' }` returns the original text with no AI call (Version 1 events are English).
  - Shorten without `translateTo` keeps the original language; `translateTo` sets the output language.
  - An unknown event returns 404.

### T6.4 `POST /events/:id/personalize` route

- **Tests (integration):** requires auth, validates the body (`{ shorten:false }` with no `translateTo` returns 400), returns the response shape `{title, description, facts, cached}`, and maps errors correctly.

**Depends on:** M4 and T3.1 (for the user's language). M5 isn't needed, so M5 and M6 can be done in either order.

## M7 — Hardening, smoke test and review

- **T7.1 Security pass:**
  - Confirm the checklist in spec §10.
  - Run `npm audit` and fix any high or critical issues.
  - Tests check that no route leaks `passwordHash` or tokens.
- **T7.2 Manual smoke test:**
  - A `requests.http` file (VS Code REST Client) runs the full flow against Atlas and the real Ticketmaster and Claude APIs.
  - **Acceptance:** register, then search, then personalize in Swahili, then save, then My Events all work on real data.
- **T7.3 Docs:**
  - A README covering setup, env vars, scripts, the API overview and how to connect from the Android emulator (`http://10.0.2.2:4000`).
  - Coverage at least 80% across services and providers.
- **T7.4 Independent review (Phase 5):**
  - Run `/code-review` over the whole backend.
  - Fix confirmed findings and re-run all checks.
  - You review the diff and approve.

---

## Dependency overview

```
M0 (T0.1 → T0.2)
 └─ M1 (T1.1 → T1.2 → T1.3, T1.4)
     ├─ M2 Auth (T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6)
     │    └─ M3 Profile (T3.1)
     └─ M4 Events (T4.1 → T4.2 → T4.3 → T4.4)   ← needs T0.2 fixtures, and T2.4 for the routes
          ├─ M5 Saved events (T5.1 → T5.2)
          └─ M6 AI (T6.1 → T6.2 → T6.3 → T6.4)  ← also needs T3.1
               └─ M7 Hardening and review
```

## Integration risks

| Risk                                                                                                | Mitigation                                                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The in-memory MongoDB downloads a MongoDB binary (about 100 MB) the first time tests run on Windows | Expected and one-off; the binary is cached afterwards. The first test run gets a longer timeout.    |
| ES modules combined with Vitest, Mongoose and jose                                                  | Settled in T0.1 with a smoke test before any feature work                                           |
| Ticketmaster facts not yet confirmed (several IDs per request, response for unknown IDs)            | The T0.2 spike happens before the mapping and provider code                                         |
| The 5,000/day Ticketmaster limit is hit during My Events development                                | Caching, one batch call per page (spike-confirmed), and tests that use fixtures, never the real API |
| Google ID token `aud` differs between Android and iOS clients                                       | `GOOGLE_CLIENT_IDS` accepts a list. Checked end to end in the frontend phase.                       |
| Atlas refuses connections from IPs not on its allowlist                                             | Listed in Prerequisites. `/health` shows `db:'down'` to make the problem obvious.                   |
| The SDK's structured output calls differ from what we expect                                        | Checked against the official SDK docs in T6.2, before writing the code                              |

## Out of scope for this plan

- Frontend.
- Deployment and hosting.
- CI pipeline: checks run locally; a GitHub Actions workflow can be added later.
- Everything listed under "future" in intent.md.
