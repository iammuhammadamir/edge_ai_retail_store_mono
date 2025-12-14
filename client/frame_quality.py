#!/usr/bin/env python3
"""
Frame Quality Scoring Module
Scores frames based on face quality metrics for optimal recognition.

Metrics:
1. Face Size - Larger faces are better for recognition
2. Sharpness - Detect blur using Laplacian variance
3. Brightness - Avoid too dark or too bright faces
4. Contrast - Good contrast improves feature extraction
5. Frontality - Face should be front-facing (yaw/pitch near 0)
"""

import cv2
import numpy as np
from typing import Tuple, Dict, Optional, List
from dataclasses import dataclass


@dataclass
class QualityScore:
    """Container for frame quality metrics."""
    total: float
    face_size: float
    sharpness: float
    brightness: float
    contrast: float
    frontality: float
    yaw: float  # Left/right rotation in degrees
    pitch: float  # Up/down rotation in degrees
    bbox: Tuple[int, int, int, int]  # x1, y1, x2, y2
    
    def to_dict(self) -> Dict:
        return {
            'total': round(self.total, 3),
            'face_size': round(self.face_size, 3),
            'sharpness': round(self.sharpness, 3),
            'brightness': round(self.brightness, 3),
            'contrast': round(self.contrast, 3),
            'frontality': round(self.frontality, 3),
            'yaw': round(self.yaw, 1),
            'pitch': round(self.pitch, 1),
            'bbox': self.bbox
        }


# =============================================================================
# FACE DETECTION (YuNet - modern, lightweight, accurate)
# =============================================================================

_yunet_detector = None
_yunet_input_size = None

def get_yunet_detector(input_size: Tuple[int, int] = (640, 480)):
    """
    Get or initialize YuNet face detector.
    
    YuNet is a modern lightweight face detector included in OpenCV 4.5+.
    Much more accurate than Haar Cascade while still being fast (~5-10ms).
    
    Args:
        input_size: (width, height) of input frames
    """
    global _yunet_detector, _yunet_input_size
    
    # Reinitialize if input size changed
    if _yunet_detector is None or _yunet_input_size != input_size:
        # YuNet model path - download if not exists
        import os
        model_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(model_dir, "models", "face_detection_yunet_2023mar.onnx")
        
        # Download model if not exists
        if not os.path.exists(model_path):
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            import urllib.request
            url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            print(f"Downloading YuNet model to {model_path}...")
            urllib.request.urlretrieve(url, model_path)
            print("YuNet model downloaded.")
        
        _yunet_detector = cv2.FaceDetectorYN.create(
            model_path,
            "",
            input_size,
            score_threshold=0.5,
            nms_threshold=0.3,
            top_k=5000
        )
        _yunet_input_size = input_size
    
    return _yunet_detector


def detect_face(frame: np.ndarray, min_confidence: float = 0.0) -> Optional[Tuple[Tuple[int, int, int, int], float]]:
    """
    Detect the largest face in frame using YuNet.
    
    Args:
        frame: BGR image
        min_confidence: Minimum detection confidence (0-1). Faces below this are ignored.
    
    Returns:
        ((x1, y1, x2, y2), confidence) or None if no face found above threshold
    """
    h, w = frame.shape[:2]
    detector = get_yunet_detector((w, h))
    
    # YuNet expects BGR image
    _, faces = detector.detect(frame)
    
    if faces is None or len(faces) == 0:
        return None
    
    # faces format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
    # Filter by confidence first
    confident_faces = [f for f in faces if f[14] >= min_confidence]
    
    if not confident_faces:
        return None
    
    # Return largest face by area (among confident ones)
    largest = max(confident_faces, key=lambda f: f[2] * f[3])
    x, y, fw, fh = int(largest[0]), int(largest[1]), int(largest[2]), int(largest[3])
    confidence = float(largest[14])
    return ((x, y, x + fw, y + fh), confidence)


def detect_face_with_landmarks(frame: np.ndarray, min_confidence: float = 0.0) -> Optional[Tuple[Tuple[int, int, int, int], dict]]:
    """
    Detect face and return landmarks from YuNet.
    
    Args:
        frame: BGR image
        min_confidence: Minimum detection confidence (0-1). Faces below this are ignored.
    
    Returns:
        ((x1, y1, x2, y2), landmarks_dict) or None if no face found above threshold
        landmarks_dict contains: right_eye, left_eye, nose, right_mouth, left_mouth, score
    """
    h, w = frame.shape[:2]
    detector = get_yunet_detector((w, h))
    
    _, faces = detector.detect(frame)
    
    if faces is None or len(faces) == 0:
        return None
    
    # Filter by confidence first
    confident_faces = [f for f in faces if f[14] >= min_confidence]
    
    if not confident_faces:
        return None
    
    # Get largest face (among confident ones)
    largest = max(confident_faces, key=lambda f: f[2] * f[3])
    
    # Parse YuNet output
    # Format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, score]
    x, y, fw, fh = int(largest[0]), int(largest[1]), int(largest[2]), int(largest[3])
    bbox = (x, y, x + fw, y + fh)
    
    landmarks = {
        'right_eye': (float(largest[4]), float(largest[5])),
        'left_eye': (float(largest[6]), float(largest[7])),
        'nose': (float(largest[8]), float(largest[9])),
        'right_mouth': (float(largest[10]), float(largest[11])),
        'left_mouth': (float(largest[12]), float(largest[13])),
        'score': float(largest[14])
    }
    
    return (bbox, landmarks)


# =============================================================================
# QUALITY METRICS
# =============================================================================

def score_face_size(bbox: Tuple[int, int, int, int], frame_shape: Tuple[int, int]) -> float:
    """
    Score based on face size in pixels (absolute, not ratio).
    
    Thresholds:
    - Below zero_px (60): score = 0 (unusable)
    - Between zero_px and critical_px (105): aggressive quadratic penalty
    - Above critical_px (105): perfect score (1.0)
    
    Returns:
        Score in [0, 1] range
    """
    x1, y1, x2, y2 = bbox
    face_width = x2 - x1
    
    # Load thresholds from config
    try:
        import config as cfg
        thresholds = cfg.QUALITY_THRESHOLDS.get('face_size', {})
        ZERO_PX = thresholds.get('zero_px', 60)
        CRITICAL_PX = thresholds.get('critical_px', 105)
    except (ImportError, AttributeError):
        ZERO_PX = 60
        CRITICAL_PX = 105
    
    if face_width >= CRITICAL_PX:
        # Large enough face - perfect score
        return 1.0
    elif face_width <= ZERO_PX:
        # Too small - zero out the score
        return 0.0
    else:
        # Between zero and critical - aggressive quadratic penalty
        # Maps from 0 at ZERO_PX to 1.0 at CRITICAL_PX, with quadratic curve
        ratio = (face_width - ZERO_PX) / (CRITICAL_PX - ZERO_PX)
        return ratio ** 2  # Quadratic: slow start, accelerates toward 1.0


def score_sharpness(face_roi: np.ndarray) -> float:
    """
    Score based on image sharpness using Laplacian variance.
    Uses aggressive penalty below critical threshold.
    
    Returns:
        Score in [0, 1] range
    """
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    variance = laplacian.var()
    
    # Load thresholds from config
    try:
        import config as cfg
        thresholds = cfg.QUALITY_THRESHOLDS.get('sharpness', {})
        CRITICAL = thresholds.get('critical', 50)
        GOOD = thresholds.get('good', 300)
    except (ImportError, AttributeError):
        CRITICAL = 50
        GOOD = 300
    
    if variance >= GOOD:
        return 1.0
    elif variance >= CRITICAL:
        # Linear interpolation between critical and good
        return 0.3 + 0.7 * ((variance - CRITICAL) / (GOOD - CRITICAL))
    else:
        # Below critical - aggressive quadratic penalty
        ratio = variance / CRITICAL
        return 0.3 * (ratio ** 2)


def score_brightness(face_roi: np.ndarray) -> float:
    """
    Score based on brightness - penalize too dark or too bright.
    Uses aggressive penalty beyond critical thresholds.
    
    Returns:
        Score in [0, 1] range
    """
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    mean_brightness = np.mean(gray)
    
    # Load thresholds from config
    try:
        import config as cfg
        thresholds = cfg.QUALITY_THRESHOLDS.get('brightness', {})
        CRITICAL_LOW = thresholds.get('critical_low', 30)
        GOOD_LOW = thresholds.get('good_low', 80)
        GOOD_HIGH = thresholds.get('good_high', 180)
        CRITICAL_HIGH = thresholds.get('critical_high', 230)
    except (ImportError, AttributeError):
        CRITICAL_LOW = 30
        GOOD_LOW = 80
        GOOD_HIGH = 180
        CRITICAL_HIGH = 230
    
    if GOOD_LOW <= mean_brightness <= GOOD_HIGH:
        # Optimal range - perfect score
        return 1.0
    elif mean_brightness < GOOD_LOW:
        if mean_brightness >= CRITICAL_LOW:
            # Between critical and good - linear
            return 0.4 + 0.6 * ((mean_brightness - CRITICAL_LOW) / (GOOD_LOW - CRITICAL_LOW))
        else:
            # Below critical - aggressive quadratic penalty
            ratio = mean_brightness / CRITICAL_LOW
            return 0.4 * (ratio ** 2)
    else:  # mean_brightness > GOOD_HIGH
        if mean_brightness <= CRITICAL_HIGH:
            # Between good and critical - linear
            return 0.4 + 0.6 * ((CRITICAL_HIGH - mean_brightness) / (CRITICAL_HIGH - GOOD_HIGH))
        else:
            # Above critical - aggressive quadratic penalty
            overshoot = (mean_brightness - CRITICAL_HIGH) / (255 - CRITICAL_HIGH)
            return 0.4 * ((1 - overshoot) ** 2)


def score_contrast(face_roi: np.ndarray) -> float:
    """
    Score based on contrast using standard deviation.
    Uses aggressive penalty below critical threshold.
    
    Returns:
        Score in [0, 1] range
    """
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    std_dev = np.std(gray)
    
    # Load thresholds from config
    try:
        import config as cfg
        thresholds = cfg.QUALITY_THRESHOLDS.get('contrast', {})
        CRITICAL = thresholds.get('critical', 15)
        GOOD = thresholds.get('good', 50)
    except (ImportError, AttributeError):
        CRITICAL = 15
        GOOD = 50
    
    if std_dev >= GOOD:
        return 1.0
    elif std_dev >= CRITICAL:
        # Linear interpolation between critical and good
        return 0.3 + 0.7 * ((std_dev - CRITICAL) / (GOOD - CRITICAL))
    else:
        # Below critical - aggressive quadratic penalty
        ratio = std_dev / CRITICAL
        return 0.3 * (ratio ** 2)


def estimate_head_pose_from_landmarks(landmarks: dict, bbox: Tuple[int, int, int, int]) -> Tuple[float, float]:
    """
    Estimate head pose from pre-computed YuNet landmarks.
    
    Args:
        landmarks: Dict with right_eye, left_eye, nose positions
        bbox: (x1, y1, x2, y2) face bounding box
    
    Returns:
        (yaw, pitch) in degrees
    """
    x1, y1, x2, y2 = bbox
    face_w = x2 - x1
    face_h = y2 - y1
    
    right_eye = landmarks['right_eye']
    left_eye = landmarks['left_eye']
    nose = landmarks['nose']
    
    # Eye center
    eye_center_x = (left_eye[0] + right_eye[0]) / 2
    eye_center_y = (left_eye[1] + right_eye[1]) / 2
    
    # Face center
    face_center_x = (x1 + x2) / 2
    
    # Yaw: deviation of eye center from face center
    yaw = ((eye_center_x - face_center_x) / face_w) * 60
    
    # Pitch: estimated from nose position relative to eyes
    eye_to_nose_y = nose[1] - eye_center_y
    expected_eye_nose_dist = face_h * 0.25
    pitch = ((eye_to_nose_y - expected_eye_nose_dist) / face_h) * 40
    
    # Roll penalty from eye slope
    eye_slope = (right_eye[1] - left_eye[1]) / max(abs(right_eye[0] - left_eye[0]), 1)
    roll_penalty = abs(eye_slope) * 15
    
    return (yaw, pitch + roll_penalty * 0.3)


def estimate_head_pose(frame: np.ndarray, face_bbox: Tuple[int, int, int, int]) -> Optional[Tuple[float, float]]:
    """
    Estimate head pose (yaw, pitch) using YuNet landmarks.
    
    Note: This runs detection again. For batch processing, use 
    estimate_head_pose_from_landmarks() with pre-computed landmarks.
    
    Returns:
        (yaw, pitch) in degrees, or None if landmarks not detected
    """
    result = detect_face_with_landmarks(frame)
    
    if result is None:
        # Fallback to symmetry-based estimation
        x1, y1, x2, y2 = face_bbox
        face_roi = frame[y1:y2, x1:x2]
        if face_roi.size == 0:
            return (0.0, 0.0)
        gray_roi = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        return estimate_pose_from_symmetry(gray_roi)
    
    bbox, landmarks = result
    return estimate_head_pose_from_landmarks(landmarks, bbox)


def estimate_pose_from_symmetry(gray_face: np.ndarray) -> Tuple[float, float]:
    """
    Fallback pose estimation using face symmetry.
    A frontal face should be roughly symmetric left-to-right.
    
    Returns:
        (yaw, pitch) estimates in degrees
    """
    h, w = gray_face.shape
    
    # Split face into left and right halves
    left_half = gray_face[:, :w//2]
    right_half = gray_face[:, w//2:]
    right_half_flipped = cv2.flip(right_half, 1)
    
    # Resize to same size if needed
    min_w = min(left_half.shape[1], right_half_flipped.shape[1])
    left_half = left_half[:, :min_w]
    right_half_flipped = right_half_flipped[:, :min_w]
    
    # Compute difference (asymmetry)
    diff = cv2.absdiff(left_half, right_half_flipped)
    asymmetry = np.mean(diff) / 255.0  # Normalize to 0-1
    
    # Higher asymmetry suggests turned face
    # Map to approximate yaw (very rough estimate)
    yaw = asymmetry * 45  # Max ~45 degrees for high asymmetry
    
    # Can't estimate pitch from symmetry alone
    pitch = 0
    
    return (yaw, pitch)


def score_frontality(yaw: float, pitch: float) -> float:
    """
    Score based on how frontal the face is.
    Uses aggressive penalty beyond critical thresholds.
    
    Args:
        yaw: Left/right rotation in degrees
        pitch: Up/down rotation in degrees
    
    Returns:
        Score in [0, 1] range. 1.0 = perfectly frontal
    """
    # Load thresholds from config
    try:
        import config as cfg
        thresholds = cfg.QUALITY_THRESHOLDS.get('frontality', {})
        CRITICAL_YAW = thresholds.get('critical_yaw', 35)
        GOOD_YAW = thresholds.get('good_yaw', 15)
        CRITICAL_PITCH = thresholds.get('critical_pitch', 30)
        GOOD_PITCH = thresholds.get('good_pitch', 10)
    except (ImportError, AttributeError):
        CRITICAL_YAW = 35
        GOOD_YAW = 15
        CRITICAL_PITCH = 30
        GOOD_PITCH = 10
    
    abs_yaw = abs(yaw)
    abs_pitch = abs(pitch)
    
    # Score yaw component
    if abs_yaw <= GOOD_YAW:
        yaw_score = 1.0
    elif abs_yaw <= CRITICAL_YAW:
        # Linear interpolation
        yaw_score = 0.3 + 0.7 * ((CRITICAL_YAW - abs_yaw) / (CRITICAL_YAW - GOOD_YAW))
    else:
        # Beyond critical - aggressive quadratic penalty
        overshoot = (abs_yaw - CRITICAL_YAW) / (90 - CRITICAL_YAW)
        yaw_score = 0.3 * ((1 - min(overshoot, 1.0)) ** 2)
    
    # Score pitch component
    if abs_pitch <= GOOD_PITCH:
        pitch_score = 1.0
    elif abs_pitch <= CRITICAL_PITCH:
        # Linear interpolation
        pitch_score = 0.3 + 0.7 * ((CRITICAL_PITCH - abs_pitch) / (CRITICAL_PITCH - GOOD_PITCH))
    else:
        # Beyond critical - aggressive quadratic penalty
        overshoot = (abs_pitch - CRITICAL_PITCH) / (90 - CRITICAL_PITCH)
        pitch_score = 0.3 * ((1 - min(overshoot, 1.0)) ** 2)
    
    # Combined score (yaw is more important)
    return 0.6 * yaw_score + 0.4 * pitch_score


# =============================================================================
# MULTIPLICATIVE SCORING SYSTEM
# =============================================================================

def apply_penalty(score: float, factor_value: float, importance: float) -> float:
    """
    Apply multiplicative penalty based on factor quality.
    
    Formula: score × factor_value^(importance/5)
    
    Args:
        score: Current score (e.g., 1000)
        factor_value: Quality of this factor (0-1, where 1 is perfect)
        importance: How much this factor matters (0-10 scale)
                   0 = factor ignored (multiplier = 1.0)
                   5 = linear penalty (multiplier = factor_value)
                   10 = quadratic penalty (multiplier = factor_value²)
    
    Returns:
        Adjusted score
    """
    if importance == 0:
        return score
    
    # Clamp factor_value to avoid math errors
    factor_value = max(0.001, min(1.0, factor_value))
    
    # Calculate multiplier: factor^(importance/5)
    exponent = importance / 5.0
    multiplier = factor_value ** exponent
    
    return score * multiplier


def compute_quality_score(
    frame: np.ndarray,
    bbox: Optional[Tuple[int, int, int, int]] = None,
    importance: Dict[str, float] = None,
    base_score: float = None,
    min_det_conf: float = None
) -> Optional[QualityScore]:
    """
    Compute overall quality score for a frame using multiplicative penalties.
    
    Each factor independently impacts the score:
    score = base_score × f1^(imp1/5) × f2^(imp2/5) × ...
    
    Args:
        frame: BGR image
        bbox: Optional face bounding box. If None, will detect face.
        importance: Importance values for each metric (0-10 scale)
        base_score: Starting score before penalties (default 1000)
        min_det_conf: Minimum YuNet detection confidence (default from config)
    
    Returns:
        QualityScore object or None if no face found above confidence threshold
    """
    # Import config for defaults
    try:
        import config as cfg
        if importance is None:
            importance = cfg.QUALITY_IMPORTANCE
        if base_score is None:
            base_score = cfg.QUALITY_BASE_SCORE
        if min_det_conf is None:
            min_det_conf = getattr(cfg, 'MIN_DET_CONF', 0.0)
    except ImportError:
        if importance is None:
            importance = {
                'frontality': 8,
                'sharpness': 6,
                'face_size': 5,
                'brightness': 4,
                'contrast': 3,
            }
        if base_score is None:
            base_score = 1000.0
        if min_det_conf is None:
            min_det_conf = 0.0
    
    # Detect face with landmarks (single detection for both bbox and pose)
    landmarks = None
    if bbox is None:
        result = detect_face_with_landmarks(frame, min_confidence=min_det_conf)
        if result is None:
            return None
        bbox, landmarks = result
    
    x1, y1, x2, y2 = bbox
    
    # Add padding to face ROI (10% on each side)
    h, w = frame.shape[:2]
    pad_x = int((x2 - x1) * 0.1)
    pad_y = int((y2 - y1) * 0.1)
    x1_pad = max(0, x1 - pad_x)
    y1_pad = max(0, y1 - pad_y)
    x2_pad = min(w, x2 + pad_x)
    y2_pad = min(h, y2 + pad_y)
    
    face_roi = frame[y1_pad:y2_pad, x1_pad:x2_pad]
    
    if face_roi.size == 0:
        return None
    
    # Compute individual factor scores (all 0-1 range)
    size_score = score_face_size(bbox, frame.shape[:2])
    sharp_score = score_sharpness(face_roi)
    bright_score = score_brightness(face_roi)
    contrast_score = score_contrast(face_roi)
    
    # Compute head pose for frontality (use cached landmarks if available)
    if landmarks is not None:
        yaw, pitch = estimate_head_pose_from_landmarks(landmarks, bbox)
        frontal_score = score_frontality(yaw, pitch)
    else:
        pose = estimate_head_pose(frame, bbox)
        if pose is not None:
            yaw, pitch = pose
            frontal_score = score_frontality(yaw, pitch)
        else:
            yaw, pitch = 0.0, 0.0
            frontal_score = 0.5
    
    # Apply multiplicative penalties
    total = base_score
    total = apply_penalty(total, frontal_score, importance.get('frontality', 8))
    total = apply_penalty(total, sharp_score, importance.get('sharpness', 6))
    total = apply_penalty(total, size_score, importance.get('face_size', 5))
    total = apply_penalty(total, bright_score, importance.get('brightness', 4))
    total = apply_penalty(total, contrast_score, importance.get('contrast', 3))
    
    return QualityScore(
        total=total,
        face_size=size_score,
        sharpness=sharp_score,
        brightness=bright_score,
        contrast=contrast_score,
        frontality=frontal_score,
        yaw=yaw,
        pitch=pitch,
        bbox=bbox
    )


def score_frames(frames: List[np.ndarray]) -> List[Tuple[int, np.ndarray, QualityScore]]:
    """
    Score multiple frames and return sorted by quality.
    
    Args:
        frames: List of BGR images
    
    Returns:
        List of (frame_index, frame, score) tuples, sorted by total score descending
    """
    results = []
    
    for i, frame in enumerate(frames):
        score = compute_quality_score(frame)
        if score is not None:
            results.append((i, frame, score))
    
    # Sort by total score descending
    results.sort(key=lambda x: x[2].total, reverse=True)
    
    return results


def score_frames_dual(frames: List[Tuple[np.ndarray, np.ndarray]]) -> List[Tuple[int, np.ndarray, np.ndarray, QualityScore]]:
    """
    Score multiple dual-resolution frames and return sorted by quality.
    
    This version handles frames stored as (hires, lowres) tuples.
    Scoring is done on lowres for speed, but hires is preserved for recognition.
    
    Args:
        frames: List of (cropped_hires, resized_lowres) tuples
    
    Returns:
        List of (frame_index, hires, lowres, score) tuples, sorted by total score descending
    """
    results = []
    
    for i, (frame_hires, frame_lowres) in enumerate(frames):
        # Score using the lowres frame (faster, same quality assessment)
        score = compute_quality_score(frame_lowres)
        if score is not None:
            results.append((i, frame_hires, frame_lowres, score))
    
    # Sort by total score descending
    results.sort(key=lambda x: x[3].total, reverse=True)
    
    return results


def get_best_frame(frames: List[np.ndarray]) -> Optional[Tuple[np.ndarray, QualityScore]]:
    """
    Get the best quality frame from a list.
    
    Returns:
        (best_frame, score) or None if no faces found
    """
    scored = score_frames(frames)
    if not scored:
        return None
    return (scored[0][1], scored[0][2])
