# Face Recognition Pipeline Logic

This document describes the complete frame processing and recognition pipeline.

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VISITOR COUNTER PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  4K RTSP Frame                                                              │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────┐                                                            │
│  │   CROP      │  35% left, 35% right, 10% top, 40% bottom                 │
│  │  (center)   │  → Focus on region of interest, effective zoom            │
│  └─────────────┘                                                            │
│       │                                                                     │
│       ├──────────────────────────────────┐                                  │
│       ▼                                  ▼                                  │
│  frame_cropped                     frame_resized                            │
│  (high-res ~1152×1080)            (1280w, aspect preserved)                │
│       │                                  │                                  │
│       │                                  ▼                                  │
│       │                         ┌────────────────┐                          │
│       │                         │ PHASE 1: YuNet │                          │
│       │                         │  Detection     │                          │
│       │                         │ (conf ≥ 0.8)   │                          │
│       │                         └────────────────┘                          │
│       │                                  │                                  │
│       │                                  ▼                                  │
│       │                         ┌────────────────┐                          │
│       │                         │ PHASE 2: Capture│                         │
│       │                         │  5 sec burst   │                          │
│       │                         │  (both frames) │                          │
│       │                         └────────────────┘                          │
│       │                                  │                                  │
│       │                                  ▼                                  │
│       │                         ┌────────────────┐                          │
│       │                         │ PHASE 3: Score │                          │
│       │                         │  Quality       │                          │
│       │                         │ (on resized)   │                          │
│       │                         └────────────────┘                          │
│       │                                  │                                  │
│       ▼                                  ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐             │
│  │              PHASE 4: Multi-Frame Embedding Fusion         │             │
│  │  • Take top 3 frames above MIN_QUALITY_SCORE               │             │
│  │  • Extract embeddings from HIGH-RES (cropped) frames       │             │
│  │  • Soft-weighted average: weight = score^0.3               │             │
│  │  • Re-normalize to unit vector                             │             │
│  └────────────────────────────────────────────────────────────┘             │
│                                  │                                          │
│                                  ▼                                          │
│                         ┌────────────────┐                                  │
│                         │ PHASE 5: API   │                                  │
│                         │  Identify      │                                  │
│                         └────────────────┘                                  │
│                                  │                                          │
│                                  ▼                                          │
│                         NEW or RETURNING visitor                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase Details

### Phase 1: Face Detection (YuNet)

**File**: `frame_quality.py` → `detect_face()`

**Input**: `frame_resized` (1280w)

**Process**:
1. YuNet detector scans frame for faces
2. Filter faces by `MIN_DET_CONF` (default 0.8)
3. Return largest face (by area) among confident detections

**Output**: `((x1, y1, x2, y2), confidence)` or `None`

**Early Exit**: If no face ≥ 0.8 confidence → skip all subsequent phases

---

### Phase 2: Frame Capture

**File**: `visitor_counter.py` → `capture_frames_for_person()`

**Duration**: 5 seconds (configurable: `QUALITY_CAPTURE_DURATION_SEC`)

**Frame Skip**: Keep every 3rd frame (configurable: `QUALITY_FRAME_SKIP`)

**Storage**: Each frame stored as tuple `(frame_cropped, frame_resized)`
- `frame_cropped`: High-resolution for embedding extraction
- `frame_resized`: Lower-resolution for scoring (faster)

---

### Phase 3: Quality Scoring

**File**: `frame_quality.py` → `compute_quality_score()`

**Input**: `frame_resized` (for speed)

**Scoring Formula**:
```
total = 1000 × frontality^(8/5) × face_size^(5/5) × sharpness^(0/5) × ...
```

**Active Factors** (importance > 0):
| Factor | Importance | Effect |
|--------|------------|--------|
| frontality | 8 | Quadratic penalty for angled faces |
| face_size | 5 | Linear penalty for small faces |

**Disabled Factors** (importance = 0):
- sharpness
- brightness  
- contrast

**Quality Gate**: `MIN_QUALITY_SCORE = 500` (frames below this are skipped)

---

### Phase 4: Embedding Fusion

**File**: `visitor_counter.py` → `compute_fused_embedding()`

**Process**:
1. Take top N frames (default 3) that pass quality threshold
2. For each frame:
   - Extract embedding from **high-res cropped frame** (not resized)
   - Check InsightFace detection confidence ≥ `MIN_DETECTION_SCORE` (0.75)
3. Compute soft-weighted average:
   ```python
   weight = quality_score ^ 0.3  # Dampened weighting
   fused = Σ(embedding × weight) / Σ(weight)
   fused = fused / ||fused||  # Re-normalize
   ```

**Why High-Res?**: More pixels → better embedding quality → better recognition

**Why Soft Weighting?**: Prevents single high-score frame from dominating. With power=0.3:
- Score 900 vs 300 → weight ratio 1.4x (not 3x)

---

### Phase 5: API Identification

**File**: `visitor_counter.py` → `api.identify()`

**Sends to Server**:
- Fused embedding (512-dim vector)
- Best frame image (resized, for storage)
- Bounding box

**Server Response**:
- `status`: "new" or "returning"
- `customer_id`: Visitor ID
- `similarity`: Match confidence (for returning)
- `visit_count`: Number of visits

---

## Configuration Reference

### Cropping
```python
crop_left = 0.35    # 35% from left
crop_right = 0.35   # 35% from right
crop_top = 0.10     # 10% from top
crop_bottom = 0.40  # 40% from bottom
```

### Quality Thresholds
```python
MIN_DET_CONF = 0.8           # YuNet detection confidence
MIN_QUALITY_SCORE = 500      # Quality score gate (out of 1000)
MIN_DETECTION_SCORE = 0.75   # InsightFace confidence
```

### Face Size Thresholds (pixels)
```python
zero_px = 60       # Below = score 0 (unusable)
critical_px = 100  # Below = aggressive penalty
good_px = 115      # Above = perfect score
```

### Frontality Thresholds (degrees)
```python
good_yaw = 3°      # Within = perfect score
critical_yaw = 10° # Beyond = aggressive penalty
good_pitch = 2°
critical_pitch = 8°
```

### Embedding Fusion
```python
EMBEDDING_FUSION_TOP_N = 3        # Max frames to fuse
EMBEDDING_FUSION_WEIGHT_POWER = 0.3  # Soft weighting exponent
```

---

## Models Used

| Model | Purpose | Speed | File |
|-------|---------|-------|------|
| YuNet | Fast face detection | ~5-10ms | `face_detection_yunet_2023mar.onnx` |
| InsightFace buffalo_s | Embedding extraction | ~50-100ms | Downloaded to `~/.insightface/models` |

---

## Data Flow Summary

```
Original 4K → Crop (35%/35%/10%/40%) → Resize (1280w)
                    ↓                        ↓
              frame_cropped            frame_resized
              (for embedding)          (for detection/scoring)
```

**Key Insight**: Detection and scoring use resized frames (fast), but embedding extraction uses cropped frames (high quality).
