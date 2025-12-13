# Phase 3: API Routes Conversion to Vercel Serverless

This phase converts Express routes to Vercel Serverless Functions.

---

## Current State

We have a single Express server with all routes in:
- `server/routes.ts` - Main API routes
- `server/edgeRoutes.ts` - Edge device routes

## Target State

Individual serverless functions in `api/` directory:
```
api/
├── auth/
│   ├── login.ts
│   ├── logout.ts
│   └── me.ts
├── edge/
│   ├── identify.ts
│   └── health.ts
├── customers/
│   └── index.ts
└── ... (other routes)
```

---

## Approach: Minimal Changes First

Instead of rewriting everything, we'll:
1. Keep the Express server working
2. Create a Vercel adapter that wraps Express
3. Test locally with Vercel CLI
4. Deploy when ready

This is safer than rewriting all routes from scratch.

---

## Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

## Step 2: Create vercel.json

```json
{
  "version": 2,
  "builds": [
    { "src": "api/**/*.ts", "use": "@vercel/node" },
    { "src": "client/dist/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/(.*)", "dest": "/client/dist/$1" }
  ]
}
```

## Step 3: Create API Handler Pattern

Each Vercel function follows this pattern:

```typescript
// api/example.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === 'GET') {
    return res.json({ message: 'Hello' });
  }
  
  if (req.method === 'POST') {
    const { data } = req.body;
    return res.json({ received: data });
  }
  
  return res.status(405).json({ message: 'Method not allowed' });
}
```

---

## Priority Routes for Face Recognition

For the face recognition module, we only need:

| Route | Method | Priority |
|-------|--------|----------|
| `/api/edge/identify` | POST | ✅ Critical |
| `/api/edge/health` | GET | ✅ Critical |
| `/api/auth/login` | POST | ✅ Critical |
| `/api/auth/me` | GET | ✅ Critical |
| `/api/customers` | GET | ✅ Critical |

Other routes can wait.

---

## Files to Create

### 1. `api/edge/identify.ts`
### 2. `api/edge/health.ts`
### 3. `api/auth/login.ts`
### 4. `api/auth/me.ts`
### 5. `api/customers/index.ts`

---

## Shared Utilities

Create shared code that all functions can use:

```
lib/
├── db.ts          # Database connection
├── jwt.ts         # JWT utilities (copy from server/lib/jwt.ts)
├── auth.ts        # Auth middleware helper
└── storage.ts     # Supabase storage utilities
```
