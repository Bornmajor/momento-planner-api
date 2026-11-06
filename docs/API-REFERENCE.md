# API Reference

Every endpoint of the Momento Planner API with its request and example responses.

- **Machine-readable version:** [openapi.yaml](openapi.yaml) (OpenAPI 3.1). Import it into Postman
  (**Import → File**) to get a ready-made collection, or open it in any Swagger/OpenAPI viewer.
- **How to use the API from the app** (token handling, the personalize flow): [API.md](API.md).

## Conventions

|                    |                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Base URL**       | `http://localhost:4000/api/v1` locally, `https://<your-domain>.ngrok-free.app/api/v1` through ngrok      |
| **Format**         | JSON request and response bodies, `Content-Type: application/json`, max 100 KB                           |
| **Auth**           | 🔒 = protected route: send `Authorization: Bearer <accessToken>`. See [Authentication](#authentication). |
| **IDs**            | User ids are MongoDB ObjectIds; event ids are Ticketmaster ids (letters, digits, `-`, `_`)               |
| **Dates**          | ISO 8601 strings in UTC, e.g. `2026-11-06T10:00:00.000Z`                                                 |
| **Unknown fields** | Ignored and dropped from request bodies                                                                  |

## Authentication

Every route marked 🔒 is **protected**: it needs the user's **access token** in the `Authorization` header.
Without it (or with a bad one) the API answers `401 UNAUTHENTICATED`.

### 1. Get an access token

Sign in with `POST /auth/register`, `POST /auth/login` or `POST /auth/google`. The response contains:

```json
{ "user": { "...": "..." }, "accessToken": "eyJhbGciOiJIUzI1NiJ9…", "refreshToken": "q3J8m1Vv2xYb0k…" }
```

| Token          | Use it for                                                                              | Lifetime            |
| -------------- | --------------------------------------------------------------------------------------- | ------------------- |
| `accessToken`  | The `Authorization` header of every 🔒 request                                          | **15 minutes**      |
| `refreshToken` | Only the body of `POST /auth/refresh` and `POST /auth/logout`. **Never** in the header. | 30 days, single use |

### 2. Send it on protected requests

The header is the word `Bearer`, one space, then the access token:

```http
GET /api/v1/events?category=music HTTP/1.1
Host: localhost:4000
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9…
```

```bash
curl http://localhost:4000/api/v1/events?category=music \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9…"
```

```ts
await fetch(`${API}/events?category=music`, { headers: { Authorization: `Bearer ${accessToken}` } });
```

**In Postman:**

1. In the login (or register) request's **Scripts → Post-response** tab, save the tokens:
   `pm.environment.set('token', pm.response.json().accessToken); pm.environment.set('refresh', pm.response.json().refreshToken);`
2. On the collection (or each 🔒 request), go to **Authorization → Bearer Token** and enter `{{token}}`. Postman adds the
   `Bearer ` prefix for you.

### 3. When the access token expires

After 15 minutes protected requests return `401`. Get a new pair without signing in again:

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "q3J8m1Vv2xYb0k…" }
```

Use the new `accessToken` and **keep the new `refreshToken`**: the old one no longer works. Don't send two refreshes
at once with the same token; the second counts as reuse and ends the session (see [API.md](API.md#token-handling)).

### Public and protected routes

| Public (no token)                                                     | Protected 🔒 (`Authorization: Bearer <accessToken>`)                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /health`                                                         | `GET` · `PATCH` · `DELETE /me`                                       |
| `POST /auth/register`                                                 | `GET /events`, `GET /events/categories`, `GET /events/{id}`          |
| `POST /auth/login`                                                    | `POST /events/{id}/personalize`                                      |
| `POST /auth/google`                                                   | `GET` · `POST /me/saved-events`, `DELETE /me/saved-events/{eventId}` |
| `POST /auth/refresh`, `POST /auth/logout` (refresh token in the body) |                                                                      |

### Why a protected request returns 401

| Cause                                                             | Fix                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| No `Authorization` header                                         | Add `Authorization: Bearer <accessToken>`                                             |
| The `Bearer ` prefix is missing (just the token)                  | Use `Bearer <token>`, or Postman's **Bearer Token** auth type                         |
| The **refresh** token was sent instead of the access token        | Send `accessToken`; the refresh token only goes to `/auth/refresh` and `/auth/logout` |
| The access token is older than 15 minutes                         | Call `POST /auth/refresh`, or sign in again                                           |
| The user was deleted (`DELETE /me`, or the database was cleared)  | Register again                                                                        |
| The token came from a server with a different `JWT_ACCESS_SECRET` | Sign in again against this server                                                     |

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "Authentication required" } }
```

### Error format

Every error has the same shape. `details` is only present for validation errors.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "location": "body", "path": "password", "message": "must contain a digit" }]
  }
}
```

| Code                   | Status | Meaning                                                                                                                       |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`     | 400    | Invalid input or malformed JSON. `details[]` lists each problem: `location` (`body`, `query` or `params`), `path`, `message`. |
| `UNAUTHENTICATED`      | 401    | Missing, invalid or expired token                                                                                             |
| `INVALID_CREDENTIALS`  | 401    | Wrong email or password                                                                                                       |
| `NOT_FOUND`            | 404    | Event or route doesn't exist                                                                                                  |
| `EMAIL_TAKEN`          | 409    | Email already registered (or can't be linked to Google)                                                                       |
| `SAVED_LIMIT_REACHED`  | 409    | User already has 100 saved events                                                                                             |
| `PAYLOAD_TOO_LARGE`    | 413    | Body over 100 KB                                                                                                              |
| `RATE_LIMITED`         | 429    | Too many requests from this IP                                                                                                |
| `AI_LIMIT_REACHED`     | 429    | Daily AI personalization limit reached                                                                                        |
| `INTERNAL`             | 500    | Unexpected server error                                                                                                       |
| `UPSTREAM_UNAVAILABLE` | 502    | Ticketmaster or the AI service failed                                                                                         |

**Rate limits:** register, login and Google sign-in share **10 requests per 15 minutes per IP**; refresh and logout
share **30**. Responses include `RateLimit` and `RateLimit-Policy` headers.

---

## Health

### `GET /health`

Liveness and database status. Not under `/api/v1`, and no auth.

**200**

```json
{ "status": "ok", "db": "up" }
```

`db` is `"down"` when MongoDB is unreachable (the status is still 200).

---

## Auth

### `POST /auth/register`

Create an account with email and password.

**Body**

| Field       | Type   | Rules                                                              |
| ----------- | ------ | ------------------------------------------------------------------ |
| `email`     | string | Valid email. Stored lowercased.                                    |
| `password`  | string | 8+ characters, at most 72 bytes, at least one letter and one digit |
| `firstName` | string | 1–50 characters, trimmed                                           |
| `lastName`  | string | 1–50 characters, trimmed                                           |

```json
{ "email": "ada@example.com", "password": "Passw0rd!", "firstName": "Ada", "lastName": "Lovelace" }
```

**201**

```json
{
  "user": {
    "id": "672b9f0c5e1d4a0012ab34cd",
    "email": "ada@example.com",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "phone": null,
    "language": "en",
    "authProviders": ["password"],
    "createdAt": "2026-11-06T10:00:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI2NzJiOWYwYz…",
  "refreshToken": "q3J8m1Vv2xYb0kQz7tW5nLp4sR9cE6dH1aF0gU8iO2M"
}
```

**Errors:** `400 VALIDATION_ERROR` · `409 EMAIL_TAKEN` · `429 RATE_LIMITED`

<details><summary>400 example (weak password)</summary>

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "location": "body", "path": "password", "message": "must contain a digit" }]
  }
}
```

</details>

### `POST /auth/login`

**Body**

```json
{ "email": "ada@example.com", "password": "Passw0rd!" }
```

**200**: same as register: `{ user, accessToken, refreshToken }`.

**Errors:** `400 VALIDATION_ERROR` · `401 INVALID_CREDENTIALS` · `429 RATE_LIMITED`

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password" } }
```

The same error is returned for an unknown email, a wrong password, and an account that only uses Google.

### `POST /auth/google`

Sign in or sign up with a Google ID token obtained on the device.

**Body**

```json
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij…" }
```

**200**: `{ user, accessToken, refreshToken, isNewUser }`

```json
{
  "user": {
    "id": "672ba1d75e1d4a0012ab3501",
    "email": "grace@example.com",
    "firstName": "Grace",
    "lastName": "Hopper",
    "phone": null,
    "language": "en",
    "authProviders": ["google"],
    "createdAt": "2026-11-06T10:05:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9…",
  "refreshToken": "Zx8vN2cQ…",
  "isNewUser": true
}
```

If an account with the same email exists and Google verified that email, the Google login is linked to it
(`authProviders: ["password", "google"]`, `isNewUser: false`).

**Errors:** `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED` (invalid token, or Google sign-in not configured) ·
`409 EMAIL_TAKEN` (email exists but Google didn't verify it) · `429 RATE_LIMITED`

### `POST /auth/refresh`

Swap a refresh token for a new token pair. The old refresh token stops working.

**Body**

```json
{ "refreshToken": "q3J8m1Vv2xYb0kQz7tW5nLp4sR9cE6dH1aF0gU8iO2M" }
```

**200**

```json
{ "accessToken": "eyJhbGciOiJIUzI1NiJ9…", "refreshToken": "N7bV1xQ…" }
```

**Errors:** `401 UNAUTHENTICATED` (unknown, expired, revoked or **reused** token. Reuse also ends the whole
session) · `429 RATE_LIMITED`

### `POST /auth/logout`

Revoke a refresh token.

**Body**

```json
{ "refreshToken": "N7bV1xQ…" }
```

**204**: no body. Also returned for an unknown token.

---

## Profile 🔒

### `GET /me`

**200**

```json
{
  "user": {
    "id": "672b9f0c5e1d4a0012ab34cd",
    "email": "ada@example.com",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "phone": "+254712345678",
    "language": "sw",
    "authProviders": ["password"],
    "createdAt": "2026-11-06T10:00:00.000Z"
  }
}
```

### `PATCH /me`

Update any of these fields; omitted fields don't change.

| Field       | Type                       | Rules                                                                                  |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `firstName` | string                     | 1–50 characters                                                                        |
| `lastName`  | string                     | 1–50 characters                                                                        |
| `phone`     | string \| null             | International format with `+` and a country code; returned as E.164. `null` clears it. |
| `language`  | `"en"` \| `"fr"` \| `"sw"` | App language, and the default for AI translation                                       |

```json
{ "firstName": "Augusta", "phone": "+254 712 345 678", "language": "sw" }
```

**200**: `{ user }` with the updated values (`"phone": "+254712345678"`).

**Errors:** `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED`. `email`, `googleId` and passwords can't be
changed here; those fields are ignored.

### `DELETE /me`

Permanently delete the account, its sessions, saved events and AI usage. This can't be undone.

**204**: no body.

**Errors:** `401 UNAUTHENTICATED`

---

## Events 🔒

### `GET /events`

Search upcoming events (Version 1: GB, US, IE, AU, NZ, CA), soonest first.

| Query      | Type    | Default | Rules                                                        |
| ---------- | ------- | ------- | ------------------------------------------------------------ |
| `q`        | string  | —       | Keyword, 1–100 characters                                    |
| `category` | string  | —       | `music`, `sports`, `arts-theatre`, `film` or `miscellaneous` |
| `page`     | integer | `0`     | 0-based                                                      |
| `size`     | integer | `20`    | 1–50, and `(page + 1) × size ≤ 1000`                         |

`GET /events?q=jazz&category=music&page=0&size=2`

**200**

```json
{
  "items": [
    {
      "id": "G5vYZb4kqZfa5",
      "source": "ticketmaster",
      "title": "Jazz Night",
      "url": "https://www.ticketmaster.co.uk/event/G5vYZb4kqZfa5",
      "imageUrl": "https://s1.ticketm.net/dam/a/123/abc_RETINA_LANDSCAPE_16_9.jpg",
      "start": {
        "localDate": "2026-12-01",
        "localTime": "19:30:00",
        "dateTime": "2026-12-01T19:30:00Z",
        "timezone": "Europe/London"
      },
      "status": "onsale",
      "category": { "id": "music", "name": "Music" },
      "genre": "Jazz",
      "venue": {
        "name": "Ronnie Scott's",
        "city": "London",
        "country": "Great Britain",
        "address": "47 Frith St"
      },
      "priceRange": null
    }
  ],
  "page": 0,
  "size": 2,
  "totalPages": 12,
  "totalItems": 23
}
```

Search items have no `description` or `notes`; fetch the event for those.

**Errors:** `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED` · `502 UPSTREAM_UNAVAILABLE`

### `GET /events/categories`

**200**

```json
{
  "items": [
    { "id": "music", "name": "Music" },
    { "id": "sports", "name": "Sports" },
    { "id": "arts-theatre", "name": "Arts & Theatre" },
    { "id": "film", "name": "Film" },
    { "id": "miscellaneous", "name": "Miscellaneous" }
  ]
}
```

### `GET /events/{id}`

**200**: the full event: the search item fields plus `description` and `notes` (plain text, or `null`).

```json
{
  "event": {
    "id": "G5vYZb4kqZfa5",
    "source": "ticketmaster",
    "title": "Jazz Night",
    "url": "https://www.ticketmaster.co.uk/event/G5vYZb4kqZfa5",
    "imageUrl": "https://s1.ticketm.net/dam/a/123/abc_RETINA_LANDSCAPE_16_9.jpg",
    "start": {
      "localDate": "2026-12-01",
      "localTime": "19:30:00",
      "dateTime": "2026-12-01T19:30:00Z",
      "timezone": "Europe/London"
    },
    "status": "onsale",
    "category": { "id": "music", "name": "Music" },
    "genre": "Jazz",
    "venue": {
      "name": "Ronnie Scott's",
      "city": "London",
      "country": "Great Britain",
      "address": "47 Frith St"
    },
    "priceRange": null,
    "description": "An evening of live jazz with three bands, a late bar and a closing jam session.",
    "notes": "Over 18s only. No re-entry."
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (malformed id) · `401` · `404 NOT_FOUND` · `502 UPSTREAM_UNAVAILABLE`

**Field notes**

| Field                                                            | Values / notes                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `status`                                                         | `onsale`, `offsale`, `cancelled`, `postponed`, `rescheduled`, `unknown` |
| `start.dateTime`                                                 | UTC start, or `null` when the time isn't announced (use `localDate`)    |
| `start.timezone`                                                 | IANA zone of the venue, e.g. `Australia/Sydney`                         |
| `priceRange`                                                     | `{ min, max, currency }`, but almost always `null`                      |
| `imageUrl`, `category`, `genre`, `venue`, `description`, `notes` | Can be `null`                                                           |

---

## Saved events (My Events) 🔒

### `GET /me/saved-events`

| Query  | Default | Rules   |
| ------ | ------- | ------- |
| `page` | `0`     | 0-based |
| `size` | `20`    | 1–50    |

**200**: newest first.

```json
{
  "items": [
    {
      "eventId": "G5vYZb4kqZfa5",
      "savedAt": "2026-11-06T10:15:00.000Z",
      "available": true,
      "event": { "id": "G5vYZb4kqZfa5", "title": "Jazz Night", "...": "full Event, as in GET /events/{id}" }
    },
    {
      "eventId": "vvG1fZ9pRkQwXy",
      "savedAt": "2026-11-05T18:02:00.000Z",
      "available": false,
      "event": null
    }
  ],
  "page": 0,
  "size": 20,
  "totalItems": 2
}
```

`available: false` means the event no longer exists at the source.

### `POST /me/saved-events`

**Body**

```json
{ "eventId": "G5vYZb4kqZfa5" }
```

**201** (newly saved) or **200** (already saved)

```json
{
  "savedEvent": {
    "eventId": "G5vYZb4kqZfa5",
    "source": "ticketmaster",
    "savedAt": "2026-11-06T10:15:00.000Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR` · `401` · `404 NOT_FOUND` (event doesn't exist) · `409 SAVED_LIMIT_REACHED`

```json
{ "error": { "code": "SAVED_LIMIT_REACHED", "message": "You can save at most 100 events" } }
```

### `DELETE /me/saved-events/{eventId}`

**204**: no body. Also returned when the event wasn't saved.

---

## AI personalization 🔒

### `POST /events/{id}/personalize`

Shorten and/or translate an event's text for a calendar entry. The AI runs only for the options chosen.

**Body**: at least one option is required.

| Field         | Type                       | Default | Meaning                                                      |
| ------------- | -------------------------- | ------- | ------------------------------------------------------------ |
| `shorten`     | boolean                    | `false` | A short version (about 60 words) keeping the key information |
| `translateTo` | `"en"` \| `"fr"` \| `"sw"` | —       | Output language. Without it, the original language is kept.  |

```json
{ "shorten": true, "translateTo": "sw" }
```

**200**

```json
{
  "title": "Usiku wa Jazz",
  "description": "Jioni ya muziki wa jazz moja kwa moja na bendi tatu, baa ya usiku na kipindi cha kucheza pamoja mwishoni.",
  "facts": {
    "dateTimeText": "Jumanne, 1 Desemba 2026 saa 19:30",
    "venueText": "Ronnie Scott's, London, Great Britain",
    "url": "https://www.ticketmaster.co.uk/event/G5vYZb4kqZfa5"
  },
  "cached": false
}
```

| Field                  | Notes                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `title`, `description` | Written by the AI (plain text)                                                       |
| `facts`                | Built by the server from the event data, never by the AI. `venueText` can be `null`. |
| `cached`               | `true` = served from the shared cache (instant, doesn't use the daily limit)         |

`{ "translateTo": "en" }` alone returns the original title and description with no AI call.

**Errors:** `400 VALIDATION_ERROR` (no option chosen, or an unsupported language) · `401` · `404 NOT_FOUND` ·
`429 AI_LIMIT_REACHED` (20 new results per user per day) · `502 UPSTREAM_UNAVAILABLE`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "location": "body", "path": "", "message": "choose shorten and/or translateTo" }]
  }
}
```
