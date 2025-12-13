#!/usr/bin/env python3
"""
Configuration file for Visitor Counter System.
All hyperparameters and settings in one place.
"""


RTSP_URL: str = "rtsp://admin:SmoothFlow@10.0.0.227:554/h264Preview_01_main"

# Use 0 for Mac webcam during development
# RTSP_URL: int = 0

# =============================================================================
# PROCESSING SETTINGS
# =============================================================================

TARGET_WIDTH: int = 1280  # Resize frames to this width (maintains aspect ratio)
PROCESS_EVERY_N_FRAMES: int = 5  # Skip frames for performance (~3 FPS from 15 FPS)

# =============================================================================
# FRAME QUALITY CAPTURE SETTINGS
# =============================================================================

QUALITY_CAPTURE_DURATION_SEC: float = 5.0  # How long to capture after face detected
QUALITY_FRAME_SKIP: int = 3  # Keep every Nth frame during capture
QUALITY_TOP_N_FRAMES: int = 5  # Number of top frames to show in debug output

# Quality scoring - Multiplicative penalty system
# Each factor independently impacts the score via: score × factor^(importance/5)
# Importance scale: 0 = ignored, 5 = linear penalty, 10 = quadratic penalty
QUALITY_IMPORTANCE: dict = {
    'frontality': 8,    # Critical - angled faces match poorly
    'sharpness': 0,     # Disabled - sharpness scoring removed
    'face_size': 5,     # Important - small faces are unreliable
    'brightness': 0,    # Disabled - not used in scoring
    'contrast': 0,      # Disabled - not used in scoring
}

QUALITY_BASE_SCORE: float = 1000.0  # Starting score before penalties

# =============================================================================
# QUALITY SCORING THRESHOLDS
# =============================================================================
# Each attribute has a CRITICAL threshold. Below this, the score drops aggressively
# (quadratic/exponential decay) instead of linearly.
# 
# Structure: { 'critical': value, 'good': value }
# - Below 'critical': aggressive penalty (score drops rapidly)
# - Between 'critical' and 'good': linear interpolation
# - Above 'good': perfect score (1.0)

# Face size thresholds (in pixels - absolute, not ratio)
# Critical: faces smaller than this are nearly unusable for recognition
# Good: faces this size or larger get perfect score
QUALITY_THRESHOLDS: dict = {
    'face_size': {
        'zero_px': 60,          # Below 60px = score becomes 0 (unusable)
        'critical_px': 100,     # Below 105px = aggressive penalty
        'good_px': 115,         # Above 105px = perfect score (1.0)
    },
    'sharpness': {
        'critical': 50,         # Laplacian variance below 50 = very blurry
        'good': 300,            # Above 300 = sharp enough
    },
    'brightness': {
        'critical_low': 30,     # Below 30 = too dark
        'good_low': 80,         # 80-180 = optimal range
        'good_high': 180,
        'critical_high': 230,   # Above 230 = too bright
    },
    'contrast': {
        'critical': 15,         # Std dev below 15 = very low contrast
        'good': 50,             # Above 50 = good contrast
    },
    'frontality': {
        'critical_yaw': 10,     # Beyond ±35° yaw = aggressive penalty
        'good_yaw': 3,         # Within ±15° = good
        'critical_pitch': 8,   # Beyond ±30° pitch = aggressive penalty
        'good_pitch': 2,       # Within ±10° = good
    },
}

# Legacy face size parameters (kept for backward compatibility)
FACE_SIZE_MIN_RATIO: float = 0.02   # Below this = very small face (score ~0.4)
FACE_SIZE_GOOD_RATIO: float = 0.08  # Above this = perfect score (1.0)
FACE_SIZE_MIN_SCORE: float = 0.4    # Base score for faces at MIN_RATIO

# =============================================================================
# RECOGNITION SETTINGS
# =============================================================================

SIMILARITY_THRESHOLD: float = 0.50  # Cosine similarity threshold for matching
                                     # Lower = more matches (risk: merge different people)
                                     # Higher = fewer matches (risk: same person counted twice)

COOLDOWN_SECONDS: int = 30  # Wait time before processing next person

# =============================================================================
# QUALITY GATE THRESHOLDS (False Positive Prevention)
# =============================================================================

# Minimum quality score to proceed with recognition (out of 1000)
# Frames below this are skipped entirely (saves API calls)
MIN_QUALITY_SCORE: float = 500  # 50% of base score

# Minimum InsightFace detection confidence to send to API
# Lower confidence = less reliable embedding = potential false match
MIN_DETECTION_SCORE: float = 0.80

# =============================================================================
# MODEL SETTINGS
# =============================================================================

INSIGHTFACE_MODEL: str = "buffalo_s"  # "buffalo_s" (fast) or "buffalo_l" (accurate)

# Model cache directory (platform-specific)
import os
_HOME = os.path.expanduser("~")
if os.path.exists("/home/mafiq"):
    # Jetson
    MODEL_DIR: str = "/home/mafiq/zmisc/models/insightface"
else:
    # Mac / Development
    MODEL_DIR: str = os.path.join(_HOME, ".insightface/models")



API_BASE_URL: str = "https://dashboard.smoothflow.ai"  # Production URL
API_KEY: str = "dev-edge-api-key"  # API key for authentication (must match EDGE_API_KEY on Vercel)
API_LOCATION_ID: int = 1  # Store location ID

# =============================================================================
# DEBUG SETTINGS
# =============================================================================

DEBUG_MODE: bool = False  # Enable debug output
DEBUG_OUTPUT_DIR: str = "debug_output"  # Directory for debug files
DEBUG_SAVE_ALL_FRAMES: bool = False  # Save all captured frames (disk intensive)
DEBUG_SAVE_TOP_FRAMES: bool = True  # Save top N frames with scores
DEBUG_GENERATE_REPORT: bool = True  # Generate debug.md report

# =============================================================================
# LOGGING
# =============================================================================

import logging
LOG_LEVEL: int = logging.DEBUG  # Set to logging.INFO for production
