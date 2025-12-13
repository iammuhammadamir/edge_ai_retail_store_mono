# Edge Device - Multi-Camera System

> **Last Updated**: December 13, 2025  
> **Status**: ✅ Production Ready - Multi-Camera Support  
> **Backend**: https://dashboard.smoothflow.ai

---

## Quick Summary

This is the **edge device component** of the ClientBridge system. It runs on a Jetson Nano (or Mac for development) and supports **multiple cameras** with different use cases:

- **Face Recognition**: Customer loyalty tracking via facial recognition
- **Live Streaming**: Real-time video streaming to dashboard (Phase 2)

**Key Points**:
- No local database - server is the single source of truth
- Configuration via `cameras.yaml` - easy to add/remove cameras
- Each camera can have custom settings (thresholds, quality gates, etc.)
- Location-based data separation for multi-store deployments

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     JETSON NANO (Edge Device)                    │
│                                                                  │
│  ┌──────────────┐                                               │
│  │   Camera     │  RTSP Stream (4K @ 15fps)                     │
│  │  (Tapo C212) │                                               │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  visitor_counter.py                                       │   │
│  │                                                           │   │
│  │  1. DETECT: Haar cascade (fast, triggers capture)        │   │
│  │  2. CAPTURE: 5 seconds of frames (~50 frames)            │   │
│  │  3. SCORE: Quality scoring (sharpness, frontality)       │   │
│  │  4. EXTRACT: InsightFace → 512-dim embedding             │   │
│  │  5. SEND: POST to server with embedding + photo          │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                                                        │
│         │ HTTPS POST /api/edge/identify                         │
│         │ { embedding: [512 floats], imageBase64, locationId }  │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUD (Vercel + Supabase)                    │
│                                                                  │
│  Server compares embedding against all customers:               │
│  - similarity > 0.50 → RETURNING (increment visits)             │
│  - similarity < 0.50 → NEW (create customer, save photo)        │
│                                                                  │
│  Response: { status: "new"|"returning", customerId, visitCount } │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hardware

| Component | Details |
|-----------|---------|
| **Edge Device** | NVIDIA Jetson Orin Nano |
| **Camera** | Tapo C212 (Wi-Fi, 4K, pan/tilt) |
| **Stream URL** | `rtsp://admin:SmoothFlow@10.0.0.227:554/h264Preview_01_main` |
| **Processing** | 4K → crop center (35% L/R, 10% T, 40% B) → resize to 1280 |

---

## Project Files

| File | Purpose |
|------|---------|
| `cameras.yaml` | **Camera configuration** - define cameras, use cases, settings |
| `main.py` | **Main entry point** - spawns workers for each camera |
| `camera_manager.py` | Loads and validates camera configuration |
| `visitor_counter.py` | Face recognition worker - detection, quality scoring, API calls |
| `api_client.py` | HTTP client for server communication |
| `face_recognition.py` | InsightFace wrapper - embedding extraction |
| `frame_quality.py` | Quality scoring (sharpness, frontality, brightness, contrast) |
| `config.py` | Legacy config (still used for model paths, debug settings) |
| `requirements.txt` | Python dependencies |

---

## Configuration (`cameras.yaml`)

All camera configuration is now in `cameras.yaml`. This makes it easy to:
- Add/remove cameras without code changes
- Set per-camera hyperparameters
- Enable/disable cameras without deleting config

### Example Configuration
```yaml
# Location this device belongs to
location:
  id: 1
  name: "Store Downtown"

# API Configuration
api:
  base_url: "https://dashboard.smoothflow.ai"
  key: "dev-edge-api-key"

# Camera definitions
cameras:
  # Face Recognition Camera
  - id: "cam_entrance"
    name: "Entrance Camera"
    rtsp_url: "rtsp://admin:password@10.0.0.227:554/stream"
    use_case: "face_recognition"
    enabled: true
    settings:
      target_width: 1280
      process_every_n_frames: 5
      quality_capture_duration: 5.0
      quality_frame_skip: 3
      similarity_threshold: 0.45
      cooldown_seconds: 10
      min_quality_score: 350
      min_detection_score: 0.70

  # Live Stream Camera (Phase 2)
  - id: "cam_floor"
    name: "Floor Camera"
    rtsp_url: "rtsp://admin:password@10.0.0.228:554/stream"
    use_case: "live_stream"
    enabled: false  # Enable when Phase 2 is ready
    settings:
      target_width: 854  # 480p
      target_fps: 15
      jpeg_quality: 80
```

### Use Cases

| Use Case | Purpose | Processing |
|----------|---------|------------|
| `face_recognition` | Customer loyalty tracking | Heavy (InsightFace, quality scoring) |
| `live_stream` | Real-time monitoring | Light (encode & stream) - Phase 2 |

### Legacy Configuration (`config.py`)

`config.py` is still used for:
- Model paths (InsightFace model directory)
- Debug settings (DEBUG_MODE, DEBUG_OUTPUT_DIR)
- Default values when running in legacy mode (`--legacy` flag)

---

## Quick Start

### On Jetson Nano
```bash
# 1. Copy this folder to Jetson
scp -r Edge_AI_For_Retail_Stores/ mafiq@jetson:/home/mafiq/

# 2. SSH into Jetson
ssh mafiq@jetson

# 3. Create virtual environment
cd Edge_AI_For_Retail_Stores
python3 -m venv venv
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Edit cameras.yaml (camera URLs, location ID, settings)
nano cameras.yaml

# 6. Validate configuration
python main.py --validate

# 7. Run all enabled cameras
python main.py

# Or run a specific camera
python main.py --camera cam_entrance
```

### On Mac (Development)
```bash
# Use webcam (legacy mode)
python visitor_counter.py --webcam

# With debug output
python visitor_counter.py --webcam --debug

# Or use cameras.yaml with webcam configured
python main.py --camera cam_dev
```

### CLI Options

```bash
# main.py - Multi-camera entry point
python main.py                        # Run all enabled cameras
python main.py --camera cam_entrance  # Run specific camera
python main.py --list                 # List configured cameras
python main.py --validate             # Validate config and exit
python main.py --debug                # Enable debug mode

# visitor_counter.py - Single camera (legacy or specific)
python visitor_counter.py --legacy    # Use config.py (old behavior)
python visitor_counter.py --webcam    # Use webcam (camera 0)
python visitor_counter.py --camera cam_entrance  # Use cameras.yaml
```

---

## Processing Flow (Detailed)

### Phase 0: Frame Preprocessing
- **Center Crop**: 35% left, 35% right, 10% top, 40% bottom
- Reduces 4K (3840×2160) to center region (1152×1080)
- Benefits:
  - Eliminates edge noise and false positives
  - Makes faces ~3× larger relative to frame (effective zoom)
  - Focuses on entrance area where customers appear

### Phase 1: Face Detection (~5-10ms)
- Uses **YuNet** (modern CNN-based detector from OpenCV Zoo)
- Much more accurate than legacy Haar Cascade
- Runs on every 5th frame (~3 FPS)

### Phase 2: Frame Capture (~5000ms)
- Captures frames for 5 seconds after detection
- Keeps every 3rd frame (~50 frames total)
- Gives time for person to look at camera

### Phase 3: Quality Scoring (~2000-3000ms)
- **Multiplicative penalty system** - each factor independently impacts score
- Formula: `score = 1000 × f1^(imp1/5) × f2^(imp2/5) × ...`
- **Aggressive thresholds**: Each factor has `critical` and `good` thresholds
  - Above `good`: perfect score (1.0)
  - Between `critical` and `good`: linear interpolation
  - Below `critical`: **quadratic penalty** (score drops rapidly)

#### Configurable Thresholds (`config.py` → `QUALITY_THRESHOLDS`)
| Factor | Zero | Critical | Good | Notes |
|--------|------|----------|------|-------|
| **Face Size** | 60px | 105px | 105px | Below 60px = score 0, quadratic penalty 60-105px |
| **Frontality (Yaw)** | - | ±35° | ±15° | Left/right rotation |
| **Frontality (Pitch)** | - | ±30° | ±10° | Up/down rotation |

#### Importance Weights (0-10 scale)
- **Frontality (8)**: Critical - angled faces match poorly
- **Face Size (5)**: Important - small faces are unreliable
- **Sharpness (0)**: Disabled
- **Brightness (0)**: Disabled
- **Contrast (0)**: Disabled

### Quality Gate 1: Minimum Quality Score
- **Threshold**: 350/1000
- If best frame score < 350, skip recognition entirely
- Prevents wasting API calls on poor captures (angled faces, far away, etc.)

### Phase 4: Embedding Extraction (~50-100ms)
- Uses **InsightFace buffalo_s** model
- Extracts 512-dimensional face embedding
- Returns detection confidence score

### Quality Gate 2: Detection Confidence
- **Threshold**: 0.70
- If InsightFace detection confidence < 0.70, skip API call
- Prevents false enrollments from unreliable embeddings

### Phase 5: Server Identification (~500-1000ms)
- POST to `/api/edge/identify`
- Server compares against all customers
- Returns: new/returning, customer ID, visit count

### Cooldown (30 seconds)
- Prevents same person being counted multiple times
- Resumes scanning after cooldown

---

## API Communication

### Health Check
```bash
curl https://dashboard.smoothflow.ai/api/edge/health \
  -H "X-API-Key: dev-edge-api-key"

# Response: { "success": true, "message": "Edge API is healthy" }
```

### Identify (Main Endpoint)
```bash
curl -X POST https://dashboard.smoothflow.ai/api/edge/identify \
  -H "X-API-Key: dev-edge-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "embedding": [0.1, 0.2, ... 512 floats],
    "imageBase64": "base64-encoded-jpeg",
    "locationId": 1
  }'

# Response (new customer):
{ "success": true, "status": "new", "customerId": 5, "visitCount": 1 }

# Response (returning customer):
{ "success": true, "status": "returning", "customerId": 3, "visitCount": 7, "similarity": 0.82 }
```

---

## Multi-Store Setup

Each store has a unique `location_id` in the database. To set up a new store:

1. **Create location** in dashboard (owner login)
2. **Note the location ID** (e.g., 2)
3. **Update cameras.yaml** on that store's Jetson:
   ```yaml
   location:
     id: 2
     name: "Store Uptown"
   ```

Customers are scoped to locations - Store A's customers won't appear in Store B's dashboard.

---

## Multi-Camera Setup (Same Store)

Add multiple cameras to `cameras.yaml`:

```yaml
cameras:
  - id: "cam_entrance"
    name: "Entrance Camera"
    rtsp_url: "rtsp://admin:pass@10.0.0.227:554/stream"
    use_case: "face_recognition"
    enabled: true
    settings:
      # ... settings ...

  - id: "cam_exit"
    name: "Exit Camera"
    rtsp_url: "rtsp://admin:pass@10.0.0.228:554/stream"
    use_case: "face_recognition"
    enabled: true
    settings:
      # ... settings ...

  - id: "cam_floor"
    name: "Floor Camera"
    rtsp_url: "rtsp://admin:pass@10.0.0.229:554/stream"
    use_case: "live_stream"
    enabled: true
    settings:
      target_width: 854
      target_fps: 15
```

Then run:
```bash
python main.py  # Starts all enabled cameras as separate processes
```

All cameras with the same `location.id` contribute to the same customer database.

---

## Known Issues / TODO

### Live Streaming (IMPLEMENTED)

**Status**: ✅ Production Ready

**Architecture**: MediaMTX + Cloudflare Tunnel
- MediaMTX proxies RTSP cameras to Low-Latency HLS
- Cloudflare Tunnel exposes stream to internet (no port forwarding)
- Browser plays via hls.js library
- Latency: 5-8 seconds

**Setup**: See [/docs/Streaming.md](../../../docs/Streaming.md) for complete guide.

**Quick Start**:
```bash
# 1. Install MediaMTX and cloudflared (see Streaming.md)

# 2. Configure mediamtx.yml with camera RTSP URL
paths:
  cam1:
    source: rtsp://admin:password@192.168.1.100:554/stream1
    sourceOnDemand: yes

# 3. Start services
mediamtx ~/mediamtx.yml &
cloudflared tunnel --url http://localhost:8888

# 4. Update stream URL in database
# Stream URL: https://<tunnel-url>.trycloudflare.com/cam1/index.m3u8
```

**Note**: The old `live_stream.py` (Supabase upload method) is deprecated. Use MediaMTX instead for simpler setup and lower latency.

### Performance on Jetson
- First run downloads ~100MB model
- Model loading takes ~10-20 seconds
- After that, detection is fast (~5ms per frame)

### Network Dependency
- Requires internet connection to server
- If server unreachable, detection stops
- Could add offline queue for resilience (not implemented)

---

## Debug Mode

```bash
python visitor_counter.py --debug
```

Creates reports in `debug_output/`:
- `debug_YYYYMMDD_HHMMSS.md` - Quality scores for all frames
- `best_YYYYMMDD_HHMMSS.jpg` - Best frame with bounding box

Useful for tuning quality thresholds.

---

## Troubleshooting

### "API not reachable"
- Check internet connection
- Verify `API_BASE_URL` in config.py
- Verify `API_KEY` matches server's `EDGE_API_KEY`

### "Cannot connect to camera"
- Check camera is on same network
- Verify RTSP URL is correct
- Try opening stream in VLC first

### "No face found in best frame"
- Person may have moved too fast
- Try increasing `QUALITY_CAPTURE_DURATION_SEC`
- Check lighting conditions

### Low similarity scores
- Poor lighting or camera angle
- Try adjusting `SIMILARITY_THRESHOLD` (lower = more matches)
- Check if face is too small in frame

---

## Dependencies

### Python Packages
```
opencv-python>=4.8.0
numpy>=1.24.0
insightface>=0.7.0
onnxruntime>=1.15.0
requests>=2.28.0
PyYAML>=6.0
supabase>=2.0.0        # For live streaming (Supabase Storage uploads)
```

For Jetson with GPU acceleration, use `onnxruntime-gpu` instead of `onnxruntime`.

### System Dependencies (for Live Streaming)
```bash
# FFmpeg - required for HLS segment generation
sudo apt install ffmpeg

# Verify FFmpeg supports required codecs
ffmpeg -encoders | grep libx264  # Should show H.264 encoder
```
