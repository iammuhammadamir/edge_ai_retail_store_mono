# ClientBridge - Retail AI Visitor Counter

A full-stack system for tracking retail store visitors using facial recognition. Edge devices (Jetson/Mac) detect faces and send embeddings to the server for identification.

## Features

✅ **Face Recognition** - Detect and identify returning customers  
✅ **Visit Counting** - Track customer visit frequency  
✅ **Server-Side Matching** - Single source of truth, no local database on edge  
✅ **Customer Management** - View, flag, and delete customers from dashboard  
✅ **Multi-Location Support** - Separate customer databases per store  
✅ **Role-Based Access** - Owner, Manager, Reviewer permissions  

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Drizzle ORM
- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui
- **Database**: PostgreSQL
- **Edge Device**: Python, OpenCV, InsightFace
- **Face Recognition**: InsightFace (buffalo_s model)

## Project Structure

```
ClientBridge/
├── server/                 # Express backend
│   ├── index.ts           # Server entry point
│   ├── routes.ts          # API routes
│   ├── edgeRoutes.ts      # Edge device API (/api/edge/identify)
│   ├── matching.ts        # Cosine similarity matching
│   ├── storage.ts         # Storage interface
│   └── dbStorage.ts       # PostgreSQL implementation
├── client/                 # React frontend
│   └── src/
│       ├── pages/
│       │   └── Dashboard.tsx  # Main dashboard
│       └── components/        # UI components
├── shared/
│   └── schema.ts          # Database schema (Drizzle)
├── public/
│   └── customers/         # Uploaded face images
├── docs/
│   ├── database.md        # Database documentation
│   └── server-side-matching-migration.md
└── package.json

Edge_AI_For_Retail_Stores/  # Edge device (separate repo)
├── visitor_counter.py     # Main application
├── api_client.py          # Server API client
├── face_recognition.py    # InsightFace wrapper
├── frame_quality.py       # Frame quality scoring
└── config.py              # Configuration
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Python 3.9+ (for edge device)

### 1. Database Setup

```bash
# Create database
createdb clientbridge

# Or with psql
psql -c "CREATE DATABASE clientbridge;"
```

### 2. Install Dependencies

```bash
cd ClientBridge
npm install
```

### 3. Run the Server

```bash
DATABASE_URL="postgresql://localhost:5432/clientbridge" \
SESSION_SECRET="dev-secret" \
EDGE_API_KEY="dev-edge-api-key" \
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:5000

### 4. Login

Default credentials (seeded on first run):
- **Manager**: `manager1` / `manager1`
- **Manager**: `manager2` / `manager2`

## Edge Device Setup

### 1. Install Python Dependencies

```bash
cd Edge_AI_For_Retail_Stores
python -m venv venv
source venv/bin/activate
pip install opencv-python insightface numpy requests onnxruntime
```

### 2. Configure Edge Device

Edit `config.py`:
```python
API_BASE_URL = "http://localhost:5000"  # Server URL
API_KEY = "dev-edge-api-key"            # Must match server
API_LOCATION_ID = 1                      # Store location ID
```

### 3. Run Edge Device

```bash
source venv/bin/activate
python visitor_counter.py --webcam
```

## How It Works

### Server-Side Matching Flow

```
Edge Device                              Server
    │                                       │
    ├── Detect face                         │
    ├── Capture best frame                  │
    ├── Extract 512-dim embedding           │
    │                                       │
    └── POST /api/edge/identify ──────────► │
        { embedding: [...], image: ... }    │
                                            ├── Load all embeddings for location
                                            ├── Compute cosine similarity
                                            ├── If match > 0.45: returning customer
                                            │   └── Increment visit count
                                            ├── If no match: new customer
                                            │   └── Create record with embedding
                                            │
    ◄─────────────────────────────────────── │
    { status: "new"|"returning",            │
      customerId: 123, visitCount: 5 }      │
```

### Customer Management

- **View**: Dashboard shows all customers with visit counts
- **Delete**: Click trash icon → customer removed, no longer recognized
- **Flag**: Click flag buttons (red/yellow/green) for staff awareness
- **Edit Name**: Click on customer to assign a name

## API Endpoints

### Edge Device API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/edge/identify` | POST | Send embedding for identification |
| `/api/edge/health` | GET | Health check |

### Customer API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/customers` | GET | List all customers |
| `/api/customers/:id` | DELETE | Delete customer |
| `/api/customers/:id/flag` | PATCH | Update customer flag |

## Database

See [docs/database.md](docs/database.md) for full schema documentation.

Key table: `customers`
- `id` - Primary key
- `face_id` - Auto-generated identifier
- `points` - Visit count
- `embedding` - 512-dim face embedding (JSON)
- `photo_url` - Face image path
- `flag` - Manager flag (red/yellow/green)

## Troubleshooting

**Server won't start:**
```bash
# Check PostgreSQL is running
pg_isready

# Check port 5000
lsof -i :5000

# Check database exists
psql -l | grep clientbridge
```

**Edge device can't connect:**
```bash
# Test API health
curl http://localhost:5000/api/edge/health -H "X-API-Key: dev-edge-api-key"
```

**Face not recognized as returning:**
- Similarity threshold is 0.45 (adjustable in `server/matching.ts`)
- Check server logs for similarity scores
- Ensure good lighting and frontal face

## License

MIT License
