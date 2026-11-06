# Consuming the API (mobile app guide)

Everything the Momento app needs to talk to this backend. Every endpoint with full request and response examples
is in [API-REFERENCE.md](API-REFERENCE.md) (and [openapi.yaml](openapi.yaml) for tools such as Postman). The formal
contract is [spec.md §7](../spec.md); how it works inside is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Basics

- **Base URL:** `http://10.0.2.2:4000/api/v1` (Android emulator), `http://localhost:4000/api/v1` (iOS simulator),
  `http://<your LAN IP>:4000/api/v1` (physical phone on the same Wi-Fi).
- **Format:** JSON in and out (`Content-Type: application/json`). Request bodies max 100 KB.
- **Auth:** every route except `/auth/*` and `/health` needs `Authorization: Bearer <accessToken>`.
- **Errors** always have this shape. Branch on `code`, show `message`, and use `details` for form field errors:

  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Request validation failed",
      "details": [{ "location": "body", "path": "password", "message": "must contain a digit" }]
    }
  }
  ```

| Code                   | HTTP | Typical app reaction                                           |
| ---------------------- | ---- | -------------------------------------------------------------- |
| `VALIDATION_ERROR`     | 400  | Show field errors from `details`                               |
| `UNAUTHENTICATED`      | 401  | Refresh the token once, retry; if refresh fails, go to sign-in |
| `INVALID_CREDENTIALS`  | 401  | "Email or password is incorrect"                               |
| `NOT_FOUND`            | 404  | Event no longer exists                                         |
| `EMAIL_TAKEN`          | 409  | "An account with this email already exists"                    |
| `SAVED_LIMIT_REACHED`  | 409  | "You can save up to 100 events"                                |
| `PAYLOAD_TOO_LARGE`    | 413  | Shouldn't happen from the app                                  |
| `RATE_LIMITED`         | 429  | "Too many attempts, try again in a few minutes"                |
| `AI_LIMIT_REACHED`     | 429  | "Daily personalization limit reached"; offer the original text |
| `UPSTREAM_UNAVAILABLE` | 502  | "Service busy, try again"; Ticketmaster or AI is down          |
| `INTERNAL`             | 500  | Generic error                                                  |

## Token handling

1. **Sign-in** (`register`, `login` or `google`) returns `{ user, accessToken, refreshToken }`.
   - Keep the **access token in memory**.
   - Save the **refresh token in secure storage** (`expo-secure-store`). Never in AsyncStorage.
2. **On app start:** if a refresh token is stored, call `POST /auth/refresh` to get a fresh pair, then `GET /me`.
3. **On a `401 UNAUTHENTICATED`:** refresh **once**, then retry the original request. If the refresh itself returns
   401, clear storage and send the user to sign-in.
4. ⚠️ **Refresh one at a time ("single-flight").** Each refresh token works exactly once. If two requests both get
   401 and both refresh with the same token, the server sees reuse and **revokes the whole session**. Share one
   in-flight refresh promise across all requests.
5. **Always save the new refresh token** returned by `/auth/refresh`. The old one is dead.
6. **Sign-out:** `POST /auth/logout { refreshToken }`, then clear storage.

## Endpoints

### Auth (no token needed)

| Request               | Body                                             | Success                                              |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `POST /auth/register` | `{ email, password, firstName, lastName }`       | `201 { user, accessToken, refreshToken }`            |
| `POST /auth/login`    | `{ email, password }`                            | `200 { user, accessToken, refreshToken }`            |
| `POST /auth/google`   | `{ idToken }`, a Google ID token from the device | `200 { user, accessToken, refreshToken, isNewUser }` |
| `POST /auth/refresh`  | `{ refreshToken }`                               | `200 { accessToken, refreshToken }`                  |
| `POST /auth/logout`   | `{ refreshToken }`                               | `204` (always)                                       |

Password rules: 8+ characters, at most 72 bytes, at least one letter and one digit. Names: 1–50 characters.
Register, login and Google sign-in share **10 attempts per 15 minutes per IP**.

### Profile

| Request      | Body                                              | Success                                            |
| ------------ | ------------------------------------------------- | -------------------------------------------------- |
| `GET /me`    | —                                                 | `200 { user }`                                     |
| `PATCH /me`  | Any of `{ firstName, lastName, phone, language }` | `200 { user }`                                     |
| `DELETE /me` | —                                                 | `204`. Deletes the account permanently (see below) |

```json
{
  "user": {
    "id": "6730…",
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

- `phone` must be international: start with `+` and a country code. It comes back normalized (`+254712345678`).
  Send `null` to clear it.
- `language` is `en`, `fr` or `sw`. Send it whenever the user changes the app language.
- **`DELETE /me`** permanently deletes the account and everything tied to it: sessions, saved events and AI usage.
  It can't be undone, so ask the user to confirm first. Afterwards, clear the stored tokens and remove the
  calendar entries the app created (their ids are on the device). The email can then be used to sign up again.
- Email can't be changed. Users who signed up with Google may have an empty `lastName`.

### Events

| Request                  | Query / params                                                                        | Success                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /events`            | `q?` (keyword), `category?`, `page=0`, `size=20` (max 50, and `(page+1)*size ≤ 1000`) | `200 { items: EventSummary[], page, size, totalPages, totalItems }`                         |
| `GET /events/categories` | —                                                                                     | `200 { items: [{ id, name }] }`: `music`, `sports`, `arts-theatre`, `film`, `miscellaneous` |
| `GET /events/:id`        | —                                                                                     | `200 { event: Event }` or `404`                                                             |

```json
{
  "event": {
    "id": "G5vYZb4kqZfa5",
    "source": "ticketmaster",
    "title": "Jazz Night",
    "url": "https://www.ticketmaster.co.uk/…",
    "imageUrl": "https://s1.ticketm.net/…16_9….jpg",
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
    "description": "Plain text…",
    "notes": null
  }
}
```

`EventSummary` (in search results) is the same without `description` and `notes`. Things to handle:

- **`start.dateTime` can be `null`** (time to be announced); fall back to `localDate`. Use `dateTime` for the
  calendar entry's start, and `timezone` to show local time.
- **`priceRange` is almost always `null`** (Ticketmaster rarely provides it). Don't design around prices.
- **`description`, `imageUrl`, `venue`, `genre` and `category` can be `null`.** `status` can be `cancelled`,
  `postponed` and so on, so show a badge.
- Version 1 only has events in GB, US, IE, AU, NZ and CA.

### My Events (saved events)

| Request                            | Body / query                 | Success                                                                 |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `GET /me/saved-events`             | `page=0`, `size=20` (max 50) | `200 { items: SavedEventView[], page, size, totalItems }`, newest first |
| `POST /me/saved-events`            | `{ eventId }`                | `201 { savedEvent }` the first time, `200` if already saved             |
| `DELETE /me/saved-events/:eventId` | —                            | `204` (also when it wasn't saved)                                       |

`SavedEventView = { eventId, savedAt, available, event }`. When `available` is `false` the event was removed at the
source (`event` is `null`): show it greyed out with a Remove button.

### AI personalization

`POST /events/:id/personalize` is a **plain REST call to our server**. The app needs no AI SDK and no AI key; the
server talks to Claude.

**Request:** the user's explicit choices. At least one is required.

```json
{ "shorten": true, "translateTo": "sw" }
```

| Field         | Meaning                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `shorten`     | `true` = a short version (about 60 words) keeping the key information                                 |
| `translateTo` | `en`, `fr` or `sw`. Pre-select the user's app language, but only send it if the user chose Translate. |

**Response:**

```json
{
  "title": "Usiku wa Jazz",
  "description": "Jioni ya muziki wa jazz moja kwa moja…",
  "facts": {
    "dateTimeText": "Jumanne, 1 Desemba 2026 saa 19:30",
    "venueText": "Ronnie Scott's, London, Great Britain",
    "url": "https://www.ticketmaster.co.uk/…"
  },
  "cached": false
}
```

- `title`/`description` are written by the AI. `facts` are built by code from the event data (exact, never AI).
- `cached: true` means it came from the shared cache: instant, and it didn't use the user's quota.
- `{ "translateTo": "en" }` alone returns the original text without an AI call.
- Each user gets **20 new AI results per day** (`429 AI_LIMIT_REACHED` after). Cached results are free.
- A call can take a few seconds. Show a loading state, and a retry on `502`.

**Recommended "Set reminder / Book event" flow**

1. The user taps **Set reminder**. Show the Personalize screen with the original text and the options.
2. If they pick options, call `personalize` and show the result **in editable fields**.
3. Build the calendar entry on the device:
   - **title** = `title` (or the event title)
   - **start** = `event.start.dateTime` (or `localDate` as an all-day event), in `event.start.timezone`
   - **notes** = `description` + a blank line + `facts.dateTimeText`, `facts.venueText` and `facts.url`, one per line
   - **alarm** = the reminder the user picked
4. Write it with the device calendar API and **store the calendar entry id on the device**, keyed by `eventId`.
5. `POST /me/saved-events { eventId }` so it appears in My Events.
6. To remove it: delete the calendar entry using the stored id, then `DELETE /me/saved-events/:eventId`.

## Example: sign in and search (TypeScript)

```ts
const API = 'http://10.0.2.2:4000/api/v1';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw (await login.json()).error; // { code, message, details? }
const { user, accessToken, refreshToken } = await login.json();

const res = await fetch(`${API}/events?category=music&q=jazz`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const { items, totalPages } = await res.json();
```

## Not available in Version 1

- **Password change.** Not available yet.
- **Email verification and forgot-password.** The app shows these screens as templates only.
- **Sign in with Apple, location filtering, recommendations, offline mode.** Future features (intent.md).
