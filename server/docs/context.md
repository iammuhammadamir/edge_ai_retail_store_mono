# ClientBridge - Project Context

> **Last Updated**: December 10, 2025
> **Status**: ✅ Production Deployed on Vercel

---

## Quick Summary for New Developers

**ClientBridge** is a facial recognition system for retail stores that automatically identifies returning customers without loyalty cards or apps. The system consists of:

1. **Edge Device** (Python) - Runs on Jetson Nano or Mac, captures faces from camera
2. **Backend API** (TypeScript) - Deployed as Vercel serverless functions
3. **Frontend Dashboard** (React) - Deployed on Vercel, managers view/manage customers
4. **Database** (PostgreSQL) - Hosted on Supabase
5. **File Storage** (Supabase Storage) - Customer photos

---

## 🚀 Production Deployment

### Live URLs
| Component | URL |
|-----------|-----|
| **Dashboard** | https://dashboard.smoothflow.ai |
| **API Base** | https://dashboard.smoothflow.ai/api |
| **Vercel Project** | clientbridge-ten.vercel.app |

### Hosting Stack
| Service | Purpose | Plan |
|---------|---------|------|
| **Vercel** | Frontend + Serverless API | Hobby (free) |
| **Supabase** | PostgreSQL Database | Free tier |
| **Supabase Storage** | Customer photos | Free tier |
| **SiteGround** | DNS (client's existing) | - |

---

## 🔑 Key Architecture Decisions

### 1. Session → JWT Authentication
**Problem**: Vercel serverless functions are stateless, can't use session-based auth.
**Solution**: Migrated to JWT tokens stored in localStorage. Token sent via `Authorization: Bearer <token>` header.

### 2. Express → Serverless Functions
**Problem**: Vercel doesn't run a persistent Express server.
**Solution**: Each API route is a standalone serverless function in `/api/` directory. Dependencies are inlined in each function to avoid bundling issues.

### 3. 12-Function Limit Workaround
**Problem**: Vercel Hobby plan limits to 12 serverless functions.
**Solution**: Consolidated routes into single handlers using URL parsing:
- `/api/customers/index.ts` handles GET, DELETE, PATCH for all customer routes
- `/api/admin/index.ts` handles locations, cameras, users
- Used `vercel.json` rewrites to route sub-paths to index handlers

### 4. Removed Features (to stay under limit)
- Notifications API
- Reviews API  
- Camera Reviews API

These can be added back by upgrading to Vercel Pro or further consolidation.

### 5. Photo Storage
**Problem**: Serverless functions can't write to filesystem.
**Solution**: Upload customer photos to Supabase Storage bucket `photos`, store public URL in database.

### 6. Live Streaming (HLS)
**Architecture**: Edge device generates HLS segments → uploads to Supabase Storage → browser plays via hls.js
- **Bucket**: `streams` (public read access)
- **Path**: `streams/location_{id}/cam_{camera_id}/stream.m3u8`
- **Latency**: 5-15 seconds (acceptable for monitoring)

---

## 📁 Project Structure

```
ClientBridge/
├── api/                          # Vercel serverless functions
│   ├── auth/
│   │   ├── login.ts              # POST /api/auth/login
│   │   ├── logout.ts             # POST /api/auth/logout
│   │   └── me.ts                 # GET /api/auth/me
│   ├── customers/
│   │   └── index.ts              # All customer CRUD operations
│   ├── cameras/
│   │   └── index.ts              # Camera operations
│   ├── inventory/
│   │   └── index.ts              # Inventory CRUD
│   ├── admin/
│   │   └── index.ts              # Admin: locations, cameras, users
│   └── edge/
│       ├── health.ts             # Health check for edge device
│       └── identify.ts           # Face recognition endpoint
├── client/                       # React frontend (Vite)
│   └── src/
│       ├── pages/
│       │   └── Dashboard.tsx
│       └── lib/
│           └── queryClient.ts    # API client with JWT handling
├── server/                       # Original Express server (for local dev)
├── shared/
│   └── schema.ts                 # Drizzle ORM schema
├── docs/
│   ├── context.md                # This file
│   └── api_status.md             # API endpoint documentation
├── vercel.json                   # Vercel configuration
└── package.json

Edge_AI_For_Retail_Stores/        # Separate repo - Edge device code
├── visitor_counter.py            # Main entry point
├── api_client.py                 # ClientBridge API client
├── config.py                     # Configuration (API URL, keys)
└── ...
```

---

## 🔐 Environment Variables

### On Vercel (Production)
```
DATABASE_URL          # Supabase PostgreSQL connection string
JWT_SECRET            # Secret for signing JWT tokens
EDGE_API_KEY          # API key for edge device authentication
SUPABASE_URL          # https://xxx.supabase.co
SUPABASE_SERVICE_KEY  # Supabase service role key (for storage)
SESSION_SECRET        # Legacy, may not be needed
```

### Edge Device (config.py)
```python
API_BASE_URL = "https://dashboard.smoothflow.ai"
API_KEY = "dev-edge-api-key"  # Must match EDGE_API_KEY on Vercel
API_LOCATION_ID = 1
```

---

## 🗄️ Database Schema (Supabase PostgreSQL)

```sql
customers (
  id            SERIAL PRIMARY KEY,
  face_id       TEXT NOT NULL,
  name          TEXT,
  photo_url     TEXT,              -- Supabase Storage URL
  points        INTEGER DEFAULT 0, -- Visit count
  last_seen     TIMESTAMP,
  flag          TEXT,              -- red/yellow/green/null
  location_id   INTEGER,
  embedding     TEXT               -- JSON array of 512 floats
)

locations (id, name, created_at)
users (id, username, password, role, location_id, created_at)
cameras (id, name, stream_url, location_id, is_active, status, created_at)
inventory_items (id, item_name, batch_number, quantity, expiration_date, category, location_id, ...)
```

---

## 🔌 API Endpoints

### Authentication
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/login` | POST | None | Returns JWT token |
| `/api/auth/logout` | POST | JWT | Stateless acknowledgment |
| `/api/auth/me` | GET | JWT | Current user info |

### Edge Device (API Key auth via X-API-Key header)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/edge/health` | GET | Health check |
| `/api/edge/identify` | POST | Face recognition - new/returning customer |

### Customers (JWT auth)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/customers` | GET | List customers |
| `/api/customers/:id` | GET | Single customer |
| `/api/customers/:id` | DELETE | Delete customer |
| `/api/customers/:id/name` | PATCH | Update name |
| `/api/customers/:id/flag` | PATCH | Update flag |

### Admin (Owner role only)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/locations` | GET, POST | Manage locations |
| `/api/admin/cameras` | GET, POST | Manage cameras |
| `/api/admin/users` | GET, POST | Manage users |

---

## 🧪 Testing Commands

```bash
# Login and get token
curl -X POST https://dashboard.smoothflow.ai/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"manager1","password":"manager123"}'

# Get customers (with token)
curl https://dashboard.smoothflow.ai/api/customers \
  -H "Authorization: Bearer <token>"

# Edge device health check
curl https://dashboard.smoothflow.ai/api/edge/health \
  -H "X-API-Key: dev-edge-api-key"
```

---

## 🎯 Face Recognition Flow

```
1. Edge device detects face via camera
2. Captures frames for 5 seconds, selects best quality
3. Extracts 512-dimensional embedding using InsightFace
4. POST to /api/edge/identify with embedding + base64 image
5. Server compares embedding against all customers (cosine similarity)
6. If similarity > 0.45: RETURNING customer (increment visits)
7. If similarity < 0.45: NEW customer (create record, upload photo)
8. Response: { status: "new"|"returning", customerId, visitCount }
```

**Similarity Threshold**: 0.45 (configurable in identify.ts)

---

## ❌ Known Limitations / TODO

### Removed to Stay Under Function Limit
- [ ] Notifications system
- [ ] Video clip reviews
- [ ] Camera reviews

### Not Yet Implemented
- [ ] Real-time dashboard updates (WebSocket)
- [ ] Customer merge (combine duplicates)
- [ ] CSV/Excel export
- [ ] Multiple cameras per location
- [ ] Jetson Nano production testing

### Potential Improvements
- [ ] Per-location similarity thresholds
- [ ] Store multiple embeddings per customer
- [ ] Age/gender analytics (InsightFace supports this)
- [ ] Flagged customer alerts

---

## 🚨 Important Notes

1. **Vercel Function Limit**: Currently using 9 of 12 allowed functions on Hobby plan. Adding more routes requires consolidation or upgrade to Pro.

2. **Supabase Storage**: The `photos` bucket must be PUBLIC for images to display in dashboard.

3. **Edge Device Config**: After deployment, update `config.py` in Edge_AI_For_Retail_Stores to point to production URL.

4. **JWT Secret**: Must be the same across all serverless functions. Set via Vercel environment variables.

5. **Database Connection**: Each serverless function creates its own connection pool with `max: 1` to avoid connection exhaustion.

---

## 📞 Client Info

- **Domain**: smoothflow.ai (DNS on SiteGround)
- **Subdomain**: dashboard.smoothflow.ai
- **DNS Setup**: CNAME record pointing to cname.vercel-dns.com
