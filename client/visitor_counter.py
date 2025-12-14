#!/usr/bin/env python3
"""
Visitor Counter - Face Recognition Worker

Detects faces, captures frames for quality scoring, extracts embeddings,
and sends to server for identification.

Flow:
1. Detect face (fast detection)
2. Capture frames for X seconds
3. Score frames and select best quality
4. Extract embedding from best frame
5. Send embedding to server (server decides new vs returning)

NOTE: No local database - server is the single source of truth.

Can be run standalone or as a worker spawned by main.py.
"""

import cv2
import time
import os
import sys
import argparse
import logging
import base64
from datetime import datetime
from typing import Optional, List, Tuple
from dataclasses import dataclass
import numpy as np

import config as cfg
from face_recognition import (
    extract_embeddings,
    get_face_analyzer,
)
from frame_quality import (
    compute_quality_score,
    score_frames,
    score_frames_dual,
    get_best_frame,
    detect_face,
    QualityScore
)
from api_client import ClientBridgeAPI, init_api, get_api
from camera_manager import CameraConfig, FaceRecognitionSettings, load_config, get_config

# =============================================================================
# LOGGING SETUP
# =============================================================================

logging.basicConfig(
    level=cfg.LOG_LEVEL,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class PersonCapture:
    """Container for frames captured for a single person."""
    session_id: str
    frames: List[Tuple[np.ndarray, np.ndarray]]  # (cropped_hires, resized_lowres)
    start_time: float
    trigger_frame: Tuple[np.ndarray, np.ndarray]  # (cropped_hires, resized_lowres)


# =============================================================================
# HELPERS
# =============================================================================

def crop_frame(frame: np.ndarray, crop_left: float = 0.25, crop_right: float = 0.25,
               crop_top: float = 0.10, crop_bottom: float = 0.10) -> np.ndarray:
    """
    Crop frame to remove edges and focus on center region.
    
    This improves face detection by:
    1. Eliminating edge noise/false positives
    2. Making faces larger relative to frame (effective zoom)
    
    Args:
        frame: Input BGR image
        crop_left: Fraction to crop from left (0.25 = 25%)
        crop_right: Fraction to crop from right
        crop_top: Fraction to crop from top
        crop_bottom: Fraction to crop from bottom
    
    Returns:
        Cropped frame
    """
    h, w = frame.shape[:2]
    x1 = int(w * crop_left)
    x2 = int(w * (1 - crop_right))
    y1 = int(h * crop_top)
    y2 = int(h * (1 - crop_bottom))
    return frame[y1:y2, x1:x2]


def resize_frame(frame: np.ndarray, target_width: int) -> np.ndarray:
    """Resize frame maintaining aspect ratio."""
    h, w = frame.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    return cv2.resize(frame, (target_width, new_h))


def save_visitor_image(frame: np.ndarray, visitor_id: int, session_id: str) -> str:
    """Save a sample image for a visitor."""
    os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{cfg.OUTPUT_DIR}/visitor_{visitor_id}_{session_id}_{timestamp}.jpg"
    cv2.imwrite(filename, frame)
    return filename


# =============================================================================
# FRAME CAPTURE
# =============================================================================

def capture_frames_for_person(
    cap: cv2.VideoCapture,
    trigger_frame: np.ndarray,
    duration: float,
    frame_skip: int,
    target_width: int
) -> PersonCapture:
    """
    Capture frames for a detected person over specified duration.
    
    Args:
        cap: Video capture object
        trigger_frame: The frame that triggered detection
        duration: How long to capture (seconds)
        frame_skip: Keep every Nth frame
        target_width: Resize frames to this width
    
    Returns:
        PersonCapture with collected frames
    """
    session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    frames = [trigger_frame]  # Include the trigger frame
    frame_count = 0
    start_time = time.time()
    
    logger.debug(f"Capturing frames for {duration}s (every {frame_skip} frame)...")
    
    while time.time() - start_time < duration:
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_count += 1
        if frame_count % frame_skip == 0:
            # Apply same cropping as main loop
            frame_cropped = crop_frame(frame, crop_left=0.35, crop_right=0.35,
                                       crop_top=0.10, crop_bottom=0.40)
            frame_resized = resize_frame(frame_cropped, target_width)
            # Store both: cropped (high-res for recognition) and resized (for scoring)
            frames.append((frame_cropped, frame_resized))
    
    logger.debug(f"Captured {len(frames)} frames ({frame_count} total, kept every {frame_skip})")
    
    return PersonCapture(
        session_id=session_id,
        frames=frames,
        start_time=start_time,
        trigger_frame=trigger_frame
    )


# =============================================================================
# QUALITY SCORING & SELECTION
# =============================================================================

def select_best_frame(capture: PersonCapture, skip_start: int = 0, skip_end: int = 0) -> Tuple[np.ndarray, np.ndarray, QualityScore, List[Tuple[int, np.ndarray, np.ndarray, QualityScore]]]:
    """
    Score all frames and select the best one.
    
    Frames are stored as (cropped_hires, resized_lowres) tuples.
    Scoring uses resized_lowres, but returns cropped_hires for recognition.
    
    Args:
        capture: PersonCapture containing frames
        skip_start: Number of frames to skip from start (person entering)
        skip_end: Number of frames to skip from end (person leaving)
    
    Returns:
        (best_frame_hires, best_frame_lowres, best_score, all_scored_frames)
    """
    # Trim frames from start and end
    frames = capture.frames
    total = len(frames)
    if skip_start + skip_end < total:
        frames = frames[skip_start:total - skip_end if skip_end > 0 else total]
        logger.debug(f"Trimmed frames: {total} -> {len(frames)} (skip {skip_start} start, {skip_end} end)")
    
    scored = score_frames_dual(frames)
    
    if not scored:
        # Fallback to trigger frame if no faces detected in any frame
        logger.warning("No faces detected in captured frames, using trigger frame")
        trigger_hires, trigger_lowres = capture.trigger_frame
        score = compute_quality_score(trigger_lowres)
        if score is None:
            # Create a minimal score for the trigger frame
            score = QualityScore(
                total=0.0, face_size=0.0, sharpness=0.0,
                brightness=0.0, contrast=0.0, frontality=0.0,
                yaw=0.0, pitch=0.0, bbox=(0, 0, 0, 0)
            )
        return (trigger_hires, trigger_lowres, score, [])
    
    best_idx, best_frame_hires, best_frame_lowres, best_score = scored[0]
    return (best_frame_hires, best_frame_lowres, best_score, scored)


def compute_fused_embedding(
    scored_frames: List[Tuple[int, np.ndarray, np.ndarray, QualityScore]],
    min_quality_score: float,
    min_detection_score: float,
    top_n: int = 3,
    weight_power: float = 0.3
) -> Tuple[Optional[np.ndarray], List[Tuple[float, float, float]], Optional[np.ndarray], Optional[Tuple]]:
    """
    Compute soft-weighted average embedding from top N frames above quality threshold.
    
    Args:
        scored_frames: List of (idx, frame_hires, frame_lowres, QualityScore), sorted by score
        min_quality_score: Minimum quality score to consider a frame
        min_detection_score: Minimum InsightFace detection confidence
        top_n: Maximum number of frames to fuse
        weight_power: Exponent for soft weighting (0.3 = lenient, 1.0 = linear)
    
    Returns:
        (fused_embedding, fusion_details, best_frame_for_api, best_frame_bbox)
        - fused_embedding: Normalized weighted average, or None if no valid frames
        - fusion_details: List of (quality_score, det_score, weight) for each fused frame
        - best_frame_for_api: The lowres frame from the highest-scoring valid frame
        - best_frame_bbox: The bbox from the same frame (matching coordinates)
    """
    embeddings = []
    weights = []
    det_scores = []
    quality_scores = []
    best_frame_lowres = None
    best_frame_bbox = None
    
    for idx, frame_hires, frame_lowres, score in scored_frames:
        # Quality gate: skip frames below threshold
        if score.total < min_quality_score:
            continue
        
        # Extract embedding from high-res frame
        face_results = extract_embeddings(frame_hires)
        if not face_results:
            continue
        
        emb, bbox, det_score = face_results[0]
        
        # Detection confidence gate
        if det_score < min_detection_score:
            continue
        
        # Valid frame - add to fusion
        embeddings.append(emb)
        det_scores.append(det_score)
        quality_scores.append(score.total)
        
        # Soft weight: score^power dampens quality differences
        weights.append(score.total ** weight_power)
        
        # Keep first valid frame and its bbox for API image
        if best_frame_lowres is None:
            best_frame_lowres = frame_lowres
            best_frame_bbox = score.bbox  # Use bbox from same frame
        
        # Stop after top_n valid frames
        if len(embeddings) >= top_n:
            break
    
    if not embeddings:
        return None, [], None, None
    
    # Normalize weights to sum to 1
    weights = np.array(weights)
    weights = weights / weights.sum()
    
    # Compute weighted average
    fused = np.zeros_like(embeddings[0])
    for emb, w in zip(embeddings, weights):
        fused += emb * w
    
    # Re-normalize to unit vector (important for cosine similarity)
    fused = fused / np.linalg.norm(fused)
    
    # Build fusion details for logging
    fusion_details = list(zip(quality_scores, det_scores, weights.tolist()))
    
    return fused, fusion_details, best_frame_lowres, best_frame_bbox


# =============================================================================
# DEBUG OUTPUT
# =============================================================================

def image_to_base64(image: np.ndarray, max_width: int = 400) -> str:
    """Convert image to base64 string for markdown embedding."""
    h, w = image.shape[:2]
    if w > max_width:
        scale = max_width / w
        new_h = int(h * scale)
        image = cv2.resize(image, (max_width, new_h))
    
    _, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


def draw_face_box(image: np.ndarray, bbox: Tuple[int, int, int, int], score: float) -> np.ndarray:
    """Draw face bounding box and score on image."""
    img = image.copy()
    x1, y1, x2, y2 = bbox
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
    label = f"Score: {score:.3f}"
    cv2.putText(img, label, (x1, y1 - 10), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    return img


def draw_face_box_detailed(image: np.ndarray, bbox: Tuple[int, int, int, int], 
                           score: QualityScore, det_score: float = None) -> np.ndarray:
    """
    Draw detailed face bounding box with landmarks and metrics overlay.
    """
    img = image.copy()
    x1, y1, x2, y2 = bbox
    face_w = x2 - x1
    face_h = y2 - y1
    
    # Color based on quality score
    if score.total >= cfg.MIN_QUALITY_SCORE:
        color = (0, 255, 0)  # Green - pass
    elif score.total >= cfg.MIN_QUALITY_SCORE * 0.7:
        color = (0, 255, 255)  # Yellow - marginal
    else:
        color = (0, 0, 255)  # Red - fail
    
    # Draw bounding box
    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
    
    # Draw face dimensions
    cv2.putText(img, f"{face_w}x{face_h}px", (x1, y2 + 20), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
    
    # Draw quality score above box
    label = f"Q:{score.total:.0f}"
    if det_score is not None:
        label += f" D:{det_score:.2f}"
    cv2.putText(img, label, (x1, y1 - 10), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    
    # Draw yaw/pitch indicator (arrow showing head direction)
    center_x = (x1 + x2) // 2
    center_y = (y1 + y2) // 2
    arrow_len = min(face_w, face_h) // 3
    
    # Yaw affects X, pitch affects Y
    import math
    end_x = int(center_x + arrow_len * math.sin(math.radians(score.yaw)))
    end_y = int(center_y + arrow_len * math.sin(math.radians(score.pitch)))
    cv2.arrowedLine(img, (center_x, center_y), (end_x, end_y), (255, 0, 255), 2)
    
    return img


def generate_debug_report(
    capture: PersonCapture,
    scored_frames: List[Tuple[int, np.ndarray, np.ndarray, QualityScore]],
    best_score: QualityScore,
    visitor_result: str,
    visitor_id: int,
    det_score: float = None,
    api_sent: bool = False
) -> None:
    """
    Generate debug.md report with top frames and scores.
    
    Args:
        capture: PersonCapture with frames
        scored_frames: List of (frame_idx, frame_hires, frame_lowres, QualityScore)
        best_score: QualityScore of best frame
        visitor_result: Result string (NEW, RETURNING, LOW_QUALITY, etc.)
        visitor_id: Visitor ID if identified
        det_score: InsightFace detection confidence (if available)
        api_sent: Whether this frame was sent to the API
    """
    if not cfg.DEBUG_MODE or not cfg.DEBUG_GENERATE_REPORT:
        return
    
    os.makedirs(cfg.DEBUG_OUTPUT_DIR, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Determine if this passed all quality gates
    passed_quality = best_score.total >= cfg.MIN_QUALITY_SCORE
    passed_detection = det_score is None or det_score >= cfg.MIN_DETECTION_SCORE
    
    # Status badge
    if api_sent:
        status_badge = "🟢 **SENT TO API**"
    elif not passed_quality:
        status_badge = "🔴 **REJECTED: Low Quality Score**"
    elif not passed_detection:
        status_badge = "🔴 **REJECTED: Low Detection Confidence**"
    else:
        status_badge = "⚪ **NOT SENT**"
    
    # Get face dimensions from bbox
    x1, y1, x2, y2 = best_score.bbox
    face_width = x2 - x1
    face_height = y2 - y1
    
    md = f"""# Frame Quality Debug Report

{status_badge}

**Generated**: {timestamp}  
**Session ID**: {capture.session_id}  
**Result**: {visitor_result} (Visitor #{visitor_id})

---

## Decision Summary

| Gate | Value | Threshold | Status |
|------|-------|-----------|--------|
| Quality Score | **{best_score.total:.0f}** | ≥ {cfg.MIN_QUALITY_SCORE:.0f} | {'✅ PASS' if passed_quality else '❌ FAIL'} |
| Detection Confidence | **{f'{det_score:.3f}' if det_score is not None else 'N/A'}** | ≥ {cfg.MIN_DETECTION_SCORE:.2f} | {'✅ PASS' if passed_detection else '❌ FAIL'} |

---

## Frame Statistics

| Metric | Value |
|--------|-------|
| Total Frames Captured | {len(capture.frames)} |
| Frames with Faces | {len(scored_frames)} |
| Face Bounding Box | ({x1}, {y1}) to ({x2}, {y2}) |
| Face Dimensions | {face_width} x {face_height} px |

---

## Quality Score Breakdown

**Total Score: {best_score.total:.0f}/1000** (Threshold: {cfg.MIN_QUALITY_SCORE:.0f})

| Metric | Raw Value | Score (0-1) | Importance | Contribution |
|--------|-----------|-------------|------------|-------------|
| **Frontality** | Yaw: {best_score.yaw:.1f}°, Pitch: {best_score.pitch:.1f}° | {best_score.frontality:.3f} | {cfg.QUALITY_IMPORTANCE.get('frontality', 8)} | {(best_score.frontality ** (cfg.QUALITY_IMPORTANCE.get('frontality', 8) / 5.0)):.3f} |
| **Face Size** | {face_width}px width | {best_score.face_size:.3f} | {cfg.QUALITY_IMPORTANCE.get('face_size', 5)} | {(best_score.face_size ** (cfg.QUALITY_IMPORTANCE.get('face_size', 5) / 5.0)):.3f} |
| **Sharpness** | Laplacian var | {best_score.sharpness:.3f} | {cfg.QUALITY_IMPORTANCE.get('sharpness', 0)} | {(best_score.sharpness ** (cfg.QUALITY_IMPORTANCE.get('sharpness', 0) / 5.0)) if cfg.QUALITY_IMPORTANCE.get('sharpness', 0) > 0 else 1.0:.3f} |
| **Brightness** | Face ROI mean | {best_score.brightness:.3f} | {cfg.QUALITY_IMPORTANCE.get('brightness', 0)} | {(best_score.brightness ** (cfg.QUALITY_IMPORTANCE.get('brightness', 0) / 5.0)) if cfg.QUALITY_IMPORTANCE.get('brightness', 0) > 0 else 1.0:.3f} |
| **Contrast** | Face ROI std | {best_score.contrast:.3f} | {cfg.QUALITY_IMPORTANCE.get('contrast', 0)} | {(best_score.contrast ** (cfg.QUALITY_IMPORTANCE.get('contrast', 0) / 5.0)) if cfg.QUALITY_IMPORTANCE.get('contrast', 0) > 0 else 1.0:.3f} |

*Formula: total = 1000 × Π(score^(importance/5)) for each metric with importance > 0*

---

## Threshold Configuration (from config.py)

```
Face Size:
  zero_px: {cfg.QUALITY_THRESHOLDS.get('face_size', {}).get('zero_px', 60)} (below = score 0)
  critical_px: {cfg.QUALITY_THRESHOLDS.get('face_size', {}).get('critical_px', 105)}
  good_px: {cfg.QUALITY_THRESHOLDS.get('face_size', {}).get('good_px', 105)} (above = score 1.0)

Frontality:
  good_yaw: ±{cfg.QUALITY_THRESHOLDS.get('frontality', {}).get('good_yaw', 15)}° (within = score 1.0)
  critical_yaw: ±{cfg.QUALITY_THRESHOLDS.get('frontality', {}).get('critical_yaw', 35)}°
  good_pitch: ±{cfg.QUALITY_THRESHOLDS.get('frontality', {}).get('good_pitch', 10)}°
  critical_pitch: ±{cfg.QUALITY_THRESHOLDS.get('frontality', {}).get('critical_pitch', 30)}°
```

---

## Best Frame (Sent to API)

"""
    
    # Add best frame with detailed visualization
    # scored_frames format: (idx, hires, lowres, score) - use lowres for display
    if scored_frames:
        best_frame_lowres = scored_frames[0][2]
        annotated = draw_face_box_detailed(best_frame_lowres, best_score.bbox, best_score, det_score)
        b64_img = image_to_base64(annotated, max_width=600)
        md += f"![Best Frame]({b64_img})\n\n"
    
    
    # Save report
    report_path = os.path.join(cfg.DEBUG_OUTPUT_DIR, f"debug_{capture.session_id}.md")
    with open(report_path, 'w') as f:
        f.write(md)
    
    logger.debug(f"Debug report saved: {report_path}")
    
    # Also save best frame as image
    if cfg.DEBUG_SAVE_TOP_FRAMES and scored_frames:
        best_frame_lowres = scored_frames[0][2]
        best_annotated = draw_face_box_detailed(best_frame_lowres, best_score.bbox, best_score, det_score)
        best_path = os.path.join(cfg.DEBUG_OUTPUT_DIR, f"best_{capture.session_id}.jpg")
        cv2.imwrite(best_path, best_annotated)
        logger.debug(f"Best frame saved: {best_path}")

# =============================================================================
# MAIN LOOP
# =============================================================================

def run_visitor_counter(
    camera_config: Optional[CameraConfig] = None,
    api_base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    location_id: Optional[int] = None,
    debug_mode: bool = False
) -> None:
    """
    Main visitor counting loop with frame quality scoring.
    
    Args:
        camera_config: Camera configuration from cameras.yaml. If None, uses legacy config.py.
        api_base_url: API base URL. If None, uses camera_config or config.py.
        api_key: API key. If None, uses camera_config or config.py.
        location_id: Location ID. If None, uses camera_config or config.py.
        debug_mode: Enable debug output.
    
    Flow:
    1. Fast face detection (YuNet)
    2. On detection: capture frames for quality scoring
    3. Score frames and select best quality
    4. Extract embedding from best frame (InsightFace)
    5. Send to server for identification
    """
    
    # Override debug mode from config if passed as argument
    if debug_mode:
        cfg.DEBUG_MODE = True
    
    # ==========================================================================
    # CONFIGURATION: Use camera_config if provided, else fall back to config.py
    # ==========================================================================
    if camera_config is not None:
        # New: Use camera_config from cameras.yaml
        settings = camera_config.get_face_recognition_settings()
        camera_source = camera_config.rtsp_url
        camera_name = camera_config.name
        camera_id = camera_config.id
        
        # Settings from camera config
        target_width = settings.target_width
        process_every_n = settings.process_every_n_frames
        capture_duration = settings.quality_capture_duration
        frame_skip = settings.quality_frame_skip
        similarity_threshold = settings.similarity_threshold
        cooldown_seconds = settings.cooldown_seconds
        min_quality_score = settings.min_quality_score
        min_detection_score = settings.min_detection_score
    else:
        # Legacy: Use config.py
        camera_source = cfg.RTSP_URL
        camera_name = "Default Camera"
        camera_id = "default"
        
        target_width = cfg.TARGET_WIDTH
        process_every_n = cfg.PROCESS_EVERY_N_FRAMES
        capture_duration = cfg.QUALITY_CAPTURE_DURATION_SEC
        frame_skip = cfg.QUALITY_FRAME_SKIP
        similarity_threshold = cfg.SIMILARITY_THRESHOLD
        cooldown_seconds = cfg.COOLDOWN_SECONDS
        min_quality_score = cfg.MIN_QUALITY_SCORE
        min_detection_score = cfg.MIN_DETECTION_SCORE
    
    # API configuration (priority: function args > camera_config > config.py)
    if api_base_url is None:
        api_base_url = cfg.API_BASE_URL
    if api_key is None:
        api_key = cfg.API_KEY
    if location_id is None:
        location_id = cfg.API_LOCATION_ID
    
    # Display camera source (hide credentials)
    camera_display = str(camera_source) if isinstance(camera_source, int) else camera_source.split('@')[-1]
    
    logger.info("=" * 70)
    logger.info(f"FACE RECOGNITION WORKER: {camera_name} ({camera_id})")
    logger.info("=" * 70)
    logger.info(f"Camera: {camera_display}")
    logger.info(f"Location ID: {location_id}")
    logger.info(f"Similarity threshold: {similarity_threshold}")
    logger.info(f"Cooldown: {cooldown_seconds}s")
    logger.info(f"Quality capture: {capture_duration}s, every {frame_skip} frame")
    logger.info(f"Quality gates: score >= {min_quality_score}, det >= {min_detection_score}")
    logger.info(f"Debug mode: {cfg.DEBUG_MODE}")
    logger.info("Press Ctrl+C to stop")
    logger.info("=" * 70)
    
    # Load face recognition model (downloads on first run)
    logger.info("Loading face recognition model...")
    get_face_analyzer()
    
    # Initialize API client (required for server-side matching)
    logger.info(f"Connecting to API: {api_base_url}")
    api = init_api(
        base_url=api_base_url,
        api_key=api_key,
        location_id=location_id
    )
    if api.health_check():
        logger.info("✓ API connection successful")
    else:
        logger.error("✗ API not reachable - cannot continue without server")
        return
    
    # Connect to camera
    logger.info("Connecting to camera...")
    # Use TCP transport for more stable RTSP connection
    if isinstance(camera_source, str) and camera_source.startswith("rtsp://"):
        # Set RTSP transport to TCP (more reliable than UDP)
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    elif isinstance(camera_source, str) and camera_source.isdigit():
        # Convert webcam index string to integer
        camera_source = int(camera_source)
    cap = cv2.VideoCapture(camera_source)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not cap.isOpened():
        logger.error(f"Cannot connect to camera: {camera_display}")
        return
    
    ret, frame = cap.read()
    if not ret:
        logger.error("Cannot read from camera")
        return
    
    # Show resolution info with cropping
    frame_cropped = crop_frame(frame, crop_left=0.35, crop_right=0.35,
                               crop_top=0.10, crop_bottom=0.40)
    frame_resized = resize_frame(frame_cropped, target_width)
    h, w = frame_resized.shape[:2]
    logger.info(f"Original resolution: {frame.shape[1]}x{frame.shape[0]}")
    logger.info(f"After crop (35%L/R, 10%T/40%B): {frame_cropped.shape[1]}x{frame_cropped.shape[0]}")
    logger.info(f"Processing resolution: {w}x{h}")
    
    logger.info("\nVisitor counting started. Waiting for faces...")
    
    frame_count = 0
    last_capture_time = 0
    
    # Timing stats
    timing_stats = {'detection': [], 'capture': [], 'scoring': [], 'recognition': [], 'total': []}
    stats_window = 100
    
    # Session stats
    session_stats = {
        'new_visitors': 0,
        'returning_visitors': 0,
        'total_detections': 0,
        'frames_captured': 0,
        'frames_scored': 0,
        'camera_id': camera_id
    }
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                logger.warning("Lost connection. Reconnecting...")
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(camera_source)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue
            
            frame_count += 1
            
            # Skip frames for performance
            if frame_count % process_every_n != 0:
                continue
            
            # Check cooldown BEFORE processing
            current_time = time.time()
            if current_time - last_capture_time < cooldown_seconds:
                continue
            
            # Crop edges then resize for processing
            # Crop: 35% left, 35% right, 10% top, 40% bottom
            # This focuses on center region and makes faces larger relative to frame
            frame_cropped = crop_frame(frame, crop_left=0.35, crop_right=0.35, 
                                       crop_top=0.10, crop_bottom=0.40)
            frame_resized = resize_frame(frame_cropped, target_width)
            
            # =================================================================
            # PHASE 1: Fast face detection (YuNet) with confidence filter
            # =================================================================
            t0 = time.perf_counter()
            detection_result = detect_face(frame_resized, min_confidence=cfg.MIN_DET_CONF)
            detection_time = (time.perf_counter() - t0) * 1000
            timing_stats['detection'].append(detection_time)
            
            if detection_result is None:
                continue  # No face detected above confidence threshold
            
            face_bbox, det_conf = detection_result
            logger.info(f"Face detected (conf={det_conf:.2f})! Starting capture...")
            session_stats['total_detections'] += 1
            
            # =================================================================
            # PHASE 2: Capture frames for quality scoring
            # =================================================================
            t0 = time.perf_counter()
            capture = capture_frames_for_person(
                cap=cap,
                trigger_frame=(frame_cropped, frame_resized),  # (hires, lowres)
                duration=capture_duration,
                frame_skip=frame_skip,
                target_width=target_width
            )
            capture_time = (time.perf_counter() - t0) * 1000
            timing_stats['capture'].append(capture_time)
            session_stats['frames_captured'] += len(capture.frames)
            
            # =================================================================
            # PHASE 3: Score frames and select best
            # =================================================================
            t0 = time.perf_counter()
            best_frame_hires, best_frame_lowres, best_score, scored_frames = select_best_frame(
                capture,
                skip_start=cfg.FRAMES_SKIP_START,
                skip_end=cfg.FRAMES_SKIP_END
            )
            scoring_time = (time.perf_counter() - t0) * 1000
            timing_stats['scoring'].append(scoring_time)
            session_stats['frames_scored'] += len(scored_frames)
            
            logger.info(f"Best frame score: {best_score.total:.0f}/1000 "
                        f"(sharp={best_score.sharpness:.2f}, frontal={best_score.frontality:.2f}, "
                        f"size={best_score.face_size:.2f}, yaw={best_score.yaw:.1f}°)")
            
            # =================================================================
            # QUALITY GATE: Check if best frame meets minimum quality
            # =================================================================
            if best_score.total < min_quality_score:
                logger.warning(f"Best quality score {best_score.total:.0f} below threshold "
                              f"{min_quality_score:.0f} - skipping recognition")
                
                if debug_mode and scored_frames:
                    generate_debug_report(
                        capture=capture,
                        scored_frames=scored_frames,
                        best_score=best_score,
                        visitor_result="LOW_QUALITY",
                        visitor_id=0,
                        det_score=None,
                        api_sent=False
                    )
                
                last_capture_time = time.time()
                continue
            
            # =================================================================
            # PHASE 4: Multi-frame embedding fusion
            # =================================================================
            # Extract embeddings from top N frames (above quality threshold)
            # and compute soft-weighted average for more robust recognition
            t0 = time.perf_counter()
            fused_embedding, fusion_details, api_frame, api_bbox = compute_fused_embedding(
                scored_frames=scored_frames,
                min_quality_score=min_quality_score,
                min_detection_score=min_detection_score,
                top_n=cfg.EMBEDDING_FUSION_TOP_N,
                weight_power=cfg.EMBEDDING_FUSION_WEIGHT_POWER
            )
            recognition_time = (time.perf_counter() - t0) * 1000
            timing_stats['recognition'].append(recognition_time)
            
            if fused_embedding is None:
                logger.warning("No valid frames for embedding fusion (all failed quality/detection gates)")
                
                if debug_mode and scored_frames:
                    generate_debug_report(
                        capture=capture,
                        scored_frames=scored_frames,
                        best_score=best_score,
                        visitor_result="NO_VALID_FRAMES",
                        visitor_id=0,
                        det_score=None,
                        api_sent=False
                    )
                
                last_capture_time = time.time()
                continue
            
            # Log fusion details
            n_fused = len(fusion_details)
            weights_str = ", ".join([f"{w:.2f}" for _, _, w in fusion_details])
            scores_str = ", ".join([f"{s:.0f}" for s, _, _ in fusion_details])
            det_scores_str = ", ".join([f"{d:.2f}" for _, d, _ in fusion_details])
            logger.info(f"Fused {n_fused} embeddings: scores=[{scores_str}], "
                       f"det=[{det_scores_str}], weights=[{weights_str}]")
            
            # Use average det_score for logging/debug
            avg_det_score = sum(d for _, d, _ in fusion_details) / n_fused
            
            # =================================================================
            # PHASE 5: Send to server for identification
            # =================================================================
            # Server performs matching and decides new vs returning
            # Use lowres frame for the image upload (smaller file size)
            logger.debug(f"Average detection confidence: {avg_det_score:.3f}")
            api_response = api.identify(fused_embedding, api_frame, api_bbox)
            
            if api_response.success:
                visitor_id = api_response.customer_id
                
                if api_response.status == "returning":
                    visitor_result = "RETURNING"
                    logger.info(f"  → RETURNING visitor #{visitor_id} "
                               f"(similarity: {api_response.similarity:.3f}, "
                               f"visit #{api_response.visit_count})")
                    session_stats['returning_visitors'] += 1
                else:
                    visitor_result = "NEW"
                    logger.info(f"  → NEW visitor #{visitor_id} enrolled")
                    session_stats['new_visitors'] += 1
            else:
                visitor_result = "ERROR"
                visitor_id = 0
                logger.error(f"  → API error: {api_response.message}")
            
            # =================================================================
            # DEBUG: Generate report if enabled
            # =================================================================
            generate_debug_report(
                capture=capture,
                scored_frames=scored_frames,
                best_score=best_score,
                visitor_result=visitor_result,
                visitor_id=visitor_id,
                det_score=avg_det_score,
                api_sent=True
            )
            
            # Update cooldown
            last_capture_time = time.time()
            
            # Calculate total time for this detection
            total_time = detection_time + capture_time + scoring_time + recognition_time
            timing_stats['total'].append(total_time)
            
            # Trim timing stats
            for key in timing_stats:
                if len(timing_stats[key]) > stats_window:
                    timing_stats[key] = timing_stats[key][-stats_window:]
            
            # Log current stats
            logger.debug(f"  Timing: detect={detection_time:.0f}ms, capture={capture_time:.0f}ms, "
                        f"score={scoring_time:.0f}ms, recog={recognition_time:.0f}ms")
                
    except KeyboardInterrupt:
        logger.info("\nStopping visitor counter...")
    finally:
        cap.release()
        
        # Final summary
        logger.info("\n" + "=" * 70)
        logger.info("SESSION SUMMARY")
        logger.info("=" * 70)
        logger.info(f"Total face detections: {session_stats['total_detections']}")
        logger.info(f"New visitors enrolled: {session_stats['new_visitors']}")
        logger.info(f"Returning visitors:    {session_stats['returning_visitors']}")
        logger.info(f"Frames captured:       {session_stats['frames_captured']}")
        logger.info(f"Frames scored:         {session_stats['frames_scored']}")
        
        total_visitors = session_stats['new_visitors'] + session_stats['returning_visitors']
        logger.info(f"\nTotal visitors this session: {total_visitors}")
        
        if timing_stats['total']:
            logger.info("\nTIMING (averages):")
            for key in ['detection', 'capture', 'scoring', 'recognition', 'total']:
                if timing_stats[key]:
                    avg = sum(timing_stats[key]) / len(timing_stats[key])
                    logger.info(f"  {key.capitalize():12}: {avg:.1f} ms")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Face Recognition Worker")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode (save reports and images)")
    parser.add_argument("--camera", type=str, help="Camera ID from cameras.yaml")
    parser.add_argument("--config", type=str, help="Path to cameras.yaml config file")
    parser.add_argument("--webcam", action="store_true", help="Use Mac webcam (camera index 0) for development")
    args = parser.parse_args()
    
    if args.debug:
        cfg.DEBUG_MODE = True
        logger.info(f"Debug mode enabled: saving to {cfg.DEBUG_OUTPUT_DIR}")
    
    # Webcam mode - use Mac's built-in camera with default settings
    if args.webcam:
        logger.info("Using webcam mode (Mac camera index 0)")
        
        # Load config just for API settings
        try:
            config = load_config(args.config)
            api_base_url = config.api.base_url
            api_key = config.api.key
            location_id = config.location.id
        except FileNotFoundError:
            # Use defaults from config.py if no cameras.yaml
            api_base_url = cfg.API_BASE_URL
            api_key = cfg.API_KEY
            location_id = cfg.API_LOCATION_ID
            logger.info("No cameras.yaml found, using config.py defaults")
        
        # Create a minimal camera config for webcam (settings from config.py)
        webcam_settings = {
            'target_width': cfg.TARGET_WIDTH,
            'process_every_n_frames': cfg.PROCESS_EVERY_N_FRAMES,
            'quality_capture_duration': cfg.QUALITY_CAPTURE_DURATION_SEC,
            'quality_frame_skip': cfg.QUALITY_FRAME_SKIP,
            'similarity_threshold': cfg.SIMILARITY_THRESHOLD,
            'cooldown_seconds': cfg.COOLDOWN_SECONDS,
            'min_quality_score': cfg.MIN_QUALITY_SCORE,
            'min_detection_score': cfg.MIN_DETECTION_SCORE
        }
        webcam_config = CameraConfig(
            id="webcam",
            name="Mac Webcam",
            rtsp_url="0",  # Camera index 0
            use_case="face_recognition",
            enabled=True,
            settings=webcam_settings
        )
        
        run_visitor_counter(
            camera_config=webcam_config,
            api_base_url=api_base_url,
            api_key=api_key,
            location_id=location_id,
            debug_mode=args.debug
        )
        sys.exit(0)
    
    # Load configuration from cameras.yaml
    try:
        config = load_config(args.config)
        
        # Find the camera to use
        if args.camera:
            camera = config.get_camera_by_id(args.camera)
            if camera is None:
                logger.error(f"Camera '{args.camera}' not found in config")
                sys.exit(1)
            if camera.use_case != "face_recognition":
                logger.error(f"Camera '{args.camera}' is not configured for face_recognition")
                sys.exit(1)
        else:
            # Use first enabled face_recognition camera
            cameras = config.get_cameras_by_use_case("face_recognition")
            if not cameras:
                logger.error("No face_recognition cameras configured in cameras.yaml")
                sys.exit(1)
            camera = cameras[0]
            logger.info(f"Using camera: {camera.name}")
        
        run_visitor_counter(
            camera_config=camera,
            api_base_url=config.api.base_url,
            api_key=config.api.key,
            location_id=config.location.id,
            debug_mode=args.debug
        )
    except FileNotFoundError as e:
        logger.error(f"Config file not found: {e}")
        sys.exit(1)


