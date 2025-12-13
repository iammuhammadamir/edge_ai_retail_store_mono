# Transition Planning: Express → Vercel Serverless + Supabase

This document outlines the detailed plan for migrating ClientBridge from an Express.js server to Vercel Serverless Functions with Supabase as the database backend.

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Supabase Database Setup](#phase-1-supabase-database-setup)
3. [Phase 2: Authentication Migration (Sessions → JWT)](#phase-2-authentication-migration-sessions--jwt)
4. [Phase 3: API Routes Conversion](#phase-3-api-routes-conversion)
5. [Phase 4: File Storage Migration](#phase-4-file-storage-migration)
6. [Phase 5: Frontend Adjustments](#phase-5-frontend-adjustments)
7. [Phase 6: Vercel Configuration & Deployment](#phase-6-vercel-configuration--deployment)
8. [Risk Assessment](#risk-assessment)
9. [Rollback Plan](#rollback-plan)

---

## Overview

### Current Architecture

| Component | Technology | Files |
|-----------|------------|-------|
| Server | Express.js | `server/index.ts` |
| API Routes | Express Router | `server/routes.ts`, `server/edgeRoutes.ts` |
| Authentication | express-session + PostgreSQL store | `server/index.ts`, `server/routes.ts` |
| Database | PostgreSQL (local/Drizzle ORM) | `server/db.ts`, `server/dbStorage.ts` |
| File Storage | Local filesystem | `public/customers/`, `public/videos/` |
| Frontend | React + Vite | `client/` |

### Target Architecture

| Component | Technology | Files |
|-----------|------------|-------|
| Server | Vercel Serverless Functions | `api/**/*.ts` |
| API Routes | Individual function files | `api/auth/`, `api/customers/`, etc. |
| Authentication | JWT tokens | `lib/auth.ts` |
| Database | Supabase PostgreSQL | `lib/db.ts` |
| File Storage | Supabase Storage | `lib/storage.ts` |
| Frontend | React + Vite (unchanged) | `client/` |

---

## Phase 1: Supabase Database Setup

**Goal**: Set up Supabase project and migrate database schema.

**Estimated Time**: 1-2 hours

### Tasks

1. **Create Supabase Project**
   - Sign up at supabase.com
   - Create new project with region closest to users
   - Save connection string and API keys

2. **Migrate Database Schema**
   - Run schema creation SQL in Supabase SQL Editor
   - Or use Drizzle Kit with Supabase connection string

3. **Create Storage Bucket**
   - Create `customers` bucket for face images
   - Configure public access or RLS policies

4. **Seed Initial Data**
   - Create default locations
   - Create default users (with hashed passwords)

### Files to Review

| File | What to Check |
|------|---------------|
| `shared/schema.ts` | All table definitions - need to create in Supabase |
| `server/index.ts` (lines 120-206) | Seeding logic - need to replicate |
| `server/dbStorage.ts` | All database operations - verify compatibility |

### Schema to Create in Supabase

```sql
-- From shared/schema.ts analysis:

-- 1. locations (lines 6-10)
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 2. users (lines 13-20)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'owner', 'manager', 'reviewer'
  location_id INTEGER REFERENCES locations(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 3. cameras (lines 17-26)
CREATE TABLE cameras (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 4. video_clips (lines 29-40)
CREATE TABLE video_clips (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW() NOT NULL,
  status TEXT DEFAULT 'pending',
  face_detections TEXT,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  camera_id INTEGER REFERENCES cameras(id)
);

-- 5. customers (lines 66-76)
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  face_id TEXT NOT NULL,
  name TEXT,
  photo_url TEXT,
  points INTEGER DEFAULT 0 NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW() NOT NULL,
  flag TEXT,  -- 'red', 'yellow', 'green', null
  location_id INTEGER NOT NULL REFERENCES locations(id),
  embedding TEXT  -- JSON array of 512 floats
);

-- 6. reviews (lines 43-53)
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER REFERENCES cameras(id),
  clip_id INTEGER REFERENCES video_clips(id),
  reviewer_role TEXT NOT NULL,
  reviewer_username TEXT NOT NULL,
  decision TEXT NOT NULL,
  notes TEXT,
  reviewed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 7. inventory_items (lines 56-67)
CREATE TABLE inventory_items (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  item_name TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  expiration_date TIMESTAMP NOT NULL,
  category TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 8. notifications (lines 79-88)
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id INTEGER,
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- 9. session table (for migration reference - NOT needed in Supabase)
-- express-session creates this automatically, we'll use JWT instead
```

### Verification Checklist

- [ ] Supabase project created
- [ ] All 8 tables created (excluding session)
- [ ] Storage bucket `customers` created
- [ ] Connection string saved securely
- [ ] Test query works from local machine

---

## Phase 2: Authentication Migration (Sessions → JWT)

**Goal**: Replace express-session with stateless JWT authentication.

**Estimated Time**: 2-3 hours

### Why This Change?

| express-session | JWT |
|-----------------|-----|
| Requires persistent server | Stateless, works with serverless |
| Session stored in PostgreSQL | Token stored in client |
| Cookie-based | Header-based (Authorization: Bearer) |
| Server manages state | Client manages token |

### Tasks

1. **Create JWT Utility Library**
   - Sign tokens with user data
   - Verify tokens from Authorization header
   - Handle token expiration

2. **Update Login Endpoint**
   - Return JWT token instead of setting session
   - Include user data in token payload

3. **Update Auth Middleware**
   - Read token from Authorization header
   - Verify and decode token
   - Attach user to request

4. **Update Frontend**
   - Store JWT in localStorage/memory
   - Send token in Authorization header
   - Handle token refresh/expiration

### Files to Modify

| File | Current Code | Changes Required |
|------|--------------|------------------|
| `server/routes.ts` (lines 22-46) | `requireAuth`, `ownerOnly`, `ownerAndReviewerOnly` middleware | Replace `req.session.user` with JWT verification |
| `server/routes.ts` (lines 143-211) | Login endpoint with session | Return JWT token instead |
| `server/routes.ts` (lines 214-230) | `/api/auth/me` and logout | Verify JWT, remove session destroy |
| `server/index.ts` (lines 67-92) | Session middleware setup | Remove entirely |
| `client/src/lib/queryClient.ts` (lines 1-52) | `credentials: "include"` for cookies | Add `Authorization: Bearer ${token}` header |
| `client/src/contexts/AuthContext.tsx` | Session-based auth state | Store/retrieve JWT token |

### Current Session Usage in routes.ts

```typescript
// Line 23: requireAuth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) {  // ← Change to JWT verification
    return res.status(401).json({ message: "Authentication required." });
  }
  next();
}

// Lines 31-36: ownerOnly middleware
function ownerOnly(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user || req.session.user.role !== "owner") {  // ← Change
    return res.status(403).json({ message: "Access denied." });
  }
  next();
}

// Lines 186-210: Login - session creation
req.session.regenerate((err) => {
  req.session.user = {  // ← Replace with JWT signing
    username: user.username,
    role: user.role,
    locationId: user.locationId,
  };
  req.session.save((err) => {
    res.json({ username, role, locationId });  // ← Add token to response
  });
});

// Lines 223-230: Logout - session destruction
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {  // ← Not needed with JWT
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully" });
  });
});
```

### All Session References in routes.ts

| Line | Usage | Change |
|------|-------|--------|
| 23 | `req.session.user` check | JWT verify |
| 31 | `req.session.user.role` check | JWT payload |
| 40 | `req.session.user.role` check | JWT payload |
| 186-210 | Session creation | JWT signing |
| 216 | `req.session.user` return | JWT verify |
| 224 | `req.session.destroy` | Remove (stateless) |
| 285-286 | `req.session.user!.role/username` | JWT payload |
| 369 | `req.session.user!.role` | JWT payload |
| 444-445 | `req.session.user!.role/username` | JWT payload |
| 475-476 | `req.session.user!.role/username` | JWT payload |
| 600-601 | `req.session.user!.role/username` | JWT payload |
| 655-656 | `req.session.user!.role/username` | JWT payload |
| 911-912 | `req.session.user!.role/username` | JWT payload |
| 952 | `req.session.user!.username` | JWT payload |

### New Files to Create

```
lib/
├── auth.ts          # JWT sign/verify utilities
└── middleware.ts    # Serverless auth middleware
```

### Verification Checklist

- [ ] JWT utility created with sign/verify functions
- [ ] Login returns JWT token
- [ ] All middleware uses JWT verification
- [ ] Frontend stores and sends JWT
- [ ] Logout clears token from client
- [ ] Token expiration handled

---

## Phase 3: API Routes Conversion

**Goal**: Convert Express routes to Vercel Serverless Functions.

**Estimated Time**: 3-4 hours

### Vercel Serverless Structure

```
api/
├── auth/
│   ├── login.ts         # POST /api/auth/login
│   ├── logout.ts        # POST /api/auth/logout
│   └── me.ts            # GET /api/auth/me
├── customers/
│   ├── index.ts         # GET /api/customers, POST /api/customers
│   └── [id]/
│       ├── index.ts     # GET/DELETE /api/customers/:id
│       ├── name.ts      # PATCH /api/customers/:id/name
│       └── flag.ts      # PATCH /api/customers/:id/flag
├── edge/
│   ├── identify.ts      # POST /api/edge/identify
│   └── health.ts        # GET /api/edge/health
├── clips/
│   ├── index.ts         # GET /api/clips
│   ├── upload.ts        # POST /api/clips/upload
│   └── [id]/
│       ├── index.ts     # GET /api/clips/:id
│       └── reviews.ts   # GET /api/clips/:id/reviews
├── reviews/
│   └── index.ts         # GET/POST /api/reviews
├── camera-reviews/
│   └── index.ts         # GET/POST /api/camera-reviews
├── cameras/
│   └── index.ts         # GET /api/cameras
├── inventory/
│   ├── index.ts         # GET/POST /api/inventory
│   └── [id].ts          # GET/PATCH/DELETE /api/inventory/:id
├── notifications/
│   ├── index.ts         # GET /api/notifications
│   ├── unread.ts        # GET /api/notifications/unread
│   ├── read-all.ts      # PATCH /api/notifications/read-all
│   └── [id]/
│       └── read.ts      # PATCH /api/notifications/:id/read
└── admin/
    ├── locations/
    │   ├── index.ts     # GET/POST /api/admin/locations
    │   └── [id].ts      # PATCH/DELETE /api/admin/locations/:id
    ├── cameras/
    │   ├── index.ts     # GET/POST /api/admin/cameras
    │   └── [id].ts      # PATCH/DELETE /api/admin/cameras/:id
    └── users/
        ├── index.ts     # GET/POST /api/admin/users
        └── [username].ts # PATCH/DELETE /api/admin/users/:username
```

### Route Inventory from routes.ts

| Express Route | Method | Line | Serverless File |
|---------------|--------|------|-----------------|
| `/api/auth/login` | POST | 143 | `api/auth/login.ts` |
| `/api/auth/me` | GET | 215 | `api/auth/me.ts` |
| `/api/auth/logout` | POST | 223 | `api/auth/logout.ts` |
| `/api/clips/upload` | POST | 234 | `api/clips/upload.ts` |
| `/api/clips` | GET | 267 | `api/clips/index.ts` |
| `/api/clips/:id` | GET | 275 | `api/clips/[id]/index.ts` |
| `/api/reviews` | GET | 284 | `api/reviews/index.ts` |
| `/api/reviews` | POST | 330 | `api/reviews/index.ts` |
| `/api/clips/:id/reviews` | GET | 362 | `api/clips/[id]/reviews.ts` |
| `/api/camera-reviews` | GET | 368 | `api/camera-reviews/index.ts` |
| `/api/camera-reviews` | POST | 415 | `api/camera-reviews/index.ts` |
| `/api/customers` | GET | 443 | `api/customers/index.ts` |
| `/api/customers` | POST | 473 | `api/customers/index.ts` |
| `/api/customers/:id` | GET | 516 | `api/customers/[id]/index.ts` |
| `/api/customers/:id/name` | PATCH | 529 | `api/customers/[id]/name.ts` |
| `/api/customers/:id/flag` | PATCH | 551 | `api/customers/[id]/flag.ts` |
| `/api/customers/:id` | DELETE | 598 | `api/customers/[id]/index.ts` |
| `/api/inventory` | GET | 654 | `api/inventory/index.ts` |
| `/api/inventory/:id` | GET | 684 | `api/inventory/[id].ts` |
| `/api/inventory` | POST | 692 | `api/inventory/index.ts` |
| `/api/inventory/:id` | PATCH | 709 | `api/inventory/[id].ts` |
| `/api/inventory/:id` | DELETE | 762 | `api/inventory/[id].ts` |
| `/api/notifications` | GET | 772 | `api/notifications/index.ts` |
| `/api/notifications/unread` | GET | 777 | `api/notifications/unread.ts` |
| `/api/notifications/:id/read` | PATCH | 782 | `api/notifications/[id]/read.ts` |
| `/api/notifications/read-all` | PATCH | 791 | `api/notifications/read-all.ts` |
| `/api/admin/locations` | GET | 799 | `api/admin/locations/index.ts` |
| `/api/admin/locations` | POST | 804 | `api/admin/locations/index.ts` |
| `/api/admin/locations/:id` | PATCH | 821 | `api/admin/locations/[id].ts` |
| `/api/admin/locations/:id` | DELETE | 842 | `api/admin/locations/[id].ts` |
| `/api/cameras` | GET | 910 | `api/cameras/index.ts` |
| `/api/cameras/:id/status` | PATCH | 948 | `api/cameras/[id]/status.ts` |
| `/api/admin/cameras` | GET | 986 | `api/admin/cameras/index.ts` |
| `/api/admin/cameras` | POST | 999 | `api/admin/cameras/index.ts` |
| `/api/admin/cameras/:id` | PATCH | 1014 | `api/admin/cameras/[id].ts` |
| `/api/admin/cameras/:id` | DELETE | 1033 | `api/admin/cameras/[id].ts` |
| `/api/admin/users` | GET | 1071 | `api/admin/users/index.ts` |
| `/api/admin/users` | POST | 1078 | `api/admin/users/index.ts` |
| `/api/admin/users/:username` | PATCH | 1099 | `api/admin/users/[username].ts` |
| `/api/admin/users/:username` | DELETE | 1124 | `api/admin/users/[username].ts` |

### Route Inventory from edgeRoutes.ts

| Express Route | Method | Line | Serverless File |
|---------------|--------|------|-----------------|
| `/api/edge/identify` | POST | 89 | `api/edge/identify.ts` |
| `/api/edge/health` | GET | 183 | `api/edge/health.ts` |

### Conversion Pattern

**Before (Express):**
```typescript
// server/routes.ts line 443
app.get("/api/customers", requireAuth, async (req, res) => {
  const userRole = req.session.user!.role;
  const customers = await storage.getAllCustomers(locationId);
  res.json(customers);
});
```

**After (Vercel Serverless):**
```typescript
// api/customers/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../lib/auth';
import { db } from '../../lib/db';
import { customers } from '../../shared/schema';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth check
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (req.method === 'GET') {
    const locationId = parseInt(req.query.locationId as string) || undefined;
    const result = await db.select().from(customers);
    return res.json(result);
  }

  if (req.method === 'POST') {
    // ... create customer
  }

  return res.status(405).json({ message: 'Method not allowed' });
}
```

### Verification Checklist

- [ ] All 42 routes identified and mapped
- [ ] Serverless function structure created
- [ ] Each function handles correct HTTP methods
- [ ] Auth middleware applied correctly
- [ ] Database queries work with Supabase
- [ ] Error handling consistent

---

## Phase 4: File Storage Migration

**Goal**: Migrate file uploads from local filesystem to Supabase Storage.

**Estimated Time**: 1-2 hours

### Current File Storage

| Type | Location | Used By |
|------|----------|---------|
| Customer photos | `public/customers/*.jpg` | `edgeRoutes.ts` (line 39-62) |
| Video clips | `public/videos/*.mp4` | `routes.ts` (line 234) |

### Files to Modify

| File | Current Code | Changes Required |
|------|--------------|------------------|
| `server/edgeRoutes.ts` (lines 39-62) | `saveBase64Image()` writes to filesystem | Upload to Supabase Storage |
| `server/routes.ts` (lines 48-68) | Multer disk storage | Upload to Supabase Storage |
| `server/index.ts` (lines 95-97) | Static file serving | Remove (Supabase serves files) |

### Current saveBase64Image Function (edgeRoutes.ts lines 39-62)

```typescript
function saveBase64Image(base64Data: string, personId: string): string | null {
  try {
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");
    
    const customersDir = path.join(process.cwd(), "public", "customers");
    if (!fs.existsSync(customersDir)) {
      fs.mkdirSync(customersDir, { recursive: true });
    }
    
    const filename = `${personId}_${Date.now()}.jpg`;
    const filepath = path.join(customersDir, filename);
    
    fs.writeFileSync(filepath, buffer);
    
    return `/customers/${filename}`;  // ← Returns local path
  } catch (error) {
    console.error("Failed to save image:", error);
    return null;
  }
}
```

### New Supabase Storage Function

```typescript
// lib/storage.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function uploadCustomerPhoto(
  base64Data: string, 
  personId: string
): Promise<string | null> {
  try {
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");
    
    const filename = `${personId}_${Date.now()}.jpg`;

    const { error } = await supabase.storage
      .from('customers')
      .upload(filename, buffer, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('customers')
      .getPublicUrl(filename);

    return publicUrl;  // ← Returns Supabase URL
  } catch (error) {
    console.error("Failed to upload image:", error);
    return null;
  }
}
```

### Video Upload Considerations

- Video files are larger (10-100MB+)
- Supabase Storage has 50MB limit on free tier
- Consider: Keep video uploads as separate feature, or use different storage

### Verification Checklist

- [ ] Supabase Storage bucket created
- [ ] Upload function works with base64 images
- [ ] Public URLs accessible
- [ ] Old local file references updated
- [ ] Video upload strategy decided

---

## Phase 5: Frontend Adjustments

**Goal**: Update frontend to work with JWT auth and new API structure.

**Estimated Time**: 1-2 hours

### Files to Modify

| File | Changes Required |
|------|------------------|
| `client/src/lib/queryClient.ts` | Add JWT token to headers |
| `client/src/contexts/AuthContext.tsx` | Store/manage JWT token |
| `client/src/pages/Login.tsx` | Handle JWT in response |

### Current queryClient.ts (lines 1-52)

```typescript
async function handleRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",  // ← For session cookies
  });
  // ...
}
```

### Updated queryClient.ts

```typescript
// Get token from storage
function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function handleRequest(url: string, options?: RequestInit) {
  const token = getAuthToken();
  
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { "Authorization": `Bearer ${token}` }),  // ← JWT header
      ...options?.headers,
    },
    // Remove credentials: "include" - not needed for JWT
  });
  // ...
}
```

### AuthContext Changes

```typescript
// Current: relies on session cookie
// New: store JWT token

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
}

// On login success:
localStorage.setItem('auth_token', response.token);

// On logout:
localStorage.removeItem('auth_token');

// On app load:
const token = localStorage.getItem('auth_token');
if (token) {
  // Verify token is still valid via /api/auth/me
}
```

### Verification Checklist

- [ ] JWT token stored on login
- [ ] Token sent in Authorization header
- [ ] Token cleared on logout
- [ ] Token validation on app load
- [ ] 401 responses trigger logout

---

## Phase 6: Vercel Configuration & Deployment

**Goal**: Configure Vercel project and deploy.

**Estimated Time**: 1-2 hours

### Files to Create

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel configuration |
| `.env.local` | Local environment variables |

### vercel.json

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "client/dist",
  "framework": "vite",
  "functions": {
    "api/**/*.ts": {
      "memory": 256,
      "maxDuration": 10
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,PATCH,DELETE,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization, X-API-Key" }
      ]
    }
  ]
}
```

### Environment Variables for Vercel

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `EDGE_API_KEY` | API key for edge device authentication |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

### Deployment Steps

1. Install Vercel CLI: `npm i -g vercel`
2. Login: `vercel login`
3. Link project: `vercel link`
4. Add environment variables: `vercel env add`
5. Deploy preview: `vercel`
6. Deploy production: `vercel --prod`

### Files to Remove/Ignore

| File | Reason |
|------|--------|
| `server/index.ts` | Express server - not needed |
| `server/routes.ts` | Replaced by `api/` functions |
| `server/edgeRoutes.ts` | Replaced by `api/edge/` |
| `server/types/session.d.ts` | Session types - not needed |

### Verification Checklist

- [ ] vercel.json created
- [ ] Environment variables set in Vercel
- [ ] Preview deployment works
- [ ] All API endpoints accessible
- [ ] Frontend loads correctly
- [ ] Edge device can connect
- [ ] Production deployment successful

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cold starts slow down edge device | Medium | Use Vercel Edge Functions for `/api/edge/*` |
| JWT token stolen | High | Short expiration, HTTPS only |
| Database connection limits | Medium | Use connection pooling |
| Supabase free tier limits | Low | Monitor usage, upgrade if needed |
| Breaking changes during migration | High | Keep Express server running until verified |

---

## Rollback Plan

If migration fails:

1. **Keep original branch** (`feature/edge-integration`) intact
2. **Don't delete** `server/` directory until verified
3. **Environment variables** work for both architectures
4. **Database** is shared - no data migration needed
5. **Edge device** can switch API_BASE_URL back

### Quick Rollback

```bash
# Switch back to Express branch
git checkout feature/edge-integration

# Restart Express server
npm run dev
```

---

## Summary

| Phase | Time | Complexity | Dependencies |
|-------|------|------------|--------------|
| 1. Supabase Setup | 1-2h | Low | None |
| 2. Auth Migration | 2-3h | Medium | Phase 1 |
| 3. API Conversion | 3-4h | Medium | Phase 1, 2 |
| 4. File Storage | 1-2h | Low | Phase 1 |
| 5. Frontend | 1-2h | Low | Phase 2 |
| 6. Deployment | 1-2h | Low | All phases |
| **Total** | **10-15h** | **Medium** | |

### Recommended Order

1. **Phase 1** - Get Supabase working first
2. **Phase 2** - Auth is foundational, do it early
3. **Phase 4** - File storage is independent, can do in parallel
4. **Phase 3** - Bulk of the work, do after auth is solid
5. **Phase 5** - Frontend changes depend on auth
6. **Phase 6** - Deploy only after everything works locally
