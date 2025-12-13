# Vercel + Supabase Deployment Guide

This guide explains how to deploy ClientBridge using **Vercel** (frontend + serverless API) and **Supabase** (PostgreSQL database).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Changes Required](#architecture-changes-required)
3. [Supabase Setup](#supabase-setup)
4. [Code Modifications](#code-modifications)
5. [Vercel Setup](#vercel-setup)
6. [Environment Variables](#environment-variables)
7. [Edge Device Configuration](#edge-device-configuration)
8. [Limitations & Considerations](#limitations--considerations)
9. [Cost Estimate](#cost-estimate)

---

## Overview

### Current Architecture
```
┌─────────────┐     ┌─────────────────────────────┐     ┌──────────────┐
│ Edge Device │────►│ Express Server (Node.js)    │────►│ PostgreSQL   │
│             │     │ - API routes                │     │ (local)      │
│             │     │ - Static file serving       │     │              │
│             │     │ - Session management        │     │              │
└─────────────┘     └─────────────────────────────┘     └──────────────┘
```

### Vercel + Supabase Architecture
```
┌─────────────┐     ┌─────────────────────────────┐     ┌──────────────┐
│ Edge Device │────►│ Vercel                      │────►│ Supabase     │
│             │     │ - Serverless Functions      │     │ - PostgreSQL │
│             │     │ - Static Frontend (CDN)     │     │ - Storage    │
│             │     │                             │     │ - Auth (opt) │
└─────────────┘     └─────────────────────────────┘     └──────────────┘
```

### Why Vercel + Supabase?

| Benefit | Description |
|---------|-------------|
| **Free tier** | Both have generous free tiers |
| **Auto-scaling** | Handles traffic spikes automatically |
| **Global CDN** | Fast frontend delivery worldwide |
| **Managed database** | No PostgreSQL maintenance |
| **Easy deployment** | Git push to deploy |

---

## Architecture Changes Required

### What Needs to Change

| Component | Current | Vercel/Supabase |
|-----------|---------|-----------------|
| **API** | Express server | Vercel Serverless Functions |
| **Database** | Local PostgreSQL | Supabase PostgreSQL |
| **Sessions** | express-session (memory) | JWT tokens or Supabase Auth |
| **File uploads** | Local `/public/customers/` | Supabase Storage |
| **Static files** | Express static middleware | Vercel CDN |

### Effort Estimate

| Task | Effort | Complexity |
|------|--------|------------|
| Supabase database setup | 30 min | Low |
| Convert Express routes to serverless | 2-4 hours | Medium |
| Session → JWT authentication | 1-2 hours | Medium |
| File uploads to Supabase Storage | 1-2 hours | Medium |
| Vercel configuration | 30 min | Low |
| Testing & debugging | 2-4 hours | Medium |
| **Total** | **8-14 hours** | **Medium** |

---

## Supabase Setup

### 1. Create Supabase Project

1. Go to https://supabase.com
2. Sign up / Login
3. Click "New Project"
4. Fill in:
   - **Name**: `clientbridge`
   - **Database Password**: Generate strong password (save it!)
   - **Region**: Choose closest to your users
5. Wait for project to provision (~2 minutes)

### 2. Get Connection String

1. Go to **Settings** → **Database**
2. Find **Connection string** → **URI**
3. Copy the connection string:
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```

### 3. Run Database Migrations

Option A: **Use Supabase SQL Editor**

1. Go to **SQL Editor** in Supabase dashboard
2. Run the schema creation SQL:

```sql
-- Locations table
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Customers table
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  face_id TEXT NOT NULL,
  name TEXT,
  photo_url TEXT,
  points INTEGER DEFAULT 0 NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW() NOT NULL,
  flag TEXT,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  embedding TEXT
);

-- Create unique index for face_id per location
CREATE UNIQUE INDEX customers_face_id_location_idx ON customers(face_id, location_id);

-- Seed initial data
INSERT INTO locations (name) VALUES ('Main Store');

-- Create default manager (password: manager1)
-- Note: In production, use proper password hashing
INSERT INTO users (username, password, role, location_id) 
VALUES ('manager1', '$2b$10$...hashed...', 'manager', 1);
```

Option B: **Use Drizzle Kit**

```bash
# Update drizzle.config.mjs with Supabase URL
DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres" \
npx drizzle-kit push
```

### 4. Setup Supabase Storage (for customer photos)

1. Go to **Storage** in Supabase dashboard
2. Click "New bucket"
3. Name: `customers`
4. Public: Yes (or configure RLS policies)

---

## Code Modifications

### 1. Project Structure for Vercel

```
ClientBridge/
├── api/                      # Vercel Serverless Functions
│   ├── auth/
│   │   ├── login.ts
│   │   ├── logout.ts
│   │   └── me.ts
│   ├── customers/
│   │   ├── index.ts          # GET /api/customers
│   │   ├── [id].ts           # GET/DELETE /api/customers/:id
│   │   ├── [id]/
│   │   │   ├── name.ts       # PATCH /api/customers/:id/name
│   │   │   └── flag.ts       # PATCH /api/customers/:id/flag
│   └── edge/
│       ├── identify.ts       # POST /api/edge/identify
│       └── health.ts         # GET /api/edge/health
├── client/                   # React frontend (unchanged)
├── shared/                   # Shared types/schema
├── vercel.json               # Vercel configuration
└── package.json
```

### 2. Create `vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist/client",
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
  ]
}
```

### 3. Convert Express Route to Serverless Function

**Before (Express):**
```typescript
// server/routes.ts
app.get("/api/customers", async (req, res) => {
  const locationId = parseInt(req.query.locationId as string) || 1;
  const customers = await storage.getAllCustomers(locationId);
  res.json(customers);
});
```

**After (Vercel Serverless):**
```typescript
// api/customers/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { customers } from '../../shared/schema';
import { eq } from 'drizzle-orm';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const locationId = parseInt(req.query.locationId as string) || 1;
    const result = await db
      .select()
      .from(customers)
      .where(eq(customers.locationId, locationId));
    
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Database error' });
  }
}
```

### 4. Database Connection for Serverless

```typescript
// lib/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Connection pooling for serverless
const connectionString = process.env.DATABASE_URL!;

// Use connection pooling for serverless
const client = postgres(connectionString, {
  max: 1,  // Serverless: keep connections minimal
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client);
```

### 5. Authentication with JWT (replacing sessions)

```typescript
// lib/auth.ts
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  locationId: number | null;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(req: VercelRequest): JWTPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}
```

### 6. Edge Identify Endpoint (Serverless)

```typescript
// api/edge/identify.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { customers } from '../../shared/schema';
import { eq } from 'drizzle-orm';

const SIMILARITY_THRESHOLD = 0.45;

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify API key
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.EDGE_API_KEY) {
    return res.status(401).json({ message: 'Invalid API key' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { embedding, locationId } = req.body;

  // Get all customers for location
  const allCustomers = await db
    .select()
    .from(customers)
    .where(eq(customers.locationId, locationId));

  // Find best match
  let bestMatch = null;
  let bestSimilarity = 0;

  for (const customer of allCustomers) {
    if (!customer.embedding) continue;
    const customerEmbedding = JSON.parse(customer.embedding);
    const similarity = cosineSimilarity(embedding, customerEmbedding);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = customer;
    }
  }

  if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
    // Returning customer
    await db
      .update(customers)
      .set({ 
        points: bestMatch.points + 1, 
        lastSeen: new Date() 
      })
      .where(eq(customers.id, bestMatch.id));

    return res.json({
      status: 'returning',
      customerId: bestMatch.id,
      visitCount: bestMatch.points + 1,
      similarity: bestSimilarity
    });
  } else {
    // New customer
    const faceId = `visitor_${Date.now()}`;
    const [newCustomer] = await db
      .insert(customers)
      .values({
        faceId,
        locationId,
        points: 1,
        lastSeen: new Date(),
        embedding: JSON.stringify(embedding)
      })
      .returning();

    return res.json({
      status: 'new',
      customerId: newCustomer.id,
      visitCount: 1
    });
  }
}
```

### 7. File Uploads to Supabase Storage

```typescript
// lib/storage.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function uploadCustomerPhoto(
  base64Image: string, 
  customerId: number
): Promise<string> {
  const buffer = Buffer.from(base64Image, 'base64');
  const filename = `customer_${customerId}_${Date.now()}.jpg`;

  const { data, error } = await supabase.storage
    .from('customers')
    .upload(filename, buffer, {
      contentType: 'image/jpeg'
    });

  if (error) throw error;

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('customers')
    .getPublicUrl(filename);

  return publicUrl;
}
```

---

## Vercel Setup

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Login to Vercel

```bash
vercel login
```

### 3. Link Project

```bash
cd ClientBridge
vercel link
```

### 4. Add Environment Variables

```bash
# Via CLI
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add EDGE_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY

# Or via Vercel Dashboard:
# Project Settings → Environment Variables
```

### 5. Deploy

```bash
# Preview deployment
vercel

# Production deployment
vercel --prod
```

### 6. Setup Custom Domain (Optional)

1. Go to Vercel Dashboard → Project → Settings → Domains
2. Add your domain
3. Update DNS records as instructed

---

## Environment Variables

### Vercel Environment Variables

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `DATABASE_URL` | Supabase PostgreSQL URL | Supabase → Settings → Database |
| `JWT_SECRET` | Secret for JWT signing | Generate: `openssl rand -hex 32` |
| `EDGE_API_KEY` | API key for edge devices | Generate: `openssl rand -hex 32` |
| `SUPABASE_URL` | Supabase project URL | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Supabase → Settings → API |

### Edge Device Configuration

Update `config.py`:

```python
# Production Vercel URL
API_BASE_URL = "https://your-project.vercel.app"
API_KEY = "your-edge-api-key"  # Same as EDGE_API_KEY in Vercel
API_LOCATION_ID = 1
```

---

## Edge Device Configuration

The edge device code doesn't need changes - just update the config:

```python
# config.py
API_BASE_URL = "https://clientbridge.vercel.app"  # Your Vercel URL
API_KEY = "your-edge-api-key"
API_LOCATION_ID = 1
```

Test connection:
```bash
curl https://clientbridge.vercel.app/api/edge/health \
  -H "X-API-Key: your-edge-api-key"
```

---

## Limitations & Considerations

### Serverless Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Cold starts** | First request ~1-2s slower | Use Vercel Edge Functions for critical paths |
| **10s timeout** (free) | Long operations may fail | Optimize queries, use background jobs |
| **No WebSockets** | No real-time updates | Use polling or Supabase Realtime |
| **No persistent connections** | DB connection overhead | Use connection pooling |

### Supabase Limitations (Free Tier)

| Limit | Free Tier | Impact |
|-------|-----------|--------|
| Database size | 500 MB | ~500K customers with embeddings |
| Storage | 1 GB | ~10K customer photos |
| Bandwidth | 2 GB/month | Monitor usage |
| Pausing | After 1 week inactive | Set up keep-alive ping |

### What Works Well

- ✅ Customer identification (fast enough)
- ✅ Dashboard viewing
- ✅ CRUD operations
- ✅ Authentication

### What May Need Optimization

- ⚠️ Bulk embedding comparisons (consider caching)
- ⚠️ Large customer databases (>10K)
- ⚠️ High-frequency edge requests

---

## Cost Estimate

### Free Tier (Small Store)

| Service | Free Tier | Likely Usage |
|---------|-----------|--------------|
| **Vercel** | 100GB bandwidth, 100K function invocations | ✅ Sufficient |
| **Supabase** | 500MB DB, 1GB storage, 2GB bandwidth | ✅ Sufficient |
| **Total** | **$0/month** | For 1-2 stores, <1000 customers |

### Paid Tier (Growing Business)

| Service | Plan | Cost |
|---------|------|------|
| **Vercel Pro** | More bandwidth, longer timeouts | $20/month |
| **Supabase Pro** | 8GB DB, 100GB storage | $25/month |
| **Total** | | **$45/month** |

### When to Upgrade

- More than 500 customers with photos
- More than 10K API requests/day
- Need longer function timeouts
- Multiple locations with heavy traffic

---

## Migration Checklist

- [ ] Create Supabase project
- [ ] Run database migrations
- [ ] Create storage bucket
- [ ] Convert Express routes to serverless functions
- [ ] Implement JWT authentication
- [ ] Update file upload to use Supabase Storage
- [ ] Create `vercel.json`
- [ ] Set environment variables in Vercel
- [ ] Deploy to Vercel
- [ ] Test all endpoints
- [ ] Update edge device config
- [ ] Test edge device connection
- [ ] Monitor for cold start issues
- [ ] Set up Supabase keep-alive (prevent pausing)

---

## Quick Reference

### Useful Commands

```bash
# Deploy preview
vercel

# Deploy production
vercel --prod

# View logs
vercel logs

# Pull env vars locally
vercel env pull .env.local

# Run locally with Vercel
vercel dev
```

### Useful Links

- Vercel Dashboard: https://vercel.com/dashboard
- Supabase Dashboard: https://app.supabase.com
- Vercel Serverless Docs: https://vercel.com/docs/functions
- Supabase Docs: https://supabase.com/docs
