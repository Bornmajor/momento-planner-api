# Momento Planner API

[![CI](https://github.com/Bornmajor/momento-planner-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Bornmajor/momento-planner-api/actions/workflows/ci.yml)

Backend for **Momento**, a mobile event planner. Users discover events, save them, and get an AI-written
version of an event (shorter and/or translated into English, French or Swahili) to put in their device calendar.

- **Stack:** Node.js 24, TypeScript, Express 5, MongoDB (Mongoose), zod, Vitest
- **Event source:** Ticketmaster Discovery API (Version 1 covers GB, US, IE, AU, NZ and CA)
- **AI:** Claude (`claude-haiku-5-5` by default) through the Anthropic SDK with structured output
- **Docs:** [docs/API-REFERENCE.md](docs/API-REFERENCE.md) (every endpoint with request and response examples) ·
  [docs/openapi.yaml](docs/openapi.yaml) (OpenAPI 3.1; import into Postman) ·
  [docs/API.md](docs/API.md) (how the app consumes the API) ·
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (modules, auth, secrets, data model) ·
  [CONTRIBUTING.md](CONTRIBUTING.md) · [spec.md](spec.md) (formal contract) · [plan.md](plan.md) (implementation plan)

The mobile app lives in a separate repository (`momento-event-planner-app`) and only talks to this API.

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run dev               # http://localhost:4000
```

| Variable                                                         | Required | Notes                                                                                              |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                                    | yes      | MongoDB Atlas connection string. Add your IP under Atlas → Network Access.                         |
| `JWT_ACCESS_SECRET`                                              | yes      | 32+ random bytes: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TICKETMASTER_API_KEY`                                           | yes      | The **consumer key** from developer.ticketmaster.com                                               |
| `ANTHROPIC_API_KEY`                                              | no       | Without it, a predictable fake AI is used                                                          |
| `GOOGLE_CLIENT_IDS`                                              | no       | Comma-separated OAuth client IDs (web, Android, iOS). Empty disables Google sign-in.               |
| `AI_MODEL`                                                       | no       | Default `claude-haiku-5-5`                                                                         |
| `AI_DAILY_LIMIT_PER_USER`                                        | no       | Default 20 uncached AI calls per user per day                                                      |
| `PORT`, `NODE_ENV`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | no       | Defaults: 4000, development, 15m, 30                                                               |

`CORS_ORIGINS` is reserved for a future web client and isn't used yet (mobile apps don't need CORS).

### Connecting from the mobile app

| Where the app runs          | API base URL                                  |
| --------------------------- | --------------------------------------------- |
| Android emulator            | `http://10.0.2.2:4000/api/v1`                 |
| iOS simulator               | `http://localhost:4000/api/v1`                |
| Physical phone (same Wi-Fi) | `http://<your computer's LAN IP>:4000/api/v1` |

## Scripts

| Command                                                 | What it does                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                                           | Start with auto-reload                                                                                                                                                         |
| `npm run build` / `npm start`                           | Compile to `dist/` / run the compiled server                                                                                                                                   |
| `npm test`                                              | All tests (`test:unit` needs no database; `test:integration` uses an in-memory MongoDB)                                                                                        |
| `npm run coverage`                                      | Tests with a coverage report                                                                                                                                                   |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code quality                                                                                                                                                                   |
| `npx tsx --env-file=.env scripts/e2e-smoke.ts`          | End-to-end check with the **real** Ticketmaster and Claude (in-memory DB). Add `--atlas` to use your Atlas cluster (a throwaway `momento-smoke` database, dropped afterwards). |
| `npx tsx --env-file=.env scripts/live-check.ts`         | One Ticketmaster search plus one Claude call, no database                                                                                                                      |

The first test run downloads a MongoDB server binary (~800 MB) for the in-memory database. It's cached in
`node_modules/.cache/mongodb-memory-server` and reused afterwards.

## API overview

Base path `/api/v1`. Send `Authorization: Bearer <accessToken>` on everything except auth and `/health`.
Errors always look like `{ "error": { "code", "message", "details?" } }`. The full contract is in [spec.md §7](spec.md).

| Method & path                                          | Purpose                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `POST /auth/register` · `/auth/login` · `/auth/google` | Sign up / sign in. Returns `{ user, accessToken, refreshToken }`                           |
| `POST /auth/refresh` · `/auth/logout`                  | Rotate tokens / revoke a refresh token                                                     |
| `GET /me` · `PATCH /me` · `DELETE /me`                 | Profile: first name, last name, phone (E.164), language (`en`, `fr`, `sw`); delete account |
| `GET /events?q=&category=&page=&size=`                 | Search upcoming events                                                                     |
| `GET /events/categories` · `GET /events/:id`           | Category list / event details                                                              |
| `GET` · `POST` · `DELETE /me/saved-events`             | My Events (event ids only; details loaded live)                                            |
| `POST /events/:id/personalize`                         | `{ shorten, translateTo? }`. AI runs only on these explicit choices.                       |
| `GET /health`                                          | Liveness and database status                                                               |

[requests.http](requests.http) has ready-made requests for the VS Code REST Client extension.

## Project structure

Each feature is a module with thin routes (HTTP and validation) over a service (the logic). Outside services
(Ticketmaster, Claude, Google) sit behind small provider interfaces, so tests swap in fakes. Everything is wired in
`src/container.ts`. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the modules, a request flow, auth and the
data model.

```text
src/
  modules/        One folder per feature: auth, users, events, saved-events, personalize
    <feature>/      *.routes.ts (endpoints + zod validation) · *.service.ts (logic, where there is any) · *.schemas.ts
  providers/      Outside services behind interfaces: events/ (Ticketmaster + mapper), ai/ (Claude, fake for tests)
  models/         Mongoose models: user, refresh token, saved event, AI cache and usage
  middleware/     Validation, auth, rate limits, error handler (one error shape for every response)
  lib/  config/   Errors, logger, database, environment (checked with zod at start-up)
  app.ts          Express app: security headers, routes under /api/v1, error handling
  container.ts    Creates the services and providers (swapped for fakes in tests)
  server.ts       Start-up and graceful shutdown
test/
  unit/           No database: providers, validation, errors, password rules
  integration/    Real HTTP requests (supertest) against an in-memory MongoDB
```

Every pull request runs format, lint, typecheck, build and all tests in GitHub Actions ([ci.yml](.github/workflows/ci.yml)).

## Design notes

- **Thin client:** the app never calls Ticketmaster or Claude, so no third-party keys ship in the app.
- **Tokens:** 15-minute JWT access tokens, plus 30-day refresh tokens stored only as SHA-256 hashes and replaced on
  every use. Reusing an old refresh token revokes its whole chain.
- **AI safety and cost:** dates, times, venue and ticket link are built by code, never by the AI. Results are cached
  for 30 days and shared across users, and each user has a daily limit on uncached calls.
- **Ticketmaster limits:** calls are spaced to 4 per second and cached (search 5 min, details 1 h). My Events loads a
  whole page of saved events with one batch call.

## Before hosting publicly

- Set `app.set('trust proxy', 1)` (or your proxy's hop count) so rate limits see real client IPs.
- Use separate production keys for Ticketmaster and Anthropic, not the development ones.
- Restrict the Atlas network allowlist to the host's IPs.

## License

[ISC](LICENSE) © 2026 Bornmajor
