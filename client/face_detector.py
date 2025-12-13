#!/usr/bin/env python3
"""
Face Detection with Frame Capture
Detects faces in RTSP stream and saves 5 frames when a person appears.
Uses OpenCV's YuNet face detector (fast, built-in).
"""

import cv2
import time
import os
import logging
from datetime import datetime

# =============================================================================
# LOGGING SETUP
# =============================================================================

# Set to logging.DEBUG for development, logging.INFO for production
LOG_LEVEL = logging.DEBUG

logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

RTSP_URL = "rtsp://admin:SmoothFlow@10.0.0.227:554/h264Preview_01_main"

# Processing settings
TARGET_WIDTH = 1280  # Resize to this width for processing (keeps aspect ratio)
PROCESS_EVERY_N_FRAMES = 5  # Process every Nth frame (~3 FPS from 15 FPS stream)

# Face detection settings
DETECTION_CONFIDENCE = 0.7  # Minimum confidence to consider a detection valid

# Capture settings
FRAMES_TO_CAPTURE = 5  # Number of frames to save when face detected
CAPTURE_INTERVAL_MS = 300  # Interval between captured frames (milliseconds)
OUTPUT_DIR = "/home/mafiq/zmisc/captures"

# Cooldown to avoid capturing same person multiple times
COOLDOWN_SECONDS = 5  # Wait this long before capturing another set

# =============================================================================
# FACE DETECTOR SETUP
# =============================================================================

def get_yunet_detector(input_size=(640, 480)):
    """Initialize YuNet face detector."""
    # YuNet model path - download if not exists
    model_path = "/home/mafiq/zmisc/models/face_detection_yunet_2023mar.onnx"
    
    if not os.path.exists(model_path):
        logger.info("Downloading YuNet model...")
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        import urllib.request
        url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        urllib.request.urlretrieve(url, model_path)
        logger.info(f"Model saved to {model_path}")
    
    detector = cv2.FaceDetectorYN.create(
        model_path,
        "",
        input_size,
        score_threshold=DETECTION_CONFIDENCE,
        nms_threshold=0.3,
        top_k=5000
    )
    return detector

# =============================================================================
# MAIN DETECTION LOOP
# =============================================================================

def create_output_dir():
    """Create output directory if it doesn't exist."""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        logger.info(f"Created output directory: {OUTPUT_DIR}")

def resize_frame(frame, target_width):
    """Resize frame maintaining aspect ratio."""
    h, w = frame.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    return cv2.resize(frame, (target_width, new_h))

def save_frame(frame, session_id, frame_num):
    """Save a single frame to disk."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    filename = f"{OUTPUT_DIR}/session_{session_id}_frame_{frame_num}_{timestamp}.jpg"
    
    # Resize before saving
    frame_resized = resize_frame(frame, TARGET_WIDTH)
    cv2.imwrite(filename, frame_resized)
    logger.debug(f"Saved: {filename}")
    return filename

def capture_additional_frames(cap, num_frames, interval_ms, session_id, start_frame_num):
    """Capture additional frames from stream at specified interval."""
    captured = []
    for i in range(num_frames):
        ret, frame = cap.read()
        if ret:
            filename = save_frame(frame, session_id, start_frame_num + i)
            captured.append(filename)
        
        if i < num_frames - 1:
            time.sleep(interval_ms / 1000.0)
    
    return captured

def run_detection():
    """Main detection loop."""
    create_output_dir()
    
    logger.info("=" * 60)
    logger.info("Face Detector - Frame Capture")
    logger.info("=" * 60)
    logger.info(f"RTSP: {RTSP_URL.split('@')[1]}")
    logger.info(f"Target resolution: {TARGET_WIDTH}p width")
    logger.info(f"Processing every {PROCESS_EVERY_N_FRAMES} frames")
    logger.info(f"Capture: {FRAMES_TO_CAPTURE} frames @ {CAPTURE_INTERVAL_MS}ms interval")
    logger.info(f"Output: {OUTPUT_DIR}")
    logger.info("Press Ctrl+C to stop")
    logger.info("=" * 60)
    
    # Connect to camera
    logger.info("Connecting to camera...")
    cap = cv2.VideoCapture(RTSP_URL)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not cap.isOpened():
        logger.error("Cannot connect to camera")
        return
    
    ret, frame = cap.read()
    if not ret:
        logger.error("Cannot read from camera")
        return
    
    # Get frame dimensions after resize
    frame_resized = resize_frame(frame, TARGET_WIDTH)
    h, w = frame_resized.shape[:2]
    logger.info(f"Original resolution: {frame.shape[1]}x{frame.shape[0]}")
    logger.info(f"Processing resolution: {w}x{h}")
    
    # Initialize detector with correct input size
    detector = get_yunet_detector(input_size=(w, h))
    
    logger.info("Detection started. Waiting for faces...")
    
    frame_count = 0
    session_count = 0
    last_capture_time = 0
    
    # Timing stats
    timing_stats = {
        'frame_read': [],
        'resize': [],
        'detection': [],
        'total_loop': []
    }
    stats_window = 100  # Calculate averages over last N processed frames
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                logger.warning("Lost connection. Reconnecting...")
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(RTSP_URL)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue
            
            frame_count += 1
            
            # Skip frames for performance
            if frame_count % PROCESS_EVERY_N_FRAMES != 0:
                continue
            
            # Check cooldown BEFORE detection (skip expensive detection if in cooldown)
            current_time = time.time()
            if current_time - last_capture_time < COOLDOWN_SECONDS:
                continue
            
            loop_start = time.perf_counter()
            
            # Resize for processing
            t0 = time.perf_counter()
            frame_resized = resize_frame(frame, TARGET_WIDTH)
            resize_time = (time.perf_counter() - t0) * 1000
            
            # Detect faces
            t0 = time.perf_counter()
            _, faces = detector.detect(frame_resized)
            detection_time = (time.perf_counter() - t0) * 1000
            
            total_loop_time = (time.perf_counter() - loop_start) * 1000
            
            # Store timing stats
            timing_stats['resize'].append(resize_time)
            timing_stats['detection'].append(detection_time)
            timing_stats['total_loop'].append(total_loop_time)
            
            # Keep only last N samples
            for key in timing_stats:
                if len(timing_stats[key]) > stats_window:
                    timing_stats[key] = timing_stats[key][-stats_window:]
            
            if faces is not None and len(faces) > 0:
                
                num_faces = len(faces)
                logger.info(f"Detected {num_faces} face(s)!")
                
                # Start capture session
                session_count += 1
                session_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{session_count:04d}"
                
                logger.info(f"Starting capture session: {session_id}")
                
                # IMPORTANT: Save the detection frame FIRST (guaranteed to have face)
                captured = []
                detection_frame_file = save_frame(frame, session_id, 1)
                captured.append(detection_frame_file)
                logger.debug(f"Saved detection frame (guaranteed face)")
                
                # Capture additional frames from stream
                if FRAMES_TO_CAPTURE > 1:
                    time.sleep(CAPTURE_INTERVAL_MS / 1000.0)
                    additional = capture_additional_frames(
                        cap, FRAMES_TO_CAPTURE - 1, CAPTURE_INTERVAL_MS, session_id, 2
                    )
                    captured.extend(additional)
                
                logger.info(f"Captured {len(captured)} frames")
                
                last_capture_time = time.time()
                logger.debug(f"Cooldown: {COOLDOWN_SECONDS}s before next capture")
            
            # Progress indicator with timing stats every 100 processed frames
            if (frame_count // PROCESS_EVERY_N_FRAMES) % 100 == 0:
                avg_resize = sum(timing_stats['resize']) / len(timing_stats['resize']) if timing_stats['resize'] else 0
                avg_detect = sum(timing_stats['detection']) / len(timing_stats['detection']) if timing_stats['detection'] else 0
                avg_total = sum(timing_stats['total_loop']) / len(timing_stats['total_loop']) if timing_stats['total_loop'] else 0
                effective_fps = 1000 / avg_total if avg_total > 0 else 0
                
                logger.debug(f"[STATS] Frames: {frame_count} | Sessions: {session_count}")
                logger.debug(f"  Resize:    {avg_resize:6.2f} ms avg")
                logger.debug(f"  Detection: {avg_detect:6.2f} ms avg")
                logger.debug(f"  Total:     {avg_total:6.2f} ms avg -> {effective_fps:.1f} effective FPS (processing only)")
                
    except KeyboardInterrupt:
        logger.info("Stopping detection...")
    finally:
        cap.release()
        
        # Final timing summary
        logger.info("=" * 60)
        logger.info("FINAL TIMING SUMMARY")
        logger.info("=" * 60)
        if timing_stats['detection']:
            logger.info(f"Resize:      {sum(timing_stats['resize'])/len(timing_stats['resize']):6.2f} ms avg")
            logger.info(f"Detection:   {sum(timing_stats['detection'])/len(timing_stats['detection']):6.2f} ms avg")
            logger.info(f"Total loop:  {sum(timing_stats['total_loop'])/len(timing_stats['total_loop']):6.2f} ms avg")
            avg_total = sum(timing_stats['total_loop'])/len(timing_stats['total_loop'])
            logger.info(f"Effective processing FPS: {1000/avg_total:.1f}")
        logger.info(f"Total capture sessions: {session_count}")
        logger.info(f"Frames saved to: {OUTPUT_DIR}")

if __name__ == "__main__":
    run_detection()
