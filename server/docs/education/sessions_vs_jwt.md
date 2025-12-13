# Sessions vs JWT: Understanding Web Authentication

This document explains the authentication problem we solved and why it matters for serverless deployment.

---

## The Problem

We had a working app with **session-based authentication**. But when we wanted to deploy to **Vercel** (serverless), sessions don't work. Why?

---

## How Sessions Work

```
┌─────────┐         ┌─────────────────────────────────────┐
│ Browser │         │           Express Server            │
└────┬────┘         │  ┌─────────────────────────────┐    │
     │              │  │     Memory / Database       │    │
     │   Login      │  │  ┌─────────────────────┐    │    │
     │─────────────>│  │  │ Session Store       │    │    │
     │              │  │  │                     │    │    │
     │              │  │  │ sid123 → {          │    │    │
     │              │  │  │   username: "amir"  │    │    │
     │              │  │  │   role: "manager"   │    │    │
     │              │  │  │ }                   │    │    │
     │              │  │  └─────────────────────┘    │    │
     │<─────────────│  └─────────────────────────────┘    │
     │ Cookie:      │                                     │
     │ sid=sid123   │                                     │
     │              │                                     │
     │   Request    │                                     │
     │   + Cookie   │                                     │
     │─────────────>│  Server looks up sid123             │
     │              │  Finds user data                    │
     │<─────────────│  Returns protected data             │
└─────────┘         └─────────────────────────────────────┘
```

### Key Points:
1. **Server stores session data** in memory or database
2. **Browser gets a cookie** with just a session ID (like a ticket number)
3. **Every request**, browser sends cookie, server looks up the session
4. **Server is stateful** - it remembers who you are

### The Code (Before):

```typescript
// server/index.ts - Setting up sessions
import session from 'express-session';
import PgSession from 'connect-pg-simple';

app.use(session({
  store: new PgSession({ pool: pgPool }),  // Store sessions in PostgreSQL
  secret: 'my-secret-key',
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }  // 30 days
}));

// server/routes.ts - Using sessions
app.post('/api/auth/login', (req, res) => {
  // After validating password...
  req.session.user = { username: 'amir', role: 'manager' };
  res.json({ success: true });
});

app.get('/api/customers', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Not logged in' });
  }
  // User is authenticated, return data
});
```

---

## Why Sessions Break in Serverless

```
┌─────────┐         ┌─────────────────────────────────────┐
│ Browser │         │         Vercel Serverless           │
└────┬────┘         │                                     │
     │              │  Request 1 → Function Instance A    │
     │   Login      │              (starts, runs, dies)   │
     │─────────────>│                                     │
     │              │  Request 2 → Function Instance B    │
     │   Request    │              (starts, runs, dies)   │
     │─────────────>│              ❌ No memory of you!   │
     │              │                                     │
└─────────┘         └─────────────────────────────────────┘
```

### The Problem:
1. **Serverless functions are ephemeral** - they start, run, and die
2. **No persistent memory** - each request might hit a different instance
3. **No shared state** - Instance B doesn't know what Instance A did
4. **Cold starts** - functions might not even be running when you call them

Even with a database session store, there are issues:
- Connection pooling is tricky
- Session lookup adds latency
- More database load

---

## How JWT Works

```
┌─────────┐         ┌─────────────────────────────────────┐
│ Browser │         │           Any Server                │
└────┬────┘         │         (no state needed)           │
     │              │                                     │
     │   Login      │                                     │
     │─────────────>│  Server creates JWT:                │
     │              │  {                                  │
     │              │    "username": "amir",              │
     │              │    "role": "manager",               │
     │              │    "exp": 1767819727                │
     │              │  }                                  │
     │              │  + signs it with secret key         │
     │<─────────────│                                     │
     │ Token: eyJ... │                                    │
     │              │                                     │
     │ localStorage │                                     │
     │ saves token  │                                     │
     │              │                                     │
     │   Request    │                                     │
     │   + Token    │                                     │
     │─────────────>│  Server verifies signature          │
     │              │  Decodes user data from token       │
     │              │  No database lookup needed!         │
     │<─────────────│  Returns protected data             │
└─────────┘         └─────────────────────────────────────┘
```

### Key Points:
1. **Server is stateless** - doesn't store anything
2. **Token contains all user data** - encrypted and signed
3. **Browser stores the token** - in localStorage or memory
4. **Any server can verify** - just needs the secret key

### The Code (After):

```typescript
// server/lib/jwt.ts - JWT utilities
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signToken(payload: { username: string; role: string }) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;  // Invalid or expired
  }
}

// server/routes.ts - Using JWT
app.post('/api/auth/login', (req, res) => {
  // After validating password...
  const token = signToken({ username: 'amir', role: 'manager' });
  res.json({ token, user: { username: 'amir', role: 'manager' } });
});

app.get('/api/customers', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = verifyToken(token);
  
  if (!user) {
    return res.status(401).json({ message: 'Invalid token' });
  }
  // User is authenticated, return data
});
```

---

## Comparison Table

| Aspect | Sessions | JWT |
|--------|----------|-----|
| **Where data lives** | Server (memory/DB) | Client (token) |
| **Server state** | Stateful | Stateless |
| **Scalability** | Harder (shared state) | Easy (no state) |
| **Serverless compatible** | ❌ No | ✅ Yes |
| **Logout** | Server deletes session | Client deletes token |
| **Revocation** | Easy (delete from DB) | Hard (token valid until expiry) |
| **Token size** | Small (just ID) | Larger (contains data) |

---

## The JWT Structure

A JWT has 3 parts separated by dots:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFtaXIiLCJyb2xlIjoibWFuYWdlciJ9.signature
│                                      │                                              │
└──────── Header ──────────────────────┴──────── Payload ─────────────────────────────┴── Signature
```

### 1. Header (base64 encoded)
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

### 2. Payload (base64 encoded) - YOUR DATA
```json
{
  "username": "amir",
  "role": "manager",
  "locationId": 1,
  "iat": 1765227727,    // Issued at
  "exp": 1767819727     // Expires at
}
```

### 3. Signature
```
HMACSHA256(
  base64(header) + "." + base64(payload),
  secret_key
)
```

**Important**: The payload is NOT encrypted, just encoded. Anyone can decode it. The signature just proves it wasn't tampered with.

---

## Frontend Changes

### Before (Sessions):
```typescript
// Just include cookies, browser handles it
fetch('/api/customers', {
  credentials: 'include'  // Send cookies automatically
});
```

### After (JWT):
```typescript
// Must manually add token to every request
const token = localStorage.getItem('auth_token');

fetch('/api/customers', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Login Flow:
```typescript
// Before: Server sets cookie automatically
const response = await fetch('/api/auth/login', { ... });
// Cookie is set, done!

// After: Must save token ourselves
const response = await fetch('/api/auth/login', { ... });
const { token } = await response.json();
localStorage.setItem('auth_token', token);
```

---

## Security Considerations

### JWT Risks:
1. **Token theft** - If someone steals your token, they're you
2. **No revocation** - Can't invalidate a token until it expires
3. **Payload visible** - Don't put secrets in the payload

### Mitigations:
1. **Short expiry** - Use short-lived tokens (we use 30 days, could be shorter)
2. **HTTPS only** - Always use HTTPS in production
3. **Refresh tokens** - Use short access tokens + long refresh tokens
4. **Token rotation** - Issue new token on each request

---

## What We Built

```
┌─────────────────────────────────────────────────────────────┐
│                        Our Solution                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. server/lib/jwt.ts                                       │
│     - signToken(): Creates JWT with user data               │
│     - verifyToken(): Validates and decodes JWT              │
│     - extractToken(): Gets token from "Bearer xxx" header   │
│                                                             │
│  2. server/routes.ts                                        │
│     - requireAuth middleware: Checks JWT (or session)       │
│     - Login: Returns { token, user }                        │
│     - All routes use req.user instead of req.session.user   │
│                                                             │
│  3. client/src/lib/queryClient.ts                           │
│     - Adds Authorization header to all requests             │
│     - setAuthToken(): Saves to localStorage                 │
│     - clearAuthToken(): Removes from localStorage           │
│                                                             │
│  4. client/src/pages/Login.tsx                              │
│     - Saves token on successful login                       │
│                                                             │
│  5. client/src/contexts/AuthContext.tsx                     │
│     - Verifies token on app load                            │
│     - Clears token on logout                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Sessions = Server remembers you** (stateful)
2. **JWT = You carry your ID card** (stateless)
3. **Serverless needs stateless** - no persistent memory
4. **JWT is self-contained** - all data in the token
5. **Trade-offs exist** - JWT is harder to revoke
6. **Both can coexist** - we support both during migration

---

## Further Reading

- [JWT.io](https://jwt.io) - Decode and learn about JWTs
- [Auth0 JWT Introduction](https://auth0.com/learn/json-web-tokens/)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
