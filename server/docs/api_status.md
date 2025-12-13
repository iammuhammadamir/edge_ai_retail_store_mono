# API Deployment Status

## Deployed on Vercel
**URL**: https://clientbridge-ten.vercel.app

## ✅ Working Endpoints (9 serverless functions)

### Authentication
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/login` | POST | User login, returns JWT token |
| `/api/auth/logout` | POST | Logout (stateless acknowledgment) |
| `/api/auth/me` | GET | Get current user info from JWT |

### Customers (Face Recognition)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/customers` | GET | List all customers (filtered by location for managers) |
| `/api/customers/:id` | GET | Get single customer |
| `/api/customers/:id` | DELETE | Delete customer |
| `/api/customers/:id/name` | PATCH | Update customer name |
| `/api/customers/:id/flag` | PATCH | Update customer flag (red/yellow/green) |

### Edge Device
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/edge/health` | GET | Health check (requires API key) |
| `/api/edge/identify` | POST | Face recognition - identify/create customer |

### Cameras
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cameras` | GET | List cameras (optional ?locationId filter) |
| `/api/cameras/:id/status` | PATCH | Update camera status |

### Inventory
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/inventory` | GET | List inventory items |
| `/api/inventory` | POST | Create inventory item |
| `/api/inventory/:id` | GET | Get single item |
| `/api/inventory/:id` | PATCH | Update item |
| `/api/inventory/:id` | DELETE | Delete item |

### Admin (Owner only)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/locations` | GET, POST | Manage store locations |
| `/api/admin/cameras` | GET, POST | Manage cameras |
| `/api/admin/users` | GET, POST | Manage users |

---

## ❌ Removed Features (To Add Later)

These were removed to stay under Vercel's 12-function limit on the Hobby plan.

### Notifications
- `/api/notifications` - GET list of notifications
- `/api/notifications/:id/read` - PATCH mark as read
- `/api/notifications/read-all` - PATCH mark all as read

**Purpose**: Show alerts in dashboard (customer flagged, theft confirmed, etc.)

### Reviews
- `/api/reviews` - GET/POST video clip review decisions

**Purpose**: Audit trail of manager/reviewer decisions on video clips

### Camera Reviews
- `/api/camera-reviews` - GET/POST live camera review decisions

**Purpose**: Same as reviews but for live camera feeds

---

## How to Add Back Later

**Option 1**: Upgrade to Vercel Pro ($20/month) - removes 12-function limit

**Option 2**: Combine more routes into single functions (like we did with customers)

**Option 3**: Move to Railway/Render for full Express server without limits

---

## Environment Variables Required on Vercel

- `DATABASE_URL` - Supabase PostgreSQL connection string
- `JWT_SECRET` - Secret for signing JWT tokens
- `EDGE_API_KEY` - API key for edge device authentication
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key
