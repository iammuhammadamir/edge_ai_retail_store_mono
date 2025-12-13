# Edge AI for Retail Stores

Edge device component for the Smoothflow AI retail intelligence platform. Runs on Jetson Nano/Orin or Mac for development.

## Features

- **Face Recognition**: Detect and identify customers using InsightFace
- **Quality Scoring**: Select best frames for accurate recognition
- **Multi-Camera**: Support multiple cameras with different use cases
- **Server-Side Matching**: No local database - server is source of truth

## Quick Start

### 1. Install Dependencies

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Cameras

Edit `cameras.yaml`:

```yaml
location:
  id: 1
  name: "Store Downtown"

api:
  base_url: "https://dashboard.smoothflow.ai"
  key: "your-edge-api-key"

cameras:
  - id: "cam_entrance"
    name: "Entrance Camera"
    rtsp_url: "rtsp://admin:password@192.168.1.100:554/stream1"
    use_case: "face_recognition"
    enabled: true
    settings:
      similarity_threshold: 0.45
      cooldown_seconds: 10
      min_quality_score: 350
```

### 3. Run

```bash
# All enabled cameras
python main.py

# Specific camera
python main.py --camera cam_entrance

# Development with webcam
python visitor_counter.py --webcam
```

## Files

| File | Purpose |
|------|---------|
| `main.py` | Multi-camera entry point |
| `visitor_counter.py` | Face recognition worker |
| `cameras.yaml` | Camera configuration |
| `api_client.py` | Server API client |
| `face_recognition.py` | InsightFace wrapper |
| `frame_quality.py` | Quality scoring |
| `config.py` | Legacy/default settings |

## Documentation

See [docs/context.md](docs/context.md) for detailed documentation including:
- System architecture
- Processing flow
- Quality scoring algorithm
- Multi-camera setup
- Troubleshooting

## Live Streaming

For live video streaming setup, see [../docs/Streaming.md](../docs/Streaming.md).

## Requirements

- Python 3.9+
- OpenCV
- InsightFace
- ONNX Runtime (GPU version for Jetson)

## License

MIT License
