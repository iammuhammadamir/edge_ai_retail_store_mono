# Local Development to Production Transition Guide

This document tracks what needs to change when moving from local development to production deployment.

**Note**: Replit dependencies have been removed. This project now runs independently on any platform.

---

## Current State: Local Development (TESTED & WORKING)

### Quick Start

```bash
cd ClientBridge

# 1. Install dependencies
npm install

# 2. Create PostgreSQL database
createdb clientbridge   # or use Docker

# 3. Push database schema
DATABASE_URL="postgresql://localhost:5432/clientbridge" npm run db:push

# 4. Start server
DATABASE_URL="postgresql://localhost:5432/clientbridge" \
SESSION_SECRET="dev-secret" \
EDGE_API_KEY="dev-edge-api-key" \
npm run dev:server

# 5. (Optional) Start frontend in another terminal
npm run dev:client
```

### Environment Variables (Local)

```bash
# Required
DATABASE_URL="postgresql://localhost:5432/clientbridge"
SESSION_SECRET="dev-secret-change-in-production"
EDGE_API_KEY="dev-edge-api-key-change-in-production"

# Optional (CAPTCHA disabled in dev)
# RECAPTCHA_SECRET_KEY=""
# RECAPTCHA_SITE_KEY=""
```

### Local PostgreSQL Setup

```bash
# Option 1: Homebrew (Mac)
brew install postgresql@14
brew services start postgresql@14
createdb clientbridge

# Option 2: Docker
docker run -d \
  --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=clientbridge \
  -p 5432:5432 \
  postgres:16
```

### Image Storage (Local)

- Images saved to: `public/customers/`
- Served at: `http://localhost:5000/customers/{filename}`

---

## Production Checklist

### 1. Environment Variables (Production)

| Variable | Local Value | Production Value | Notes |
|----------|-------------|------------------|-------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/clientbridge` | **GET FROM CLIENT** | Replit PostgreSQL or external |
| `SESSION_SECRET` | `dev-secret-...` | **GENERATE SECURE** | `openssl rand -base64 32` |
| `EDGE_API_KEY` | `dev-edge-api-key-...` | **GENERATE SECURE** | Share with Jetson device |
| `NODE_ENV` | (not set) | `production` | Enables secure cookies |
| `RECAPTCHA_SECRET_KEY` | (not set) | **GET FROM CLIENT** | Optional |
| `RECAPTCHA_SITE_KEY` | (not set) | **GET FROM CLIENT** | Optional |

### 2. Database Migration

```bash
# On production server
npm run db:push
```

Or if using Drizzle migrations:
```bash
npm run db:generate
npm run db:migrate
```

### 3. Image Storage (Production)

**Current**: Local filesystem (`public/customers/`)

**Production Options**:
- [ ] Keep local filesystem (works on Replit with persistent storage)
- [ ] Migrate to cloud storage (S3, Cloudflare R2, etc.)

If keeping local:
- Ensure `public/customers/` directory exists
- Ensure write permissions

### 4. Edge Device Configuration

Update Jetson `config.py`:
```python
# Production API endpoint
API_BASE_URL = "https://your-production-url.replit.app"
EDGE_API_KEY = "your-production-api-key"
```

### 5. CORS Configuration

Currently set to allow all origins. For production, update `server/index.ts`:
```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://your-domain.com",
  credentials: true,
}));
```

---

## API Endpoints Added

### Edge Device APIs

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/edge/enroll` | POST | API Key | Register new customer |
| `/api/edge/visit` | POST | API Key | Record returning visitor |
| `/api/edge/health` | GET | API Key | Health check |

### Authentication

All edge endpoints require `X-API-Key` header:
```bash
curl -X POST https://your-server/api/edge/enroll \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"personId": "visitor_001", "locationId": 1}'
```

---

## Files Changed in This Branch

| File | Change |
|------|--------|
| `server/edgeRoutes.ts` | **NEW** - Edge device API endpoints |
| `server/index.ts` | Import and register edge routes |
| `client/src/pages/Dashboard.tsx` | UI labels: "Points" → "Visits" |

---

## Testing Checklist

### Local Testing

- [ ] Start local PostgreSQL
- [ ] Run `npm run db:push`
- [ ] Run `npm run dev`
- [ ] Test `/api/edge/health` with API key
- [ ] Test `/api/edge/enroll` with sample data
- [ ] Test `/api/edge/visit` with existing personId
- [ ] Verify customer appears in Dashboard

### Production Testing

- [ ] Deploy to Replit/production
- [ ] Verify environment variables set
- [ ] Test health endpoint
- [ ] Test from Jetson device
- [ ] Verify images upload correctly
- [ ] Verify Dashboard shows new customers

---

## Rollback Plan

If issues occur in production:

```bash
# Revert to main branch
git checkout main

# Or revert specific commit
git revert <commit-hash>
```

---

## Security Notes

1. **API Key**: Store securely, rotate periodically
2. **Session Secret**: Use cryptographically secure random value
3. **Database**: Use SSL connection in production
4. **HTTPS**: Ensure production uses HTTPS (Replit handles this)

---

## Contact

For production credentials, contact client for:
- [ ] PostgreSQL connection string
- [ ] Replit deployment URL
- [ ] reCAPTCHA keys (if needed)
