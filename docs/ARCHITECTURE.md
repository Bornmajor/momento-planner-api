# Architecture

How the Momento Planner API is put together: the modules, how a request flows, how authentication and
secrets work, and what's stored in the database. For the formal contract see [spec.md](../spec.md); for
consuming the API from the app see [API.md](API.md).

## Modules and their roles

```
src/
  server.ts            Entry point: reads env, connects MongoDB, builds services, starts HTTP, graceful shutdown
  app.ts               Builds the Express app (no listen): middleware, routers, 404 and error handling
  container.ts         Wires services together (real providers in server.ts, fakes in tests)

  config/
    env.ts             Loads and validates environment variables with zod; the only place env is parsed
    constants.ts       Fixed settings (e.g. the countries searched in Version 1)

  lib/
    errors.ts          AppError + the error-code → HTTP-status table
    logger.ts          pino logger with secret redaction
    db.ts              MongoDB connect/disconnect/health, injection protection (sanitizeFilter)
    app-info.ts        API prefix (/api/v1)

  middleware/
    validate.ts        zod validation of params/query/body → req.valid (unknown fields dropped)
    require-auth.ts    Checks "Authorization: Bearer <token>", loads the user → req.user
    rate-limit.ts      Per-IP limits (login/register/Google, refresh/logout)
    error-handler.ts   Turns every error into { error: { code, message, details? } }
    not-found.ts       404 for unknown routes

  models/              Mongoose schemas (see "Data model" below)
    user.model.ts  refresh-token.model.ts  saved-event.model.ts  ai.models.ts

  modules/             One folder per feature: routes (HTTP) → service (rules) → providers/models
    auth/              Register, login, Google sign-in, refresh, logout; passwords and tokens
    users/             GET/PATCH /me (profile)
    events/            Search, details, categories; the Event type and category list
    saved-events/      My Events (save, list, remove)
    personalize/       AI personalization: quota, cache, facts built by code

  providers/           Adapters to outside services, behind interfaces so they can be swapped or faked
    events/            Ticketmaster: HTTP client, rate spacing, caching, mapping to our Event shape
    ai/                Claude (Anthropic SDK), a fake AI for tests/dev, the prompt
```

**Layering rule:** routes only handle HTTP (validation, status codes). Services hold the business rules and
never touch `req`/`res`. Providers are the only code that talks to Ticketmaster or Claude. This is why every
outside service can be replaced by a fake in tests.

## How a request flows (example: sign up)

```
App ── POST /api/v1/auth/register {email, password, firstName, lastName} ──▶ Express
  1. helmet, request logging, JSON body parsing (max 100 KB)
  2. rate limit (10 per 15 min per IP, shared by register/login/Google)
  3. validate: email trimmed+lowercased, password rules, names 1–50 chars, unknown fields dropped
  4. auth.service.register:
       - email already used?            → 409 EMAIL_TAKEN
       - hash password (bcrypt, cost 12)
       - create User in MongoDB
       - issue tokens (access JWT + refresh token)
  5. 201 { user, accessToken, refreshToken }   (user is the public shape, never the password hash)
Any error at any step → error-handler → { error: { code, message, details? } }
```

Login is the same shape: find user by email → compare password with bcrypt → issue tokens. Wrong password,
unknown email and "this account only uses Google" all return the **same** `401 INVALID_CREDENTIALS`, so the
API never reveals which emails are registered.

## Authentication: how the client proves who it is

The client uses **two tokens**:

| Token             | What it is                                                                | Lifetime   | Where the app keeps it                    | Sent as                                                          |
| ----------------- | ------------------------------------------------------------------------- | ---------- | ----------------------------------------- | ---------------------------------------------------------------- |
| **Access token**  | A JWT (HS256) whose `sub` is the user id, signed with `JWT_ACCESS_SECRET` | 15 minutes | In memory                                 | `Authorization: Bearer <accessToken>` on every protected request |
| **Refresh token** | 32 random bytes (base64url). The server stores only its SHA-256 hash.     | 30 days    | Secure storage (e.g. `expo-secure-store`) | Body of `POST /auth/refresh` and `/auth/logout` only             |

- **Every protected route** runs `requireAuth`: it verifies the JWT signature and expiry, then loads the user.
  A missing, expired or forged token, or a deleted user, gives `401 UNAUTHENTICATED`.
- **When the access token expires** the app calls `POST /auth/refresh` with the refresh token. It gets a **new
  pair**: the old refresh token is now used up (rotation).
- **Reuse detection:** presenting a refresh token that was already rotated revokes its whole chain (it suggests
  theft), and the user must sign in again. Consequence for the app: **never refresh twice in parallel** (see
  [API.md → Token handling](API.md#token-handling)).
- **Google sign-in:** the app gets a Google **ID token** on the device and sends it to `POST /auth/google`. The
  server verifies it with Google's library (signature, expiry, issuer, and that its audience is one of
  `GOOGLE_CLIENT_IDS`), then signs the user in, links to an existing account with the same Google-verified email,
  or creates a new account. The response is the same token pair as a normal login.

## Secrets: where they live and how code reads them

1. **Stored only in `.env`** in the project root. It's git-ignored; `.env.example` (committed) lists the names
   with placeholder values.
2. **Loaded by Node itself**: the `dev` and `start` scripts run with `--env-file=.env`, so there's no `dotenv`
   dependency.
3. **Validated once at startup**: `server.ts` calls `loadEnv(process.env)` (`config/env.ts`). If a required value
   is missing or invalid (e.g. a JWT secret under 32 bytes) the server refuses to start and names the variable,
   **never printing its value**.
4. **Passed explicitly, never read globally**: `server.ts` hands the values to `createServices(...)` and the
   providers (`createTicketmasterProvider({ apiKey })`, `createClaudeProvider({ apiKey })`). Feature code never
   reads `process.env`; that makes it testable with fake values and keeps secrets in one place.
5. **Kept out of logs and responses**: the logger redacts `Authorization` headers and any `password`,
   `accessToken`, `refreshToken` or `idToken` field. The Ticketmaster key is added to outgoing URLs only inside
   the provider, and upstream failure reasons are logged, never sent to clients.
6. **Never in the mobile app**: Ticketmaster and Anthropic keys exist only on the server. The app only ever
   holds the user's own tokens.

## AI personalization: how it's integrated

- **The app calls our REST endpoint**, `POST /api/v1/events/:id/personalize`. It never calls Claude directly
  and needs no SDK.
- **The server uses the official Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) in
  `providers/ai/claude.provider.ts`, with **structured output** (`client.messages.parse` + a zod schema), so the
  reply is always `{ title, description }` and is validated before use. Model: `AI_MODEL`
  (default `claude-haiku-5-5`), low effort.
- **Flow inside the service** (`modules/personalize/personalize.service.ts`):
  1. Load the event (404 if unknown).
  2. Build the **facts** in code: date/time in the event's own time zone, written in the target language
     (`Intl.DateTimeFormat`), the venue, and the ticket link. The AI never produces these, so they can't be wrong.
  3. If the only option is "translate to English", return the original text: **no AI call** (Version 1 events
     are English).
  4. Look up the **shared cache** (key = event + options + language + prompt version + model). On a hit, return it
     with `cached: true`. No AI call, no quota used.
  5. Otherwise reserve one unit of the user's **daily quota** (20 by default), call Claude, store the result in
     the cache for 30 days, and return it. If Claude fails, the quota unit is refunded.
- **Prompt safety:** the event's text goes inside `<event>…</event>` and the system prompt says it's data, not
  instructions. The model is told to use only facts present, write plain text, and leave out dates, prices,
  links and addresses.
- **Without `ANTHROPIC_API_KEY`** a fake provider returns predictable text, so the whole flow works offline.

## Data model (MongoDB)

| Collection            | Key fields                                                                                                                                          | Notes                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`               | `email` (unique, lowercase), `passwordHash?`, `googleId?` (unique when set), `firstName`, `lastName`, `phone?` (E.164), `language` (`en`/`fr`/`sw`) | Serialized to the public shape: `{ id, email, firstName, lastName, phone, language, authProviders, createdAt }`. `passwordHash` and `googleId` are never returned. |
| `refresh_tokens`      | `userId`, `tokenHash` (unique), `family`, `expiresAt`, `revokedAt`, `replacedBy`                                                                    | Auto-deleted by MongoDB when `expiresAt` passes (TTL index)                                                                                                        |
| `saved_events`        | `userId`, `source` (`ticketmaster`), `eventId`, `createdAt`                                                                                         | Unique per user+event. Only ids are stored; details are fetched live. Max 100 per user.                                                                            |
| `ai_personalizations` | `key` (unique), `result { title, description }`, `createdAt`                                                                                        | Shared AI cache, auto-deleted after 30 days                                                                                                                        |
| `ai_usage`            | `userId`, `day` (UTC `YYYY-MM-DD`), `count`                                                                                                         | Daily AI quota per user, auto-deleted after 7 days                                                                                                                 |

**Not stored on the server:** event details (always fetched from Ticketmaster, cached in memory), the device
calendar entry id (each phone's calendar has its own ids), and the theme preference.

**App-facing types** (full definitions in [spec.md §7](../spec.md)): `PublicUser`, `Event` /
`EventSummary` (our own event shape, independent of Ticketmaster), `SavedEventView` (`{ eventId, savedAt,
available, event }`), and the personalize result `{ title, description, facts, cached }`.

## Ticketmaster integration in one paragraph

`providers/events/ticketmaster.provider.ts` calls the Discovery API with the key, searching GB, US, IE, AU, NZ and
CA only (upcoming events, date order). Calls are spaced to 4 per second (the limit is 5) and cached in memory:
searches 5 minutes, event details 1 hour, "not found" 10 minutes. My Events fetches a whole page of saved ids in
**one** batch call. Responses are mapped to our `Event` shape, and HTML in descriptions is converted to plain text.
