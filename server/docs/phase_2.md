# Phase 2: Authentication Migration (Sessions → JWT)

This phase replaces express-session with stateless JWT authentication for Vercel serverless compatibility.

---

## Why JWT?

| express-session | JWT |
|-----------------|-----|
| Requires persistent server | Stateless, works with serverless |
| Session stored in PostgreSQL | Token stored in client |
| Cookie-based | Header-based (Authorization: Bearer) |
| Server manages state | Client manages token |

---

## Steps

### Step 1: Install JWT Dependencies

```bash
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

### Step 2: Create JWT Utility (`server/lib/jwt.ts`)

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-jwt-secret';
const JWT_EXPIRES_IN = '30d'; // Same as session maxAge

export interface JWTPayload {
  username: string;
  role: string;
  locationId: number | null;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
```

### Step 3: Update Auth Middleware (`server/routes.ts`)

**Before:**
```typescript
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Authentication required." });
  }
  next();
}
```

**After:**
```typescript
import { verifyToken, extractToken, JWTPayload } from './lib/jwt';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
  
  req.user = payload;
  next();
}
```

### Step 4: Update Login Endpoint

**Before:**
```typescript
req.session.regenerate((err) => {
  req.session.user = { username, role, locationId };
  req.session.save((err) => {
    res.json({ username, role, locationId });
  });
});
```

**After:**
```typescript
import { signToken } from './lib/jwt';

// ... in login handler
const token = signToken({ username, role: user.role, locationId: user.locationId });
res.json({ 
  token,
  user: { username, role: user.role, locationId: user.locationId }
});
```

### Step 5: Update All `req.session.user` References

Replace all occurrences:
- `req.session.user` → `req.user`
- `req.session.user!.role` → `req.user!.role`
- `req.session.user!.username` → `req.user!.username`

### Step 6: Update Frontend (`client/src/lib/queryClient.ts`)

**Before:**
```typescript
credentials: "include",  // For session cookies
```

**After:**
```typescript
// Get token from storage
const token = localStorage.getItem('auth_token');

headers: {
  "Content-Type": "application/json",
  ...(token && { "Authorization": `Bearer ${token}` }),
},
// Remove credentials: "include"
```

### Step 7: Update Login Page

Store token on successful login:
```typescript
const response = await login(username, password);
localStorage.setItem('auth_token', response.token);
```

### Step 8: Update Logout

```typescript
localStorage.removeItem('auth_token');
// Redirect to login
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `server/lib/jwt.ts` | **NEW** - JWT utilities |
| `server/routes.ts` | Update middleware, login, logout |
| `server/index.ts` | Remove session middleware (optional for now) |
| `client/src/lib/queryClient.ts` | Add Authorization header |
| `client/src/pages/Login.tsx` | Store token |
| `client/src/contexts/AuthContext.tsx` | Manage token state |

---

## Verification Checklist

- [ ] JWT package installed
- [ ] `server/lib/jwt.ts` created
- [ ] `requireAuth` uses JWT
- [ ] Login returns token
- [ ] Frontend stores token
- [ ] Frontend sends Authorization header
- [ ] All API calls work with JWT
- [ ] Logout clears token
