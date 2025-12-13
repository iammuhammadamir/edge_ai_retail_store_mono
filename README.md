# Smoothflow AI - Retail Intelligence Platform

A complete system for retail store intelligence including customer recognition, visit tracking, and live video monitoring.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EDGE DEVICE (Jetson)                            │
│                                                                              │
│  ┌──────────────┐     ┌──────────────────────────────────────────────────┐  │
│  │  IP Camera   │────►│  visitor_counter.py (Face Recognition)           │  │
│  │  (RTSP)      │     │  - Detect faces, extract embeddings              │  │
│  └──────────────┘     │  - Send to server for identification             │  │
│                       └──────────────────────────────────────────────────┘  │
│                                        │                                     │
│  ┌──────────────┐     ┌──────────────────────────────────────────────────┐  │
│  │  IP Camera   │────►│  MediaMTX + Cloudflare Tunnel (Live Streaming)   │  │
│  │  (RTSP)      │     │  - Convert RTSP to Low-Latency HLS               │  │
│  └──────────────┘     │  - Expose via Cloudflare Tunnel                  │  │
│                       └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUD (Vercel + Supabase)                       │
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────┐  │
│  │  ClientBridge API   │    │  PostgreSQL (Supabase)│    │  React Dashboard │  │
│  │  - Face matching    │◄──►│  - Customers         │◄──►│  - Live streams  │  │
│  │  - Visit counting   │    │  - Visits            │    │  - Customer mgmt │  │
│  │  - Camera mgmt      │    │  - Cameras           │    │  - Analytics     │  │
│  └─────────────────────┘    └─────────────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
mafi/
├── ClientBridge/                 # Web application (API + Dashboard)
│   ├── server/                   # Express.js backend
│   ├── client/                   # React frontend
│   ├── shared/                   # Shared types and schema
│   └── README.md                 # ClientBridge documentation
│
├── Edge_AI_For_Retail_Stores/    # Edge device code (Jetson/Mac)
│   ├── visitor_counter.py        # Face recognition worker
│   ├── main.py                   # Multi-camera entry point
│   ├── cameras.yaml              # Camera configuration
│   ├── live_stream.py            # HLS streaming (legacy)
│   └── docs/context.md           # Edge device documentation
│
└── docs/                         # Project-wide documentation
    ├── Streaming.md              # Live streaming setup guide
    └── LiveStreamInfo.md         # HLS configuration details
```

## Features

### 1. Customer Recognition (Face Recognition)
- **Edge Processing**: Detect faces, score quality, extract embeddings
- **Server Matching**: Compare against customer database
- **Visit Tracking**: Count returning customers, track visit frequency
- **Flagging System**: Mark customers (red/yellow/green) for staff awareness

### 2. Live Video Streaming
- **Low-Latency HLS**: 5-8 second latency via MediaMTX
- **Cloudflare Tunnel**: No port forwarding needed
- **On-Demand**: Camera activates when someone views the stream
- **Multi-Camera**: Support for multiple streams per location

### 3. Multi-Location Support
- Separate customer databases per store
- Role-based access (Owner, Manager, Reviewer)
- Location-scoped dashboards

## Quick Start

### Cloud Setup (ClientBridge)

```bash
cd ClientBridge
npm install
DATABASE_URL="postgresql://..." npm run dev
```

See [ClientBridge/README.md](ClientBridge/README.md) for full setup.

### Edge Device Setup (Jetson)

#### Face Recognition
```bash
cd Edge_AI_For_Retail_Stores
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Configure cameras.yaml with your RTSP URLs
nano cameras.yaml

# Run
python main.py
```

See [Edge_AI_For_Retail_Stores/docs/context.md](Edge_AI_For_Retail_Stores/docs/context.md) for full setup.

#### Live Streaming
```bash
# Install MediaMTX and cloudflared
# Configure mediamtx.yml with camera RTSP URLs
# Start services

mediamtx ~/mediamtx.yml &
cloudflared tunnel --url http://localhost:8888
```

See [docs/Streaming.md](docs/Streaming.md) for full setup.

## Documentation Index

| Document | Description |
|----------|-------------|
| [ClientBridge/README.md](ClientBridge/README.md) | Web app setup, API endpoints, database schema |
| [Edge_AI_For_Retail_Stores/docs/context.md](Edge_AI_For_Retail_Stores/docs/context.md) | Face recognition setup, cameras.yaml config |
| [docs/Streaming.md](docs/Streaming.md) | Live streaming with MediaMTX + Cloudflare |
| [docs/LiveStreamInfo.md](docs/LiveStreamInfo.md) | HLS latency tuning (legacy Supabase method) |

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js, Express, TypeScript, Drizzle ORM |
| **Frontend** | React 18, Vite, TailwindCSS, shadcn/ui |
| **Database** | PostgreSQL (Supabase) |
| **Edge Device** | Python, OpenCV, InsightFace |
| **Streaming** | MediaMTX, FFmpeg, Cloudflare Tunnel, hls.js |
| **Hosting** | Vercel (web), Supabase (database) |

## Environment Variables

### ClientBridge (Cloud)
```bash
DATABASE_URL=postgresql://...
SESSION_SECRET=...
EDGE_API_KEY=...
```

### Edge Device (Jetson)
```bash
# Set in cameras.yaml
api:
  base_url: "https://dashboard.smoothflow.ai"
  key: "your-edge-api-key"
```

## License

MIT License
