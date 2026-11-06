# Spec — Smart Event Planner: Backend

> Status: **APPROVED (2026-11-06)**. Phase 2 of the workflow. Implements the scope in the mobile repo's intent document:
> `C:\Users\Admin\Documents\react-native\momento-event-planner-app\intent.md`.
> The mobile (frontend) spec will be written separately, in the mobile repo.
> Any change to the stack, data model or API contract after approval needs explicit agreement.

## 1. Architecture overview

```
┌────────────────────┐      HTTPS/JSON       ┌──────────────────────────────┐
│ Expo app (Android/ │ ───────────────────▶  │ Express API  (/api/v1)        │
│ iOS)               │   Bearer access token │                               │
│ - device calendar  │ ◀───────────────────  │  routes → controllers →       │
│ - secure token     │                       │  services → providers / models│
│   storage          │                       └──────┬─────────┬─────────┬────┘
└────────────────────┘                              │         │         │
                                                    ▼         ▼         ▼
                                              MongoDB   Ticketmaster  Claude API
                                             (users,     Discovery    (personalize)
                                              tokens,    API v2
                                              saved,
                                              AI cache)
```

- **Thin client.** The app only calls our API. Ticketmaster and Claude keys stay on the server.
- **Layered backend:** `routes` (HTTP and validation) → `services` (business rules) → `providers` (outside APIs) and
  `models` (MongoDB). Services never touch `req` or `res`, so they can be unit-tested without a server.
- **Swappable event provider:** an `EventProvider` interface. `TicketmasterProvider` is the only implementation in Version 1.
  All event data is converted to our own `Event` format before it leaves the provider.

## 2. Repository layout

The backend is a **separate project** at `C:\Users\Admin\Documents\node\momento-planner-api` (its own repository).
The mobile app stays in `momento-event-planner-app`. The two share only the HTTP contract in §7.

Current state: only a default `package.json` (`"type": "commonjs"`) and no git repository yet. Setup will:

- run `git init`,
- switch the project to ES modules (`"type": "module"`),
- add the TypeScript, lint and test tooling below.

```
momento-planner-api/
  src/
    app.ts                 # builds the Express app (no listen), so tests can use it
    server.ts              # connects to MongoDB and starts listening
    config/env.ts          # zod-validated environment variables
    lib/                   # errors, logger, async handler, pagination helpers
    middleware/            # auth, validate, rateLimit, errorHandler, notFound
    modules/
      auth/                # routes, controller, service, tokens, google verifier
      users/               # /me profile
      events/              # search, details, categories
      saved-events/        # /me/saved-events
      personalize/         # AI personalization + cache
    providers/
      events/              # EventProvider interface, TicketmasterProvider, mapping
      ai/                  # AiProvider interface, ClaudeProvider, FakeAiProvider
    models/                # Mongoose schemas
  test/
    unit/  integration/  fixtures/
  .env.example
  package.json  tsconfig.json  vitest.config.ts  eslint.config.js
```

## 3. Tech stack

| Concern          | Choice                                                                 | Why / alternatives considered                                                                                                        |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime          | **Node.js 24 LTS**, TypeScript (strict), ES modules                    | One language with the mobile app; shared mindset                                                                                     |
| HTTP framework   | **Express 5**                                                          | Your choice. Version 5 handles errors thrown from async route handlers natively.                                                     |
| Database         | **MongoDB Atlas, free tier (M0)** for development, with **Mongoose 8** | Your choice. Atlas because neither Docker nor MongoDB is installed on this machine. Mongoose gives schemas, indexes and TTL support. |
| Validation       | **zod**                                                                | One schema serves request validation, env config and inferred TS types                                                               |
| Password hashing | **bcryptjs** (cost 12)                                                 | Pure JS, so no native build issues on Windows. argon2 is stronger but needs a native module.                                         |
| Tokens           | **jose** (JWT, HS256)                                                  | Modern and maintained, with no native dependencies                                                                                   |
| Google sign-in   | **google-auth-library** `verifyIdToken`                                | Google's official way to verify ID tokens on a server                                                                                |
| Ticketmaster     | Native `fetch` (Node 24)                                               | No SDK needed                                                                                                                        |
| In-memory cache  | **lru-cache** with TTL                                                 | Keeps us within the 5,000 calls/day limit. One process, so no Redis yet.                                                             |
| AI               | **@anthropic-ai/sdk** with structured JSON output (Zod schema)         | Official SDK. The response is checked against a schema.                                                                              |
| Security headers | **helmet**                                                             | Standard                                                                                                                             |
| Rate limiting    | **express-rate-limit**                                                 | For login and register attempts, plus a separate daily AI limit stored in MongoDB                                                    |
| Logging          | **pino** + pino-http                                                   | Structured logs. Tokens, passwords and the Authorization header are redacted.                                                        |
| Phone validation | **libphonenumber-js**                                                  | Stores numbers in the international E.164 format (`+254712345678`)                                                                   |
| Tests            | **Vitest** + **supertest** + **mongodb-memory-server**                 | Fast. Tests use a real Mongo engine with no Docker needed. Outside APIs are faked.                                                   |
| Lint / format    | ESLint (typescript-eslint) + Prettier                                  | —                                                                                                                                    |
| Dev runner       | **tsx** (watch mode)                                                   | Runs TypeScript directly, no build step in dev                                                                                       |

## 4. Configuration (`.env`, validated at startup)

| Variable                  | Example                                                     | Notes                                                                       |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`                                               | `development` / `test` / `production`                                       |
| `PORT`                    | `4000`                                                      |                                                                             |
| `MONGODB_URI`             | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/momento` | Atlas connection string. Tests don't use it; they run an in-memory MongoDB. |
| `JWT_ACCESS_SECRET`       | 32+ random bytes                                            | Startup fails if it's too short                                             |
| `ACCESS_TOKEN_TTL`        | `15m`                                                       |                                                                             |
| `REFRESH_TOKEN_TTL_DAYS`  | `30`                                                        |                                                                             |
| `GOOGLE_CLIENT_IDS`       | `xxx.apps.googleusercontent.com,...`                        | Allowed `aud` values for Google ID tokens (web, Android and iOS client IDs) |
| `TICKETMASTER_API_KEY`    | —                                                           |                                                                             |
| `ANTHROPIC_API_KEY`       | —                                                           | Optional in dev: if missing, the fake AI provider is used                   |
| `AI_MODEL`                | `claude-haiku-5-5`                                          | Changeable without code changes (see §9)                                    |
| `AI_DAILY_LIMIT_PER_USER` | `20`                                                        | Only counts requests that weren't already cached                            |
| `CORS_ORIGINS`            | _(empty)_                                                   | Mobile apps don't need CORS. Kept for future web or admin tools.            |

`.env.example` is committed. `.env` is git-ignored.

## 5. Data model (MongoDB)

### `users`

| Field                    | Type                   | Rules                                                                                                                                   |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                    | ObjectId               |                                                                                                                                         |
| `email`                  | string                 | Required, stored lowercase and trimmed, **unique index**                                                                                |
| `passwordHash`           | string?                | Present only if the user signed up with a password. Never returned by the API.                                                          |
| `googleId`               | string?                | Google's `sub` value. **Unique, sparse index.**                                                                                         |
| `firstName`              | string                 | Required, 1–50 characters                                                                                                               |
| `lastName`               | string                 | 0–50 characters. Required (1–50) on register and profile edits; may be empty only for a Google account whose profile has no family name |
| `phone`                  | string?                | E.164 format, validated                                                                                                                 |
| `language`               | `'en' \| 'fr' \| 'sw'` | Default `'en'`                                                                                                                          |
| `createdAt`, `updatedAt` | Date                   | Set automatically by Mongoose                                                                                                           |

**Linking accounts.** On Google sign-in, look up the user by `googleId` first. If none is found and Google says the
email is verified, look up by `email` and **link** the Google ID to that account. Otherwise create a new user, taking
the first and last name from Google's `given_name` and `family_name`.

### `refresh_tokens`

| Field        | Type      | Rules                                                             |
| ------------ | --------- | ----------------------------------------------------------------- |
| `userId`     | ObjectId  | Indexed                                                           |
| `tokenHash`  | string    | SHA-256 of the token (the raw token is never stored). **Unique.** |
| `family`     | string    | Groups a chain of rotated tokens, so reuse can be detected        |
| `expiresAt`  | Date      | **TTL index**, so MongoDB deletes expired tokens automatically    |
| `revokedAt`  | Date?     |                                                                   |
| `replacedBy` | ObjectId? | Points to the next token in the chain                             |

### `saved_events`

| Field       | Type             | Rules                               |
| ----------- | ---------------- | ----------------------------------- |
| `userId`    | ObjectId         |                                     |
| `source`    | `'ticketmaster'` | Lets other providers be added later |
| `eventId`   | string           | The provider's event ID             |
| `createdAt` | Date             |                                     |

- **Unique compound index `{ userId, source, eventId }`**, so saving the same event twice is a no-op.
- Each user can save at most **100** events. This keeps My Events within the Ticketmaster rate limit.
- _Why a separate collection rather than an array on `users`:_ it gives an atomic unique constraint, cheap
  pagination and sorting, and the user document can't grow without limit. It still only ties event IDs to a
  user, as agreed in intent.md.

### `ai_personalizations` (cache)

| Field       | Type   | Rules                                                                       |
| ----------- | ------ | --------------------------------------------------------------------------- |
| `key`       | string | **Unique.** A hash of `source:eventId:language:shorten:promptVersion:model` |
| `result`    | object | `{ title, description }`                                                    |
| `createdAt` | Date   | **TTL index, 30 days**                                                      |

### `ai_usage`

| Field    | Type                      | Rules                                                                                           |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `userId` | ObjectId                  |                                                                                                 |
| `day`    | string `YYYY-MM-DD` (UTC) |                                                                                                 |
| `count`  | number                    | `$inc` with upsert on every AI call that wasn't cached. **Unique `{userId, day}`**, TTL 7 days. |

**Device-only data (not on the backend):** the device calendar entry ID for each saved event, the theme preference, and
the tokens (in secure storage).

## 6. Authentication design

- **Access token:** a JWT (HS256) holding `sub` = userId, valid for 15 minutes. The app sends it as `Authorization: Bearer <token>`.
- **Refresh token:** 32 random bytes encoded as base64url, valid for 30 days. Only its SHA-256 hash is stored.
  It's **replaced on every refresh**. If an already-used refresh token is presented again, every token in its chain
  (`family`) is revoked, because that's a sign the token was stolen.
- **Password rules (Version 1):** at least 8 characters, at most 72 bytes (bcrypt's limit), with at least one letter and one digit.
- **Login errors are generic:** "Invalid email or password" for both an unknown email and a wrong password.
- **Google sign-in flow:** the app gets a Google **ID token** using the native Google sign-in on the device (details
  in the frontend spec). It sends `POST /auth/google { idToken }`. The backend checks the token's signature, `aud`
  (against `GOOGLE_CLIENT_IDS`), `iss` and expiry, then signs the user in or creates their account.
- **A Google-only user has no password.** Email and password login for that account returns the same generic error.
  Setting a password is out of scope for Version 1.
- Login and register are limited to **10 requests per 15 minutes per IP**. Refresh is limited to 30 requests per 15 minutes.

## 7. API contract (`/api/v1`)

All responses are JSON. Errors use a single shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": [ ... ] } }
```

Error codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `EMAIL_TAKEN` (409), `SAVED_LIMIT_REACHED` (409), `PAYLOAD_TOO_LARGE` (413, body over 100 KB),
`RATE_LIMITED` (429), `AI_LIMIT_REACHED` (429), `UPSTREAM_UNAVAILABLE` (502), `INTERNAL` (500).
A malformed JSON body returns `VALIDATION_ERROR`.

### Auth (public)

| Method & path         | Body                                       | 2xx response                                                              |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /auth/register` | `{ email, password, firstName, lastName }` | `201 { user, accessToken, refreshToken }`                                 |
| `POST /auth/login`    | `{ email, password }`                      | `200 { user, accessToken, refreshToken }`                                 |
| `POST /auth/google`   | `{ idToken }`                              | `200 { user, accessToken, refreshToken, isNewUser }`                      |
| `POST /auth/refresh`  | `{ refreshToken }`                         | `200 { accessToken, refreshToken }`                                       |
| `POST /auth/logout`   | `{ refreshToken }`                         | `204` (revokes that token; succeeds even if the token is already invalid) |

### Profile (auth required)

| Method & path | Body                                                      | 2xx response   |
| ------------- | --------------------------------------------------------- | -------------- |
| `GET /me`     | —                                                         | `200 { user }` |
| `PATCH /me`   | Any of `{ firstName, lastName, phone \| null, language }` | `200 { user }` |

`user` = `{ id, email, firstName, lastName, phone, language, authProviders: ('password'|'google')[], createdAt }`.

### Events (auth required, so usage is per user and the API can't be used anonymously)

| Method & path            | Query / body                                                          | 2xx response                                                        |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /events`            | `q?`, `category?` (our category ID), `page=0`, `size=20` (at most 50) | `200 { items: EventSummary[], page, size, totalPages, totalItems }` |
| `GET /events/categories` | —                                                                     | `200 { items: { id, name }[] }`                                     |
| `GET /events/:id`        | —                                                                     | `200 { event: Event }` · `404` if the source doesn't have it        |

- Only upcoming events are returned (`startDateTime` = now), sorted by `date,asc`.
- **Version 1 covers English-speaking countries only:** GB, US, IE, AU, NZ, CA (decision 5, §12). Ticketmaster can't
  reliably filter by language (see §8), so the country is used to filter instead. Worldwide events are a future feature.
- Ticketmaster can't page past item 1,000, so requests where `(page+1)*size > 1000` return `400`.
- **Categories** are a fixed, curated list of Ticketmaster's top-level groups ("segments"), stored in config.
  The IDs below were confirmed by the T0.2 spike. Ticketmaster's `Undefined` segment is left out.

  | Our category ID | Name           | Ticketmaster segment ID |
  | --------------- | -------------- | ----------------------- |
  | `music`         | Music          | `KZFzniwnSyZfZ7v7nJ`    |
  | `sports`        | Sports         | `KZFzniwnSyZfZ7v7nE`    |
  | `arts-theatre`  | Arts & Theatre | `KZFzniwnSyZfZ7v7na`    |
  | `film`          | Film           | `KZFzniwnSyZfZ7v7nn`    |
  | `miscellaneous` | Miscellaneous  | `KZFzniwnSyZfZ7v7n1`    |

`Event` (our own format; `EventSummary` is the same without `description` and `notes`):

```ts
{
  id: string; source: 'ticketmaster';
  title: string;
  url: string;                 // ticket purchase link
  imageUrl: string | null;     // best 16:9 image
  start: { localDate: string; localTime: string | null; dateTime: string | null; timezone: string | null; };
  status: 'onsale' | 'offsale' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';
  category: { id: string; name: string } | null;
  genre: string | null;
  venue: { name: string; city: string | null; country: string | null; address: string | null } | null;
  priceRange: { min: number; max: number; currency: string } | null;
  description: string | null;  // built from Ticketmaster's description, info and pleaseNote fields
  notes: string | null;
}
```

### Saved events (auth required)

| Method & path                      | Body                | 2xx response                                                                       |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `GET /me/saved-events`             | `page=0`, `size=20` | `200 { items: SavedEventView[], page, size, totalItems }`                          |
| `POST /me/saved-events`            | `{ eventId }`       | `201 { savedEvent }` (the event must exist at the source) · `200` if already saved |
| `DELETE /me/saved-events/:eventId` | —                   | `204` (also `204` if it wasn't saved)                                              |

`SavedEventView = { eventId, savedAt, available: boolean, event: Event | null }`.

- The backend loads a whole page of saved events with **one** Ticketmaster batch request (`getByIds`, see §8).
  Events already in the cache are skipped.
- `available` is false when an ID is missing from the batch response.

### Personalize (auth required)

| Method & path                  | Body                                                   | 2xx response                                         |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| `POST /events/:id/personalize` | `{ shorten: boolean, translateTo?: 'en'\|'fr'\|'sw' }` | `200 { title, description, facts, cached: boolean }` |

- **The AI runs only on an explicit user choice.** The user picks Shorten, Translate (with a target language), or both,
  on the Personalize screen. Nothing is translated or summarized automatically.
- At least one option is required. `{ shorten: false }` with no `translateTo` returns `400 VALIDATION_ERROR`. To use
  the original text, the app doesn't call this endpoint at all.
- The app pre-selects the user's language for Translate, but the user must choose it.
- **Version 1 assumes event text is in English** (English-speaking countries only, §7 Events). So
  `{ shorten: false, translateTo: 'en' }` returns the original text with `cached: false` and **no AI call**.
- `facts` = `{ dateTimeText, venueText, url }`. **The backend builds these from the event data. The AI never
  produces them.** This guarantees dates, times, venues and links are exact. The app combines
  `description` and `facts` into the calendar notes.
- Errors: `404` if the event doesn't exist · `429 AI_LIMIT_REACHED` · `502 UPSTREAM_UNAVAILABLE` if the AI call fails.

### Health

`GET /health` returns `200 { status: 'ok', db: 'up' | 'down' }` (public).

## 8. Ticketmaster integration

- `TicketmasterProvider` implements:
  `search({ q, categoryId, page, size })`, `getById(id)`, `getByIds(ids)` (at most 20 IDs), `listCategories()`.
- Calls `GET https://app.ticketmaster.com/discovery/v2/events.json` and `/events/{id}.json` with `apikey`,
  `locale=*`, and on search `countryCode=GB,US,IE,AU,NZ,CA`. The country list lives in config, so it's easy to
  widen later.
- **Limits:** 5,000 calls/day and 5 per second (confirmed from the docs). A small in-process rate limiter keeps us at
  **4 calls per second**, and calls beyond that are queued.
- **Caching (lru-cache):**

  | Data                | Lifetime   |
  | ------------------- | ---------- |
  | Search results      | 5 minutes  |
  | Event details       | 1 hour     |
  | Categories          | 24 hours   |
  | "Not found" results | 10 minutes |

  This fits Ticketmaster's terms, which allow caching "for reasonable periods".

- **Error handling:**
  - A 429 or 5xx from Ticketmaster is returned to our client as `502 UPSTREAM_UNAVAILABLE`, and the details are logged.
  - A 401 (bad API key) is logged as an error and also returned as `502`.
  - Requests time out after 8 seconds.
- **Spike findings (T0.2, 2026-11-06):** from real API calls; the responses are saved in `test/fixtures/ticketmaster/`.

  | Question                              | Finding                                                                                                                                                | Effect on the design                                                        |
  | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
  | Unknown or removed ID                 | `GET /events/{id}.json` returns **HTTP 404**, error code `DIS1004`                                                                                     | `getById` turns a 404 into "not found"                                      |
  | Several IDs in one request            | **Works.** `events.json?id=a,b,...` returned all 20 real events. An unknown ID mixed in is **left out silently** (HTTP 200).                           | `getByIds`. An ID missing from the response means the event is unavailable. |
  | Segment IDs                           | 6 segments, including `Undefined`                                                                                                                      | Category table in §7                                                        |
  | `description` / `info` / `pleaseNote` | Present on 11/20, 6/20 and 5/20 search results                                                                                                         | All three are optional. `description` is combined from what's present.      |
  | `priceRanges`                         | **Missing on 0/20** results checked                                                                                                                    | `priceRange` will almost always be `null`. The app must not depend on it.   |
  | Language of event text                | With `locale=*`, text is in the event's local language (seen: Spanish, German, English). Each event has a `locale` field (e.g. `es-es`).               | Version 1 is limited to English-speaking countries (decision 5)             |
  | Other                                 | `dates.timezone` on 20/20 · a 16:9 image on 20/20 · status codes seen: `onsale`, `offsale` · `test: false` on all · venue country is sometimes missing | Mapping treats country as optional                                          |
  | Filter by language (`locale=en`)      | **Not reliable.** Every event is labelled `en-us`, but 44/100 still had Spanish or German text.                                                        | Not used                                                                    |
  | Filter by several countries           | **Works.** `countryCode=GB,US,IE,AU,NZ,CA` returned only those countries (GB 74, AU 18, US 7, CA 1); 1/100 looked non-English                          | Used for search                                                             |
  | Search totals                         | `totalElements` is capped at 10,000                                                                                                                    | Pagination uses the 1,000-item limit anyway                                 |

- **Attribution:** show a "Tickets on Ticketmaster" link and follow the branding guide (checked before the demo).
  Ticketmaster image URLs are shown directly and never downloaded and re-hosted.

## 9. AI personalization

- **Provider:** an `AiProvider` interface with `personalize(input) → { title, description }`.
  - `ClaudeProvider` is the real implementation.
  - `FakeAiProvider` returns predictable text. It's used in tests, and in dev when there's no API key.
- **The call:** one `messages` request with **structured output** (a Zod schema `{ title: string, description: string }`
  checked by the SDK's parse helper), so we never have to dig text out of a free-form reply.
  - The system prompt is fixed and versioned (`PROMPT_VERSION = 1`).
  - The event's data goes in the user message as a clearly marked JSON block. The prompt says to treat that block as
    data only and ignore any instructions inside it.
  - **Rules in the prompt:**
    - Use only the facts provided.
    - Don't mention prices, dates, times or URLs. The backend adds those itself in `facts`.
    - Shorten mode: at most about 60 words, keeping the key information.
    - Translate mode: write in the target language. Without Translate, keep the original language.
    - Plain text only, because calendar apps don't render markdown.
  - `max_tokens` is about 1,000. Responses are checked for `stop_reason` (`refusal` or `max_tokens` is treated as a failure, returned as `502`).
- **Cost controls:**
  - The AI is called only when the user asks.
  - Results are stored per event, language, shorten setting, prompt version and model (§5).
  - Each user has a daily limit (default 20), and cached results don't count towards it.
  - Inputs are capped at about 4,000 characters of description.
- **Model:** **`claude-haiku-5-5`** (decided), set through `AI_MODEL`.

  | Option                 | Model ID                        | Price per million tokens (input / output) | Estimated cost per call* |
  | ---------------------- | ------------------------------- | ----------------------------------------- | ------------------------ |
  | Default (most capable) | `claude-opus-5-5`, effort `low` | $4 / $20                                  | about $0.01              |
  | Low-cost               | `claude-haiku-5-5`              | $0.10 / $0.50                             | about $0.0003            |

  \*Assumes about 1,000 input and 400 output tokens, before caching.

  Shortening and translating short text is an easy task, so Haiku is expected to do it well. Because the model is
  just a setting, you can switch without changing code.

## 10. Security checklist (Version 1)

- No secrets in the repo. Env vars are validated at startup and the server won't start if one is missing.
- Passwords are hashed with bcrypt. Refresh tokens are stored hashed and replaced on each use, with reuse detection.
- The request size limit is 100 KB. helmet is on. Unknown fields in requests are removed by zod.
- Login and register are rate-limited. AI usage has a daily limit per user.
- Logs never contain passwords, tokens or Authorization headers.
- Error responses never include stack traces outside development.
- Protection against MongoDB injection: zod-typed inputs mean no user-supplied objects ever reach a query.
- `npm audit` runs in CI or before review.

## 11. Testing strategy (feeds Phase 4 — TDD)

| Level        | Covers                                                                                                                                                          | Tooling                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Unit         | Ticketmaster → `Event` conversion, token service, password rules, AI cache key and prompt builder, personalize service (with the fake AI), saved-events service | Vitest, fixtures from saved real Ticketmaster responses |
| Integration  | Each route end to end through Express. Real Mongo (in memory), fake Ticketmaster and AI providers.                                                              | supertest + mongodb-memory-server                       |
| Contract     | The Ticketmaster mapping is tested against **saved real responses** stored in `test/fixtures/`                                                                  | Vitest                                                  |
| Manual smoke | Real Ticketmaster and Claude keys against the local server                                                                                                      | `.http` file or curl script                             |

- Coverage target: **≥ 80% lines across services and providers**.
- The Google verifier is wrapped behind an interface so tests can fake it. No real Google calls in CI.

## 12. Decisions log

| #   | Decision                | Outcome                                                                                                                                               |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI model                | `claude-haiku-5-5` (configurable through `AI_MODEL`)                                                                                                  |
| 2   | Where the backend lives | Separate project at `C:\Users\Admin\Documents\node\momento-planner-api`, with this spec in that project                                               |
| 3   | MongoDB for development | Free MongoDB Atlas tier (Docker and MongoDB aren't installed). Tests use an in-memory MongoDB.                                                        |
| 4   | Saved events limit      | 100 per user                                                                                                                                          |
| 5   | Event coverage          | English-speaking countries only (GB, US, IE, AU, NZ, CA) for Version 1, because Ticketmaster's language filter is unreliable. Worldwide events later. |
| 6   | When the AI runs        | Only on an explicit user choice: `{ shorten, translateTo? }`, at least one. Translating an (English) event into English skips the AI.                 |
