#!/usr/bin/env python3
"""
=============================================================================
BRIGHTNESS AND SHARPNESS VISUALIZATION TOOL
=============================================================================

PURPOSE:
--------
This script is designed to help calibrate brightness and sharpness thresholds
for the face quality scoring system. It runs on a Mac (or any machine with a
webcam) and provides real-time visualization of these metrics for detected faces.

CONTEXT:
--------
The main face recognition pipeline (visitor_counter.py) uses quality scoring
to select the best frames for embedding extraction. Currently, brightness and
sharpness are DISABLED in the scoring (importance=0 in config.py). This tool
helps determine appropriate threshold values before enabling them.

The quality scoring formula is:
    total = 1000 × factor1^(importance1/5) × factor2^(importance2/5) × ...

Each factor (brightness, sharpness, etc.) produces a score in [0, 1] range.
The thresholds determine how raw metric values map to these scores.

METRICS COMPUTED:
-----------------
1. BRIGHTNESS (mean pixel value of face ROI)
   - Range: 0-255
   - Too dark: < 30-50 (hard to see features)
   - Optimal: 80-180 (good lighting)
   - Too bright: > 200-230 (washed out)

2. SHARPNESS (Laplacian variance of face ROI)
   - Range: 0 to ~1000+ (unbounded)
   - Very blurry: < 50 (motion blur, out of focus)
   - Acceptable: 50-300 (some blur but usable)
   - Sharp: > 300 (clear, in-focus)

3. CONTRAST (standard deviation of pixel values)
   - Range: 0-127 (theoretical max)
   - Low contrast: < 15-20 (flat lighting)
   - Good contrast: > 40-50 (distinct features)

HOW TO USE:
-----------
1. Run this script on your Mac:
   $ python brightness_and_sharpness_vis.py

2. Position yourself in front of the camera at various:
   - Distances (near/far)
   - Lighting conditions (bright/dim/backlit)
   - Angles (frontal/side)
   - Motion states (still/moving)

3. Observe the real-time values displayed on screen:
   - Green = good range (based on current thresholds)
   - Yellow = marginal
   - Red = poor quality

4. Note down values that correspond to "acceptable" vs "unacceptable" quality
   in your specific environment.

5. Update config.py thresholds:
   QUALITY_THRESHOLDS = {
       'brightness': {
           'critical_low': <your_value>,
           'good_low': <your_value>,
           'good_high': <your_value>,
           'critical_high': <your_value>,
       },
       'sharpness': {
           'critical': <your_value>,
           'good': <your_value>,
       },
       ...
   }

6. Enable the factors in QUALITY_IMPORTANCE:
   QUALITY_IMPORTANCE = {
       'brightness': 4,  # Was 0
       'sharpness': 6,   # Was 0
       ...
   }

DEPENDENCIES:
-------------
- opencv-python (cv2)
- numpy

Install with: pip install opencv-python numpy

KEYBOARD CONTROLS:
------------------
- 'q' or ESC: Quit
- 's': Save current frame as screenshot
- 'r': Reset statistics

OUTPUT:
-------
The script displays:
- Live camera feed with face bounding box
- Real-time metrics overlaid on the face region
- Color-coded quality indicators
- Running min/max/avg statistics

=============================================================================
"""

import cv2
import numpy as np
import time
import os
from dataclasses import dataclass
from typing import Optional, Tuple, List


# =============================================================================
# CONFIGURATION (adjust these to match your config.py thresholds)
# =============================================================================

# Current thresholds from config.py (for reference/comparison)
THRESHOLDS = {
    'brightness': {
        'critical_low': 30,    # Below = too dark
        'good_low': 80,        # Optimal range start
        'good_high': 180,      # Optimal range end
        'critical_high': 230,  # Above = too bright
    },
    'sharpness': {
        'critical': 50,        # Below = very blurry
        'good': 300,           # Above = sharp
    },
    'contrast': {
        'critical': 15,        # Below = low contrast
        'good': 50,            # Above = good contrast
    },
}


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class MetricStats:
    """Track running statistics for a metric."""
    values: List[float]
    max_history: int = 100
    
    def add(self, value: float):
        self.values.append(value)
        if len(self.values) > self.max_history:
            self.values.pop(0)
    
    def min(self) -> float:
        return min(self.values) if self.values else 0
    
    def max(self) -> float:
        return max(self.values) if self.values else 0
    
    def avg(self) -> float:
        return sum(self.values) / len(self.values) if self.values else 0
    
    def reset(self):
        self.values = []


# =============================================================================
# FACE DETECTION (YuNet)
# =============================================================================

_yunet_detector = None

def get_yunet_detector(input_size: Tuple[int, int]):
    """Initialize YuNet face detector."""
    global _yunet_detector
    
    if _yunet_detector is None:
        # Try to find the model
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths = [
            os.path.join(script_dir, "..", "models", "face_detection_yunet_2023mar.onnx"),
            os.path.join(script_dir, "models", "face_detection_yunet_2023mar.onnx"),
            "face_detection_yunet_2023mar.onnx",
        ]
        
        model_path = None
        for path in possible_paths:
            if os.path.exists(path):
                model_path = path
                break
        
        if model_path is None:
            # Download the model
            model_path = os.path.join(script_dir, "face_detection_yunet_2023mar.onnx")
            print(f"Downloading YuNet model to {model_path}...")
            import urllib.request
            url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            urllib.request.urlretrieve(url, model_path)
            print("Download complete.")
        
        _yunet_detector = cv2.FaceDetectorYN.create(
            model_path,
            "",
            input_size,
            score_threshold=0.7,
            nms_threshold=0.3,
            top_k=5000
        )
    
    _yunet_detector.setInputSize(input_size)
    return _yunet_detector


def detect_face(frame: np.ndarray) -> Optional[Tuple[Tuple[int, int, int, int], float]]:
    """
    Detect the largest face in frame.
    
    Returns:
        ((x1, y1, x2, y2), confidence) or None
    """
    h, w = frame.shape[:2]
    detector = get_yunet_detector((w, h))
    
    _, faces = detector.detect(frame)
    
    if faces is None or len(faces) == 0:
        return None
    
    # Get largest face by area
    largest = max(faces, key=lambda f: f[2] * f[3])
    x, y, fw, fh = int(largest[0]), int(largest[1]), int(largest[2]), int(largest[3])
    confidence = float(largest[14])
    
    return ((x, y, x + fw, y + fh), confidence)


# =============================================================================
# METRIC COMPUTATION
# =============================================================================

def compute_brightness(face_roi: np.ndarray) -> float:
    """Compute mean brightness of face ROI (0-255)."""
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    return float(np.mean(gray))


def compute_sharpness(face_roi: np.ndarray) -> float:
    """Compute sharpness using Laplacian variance."""
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    return float(laplacian.var())


def compute_contrast(face_roi: np.ndarray) -> float:
    """Compute contrast as standard deviation of pixel values."""
    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY) if len(face_roi.shape) == 3 else face_roi
    return float(np.std(gray))


def get_quality_color(value: float, thresholds: dict, metric_type: str) -> Tuple[int, int, int]:
    """
    Get color based on quality level.
    
    Returns:
        BGR color tuple (green=good, yellow=marginal, red=bad)
    """
    if metric_type == 'brightness':
        if thresholds['good_low'] <= value <= thresholds['good_high']:
            return (0, 255, 0)  # Green - optimal
        elif thresholds['critical_low'] <= value <= thresholds['critical_high']:
            return (0, 255, 255)  # Yellow - marginal
        else:
            return (0, 0, 255)  # Red - bad
    
    elif metric_type in ['sharpness', 'contrast']:
        if value >= thresholds['good']:
            return (0, 255, 0)  # Green
        elif value >= thresholds['critical']:
            return (0, 255, 255)  # Yellow
        else:
            return (0, 0, 255)  # Red
    
    return (255, 255, 255)  # White default


# =============================================================================
# VISUALIZATION
# =============================================================================

def draw_metrics(frame: np.ndarray, bbox: Tuple[int, int, int, int],
                 brightness: float, sharpness: float, contrast: float,
                 confidence: float) -> np.ndarray:
    """Draw metrics overlay on frame."""
    x1, y1, x2, y2 = bbox
    
    # Draw face bounding box
    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
    
    # Get colors for each metric
    bright_color = get_quality_color(brightness, THRESHOLDS['brightness'], 'brightness')
    sharp_color = get_quality_color(sharpness, THRESHOLDS['sharpness'], 'sharpness')
    contrast_color = get_quality_color(contrast, THRESHOLDS['contrast'], 'contrast')
    
    # Draw metrics below face box
    y_offset = y2 + 25
    line_height = 25
    
    # Confidence
    cv2.putText(frame, f"Conf: {confidence:.2f}", (x1, y_offset),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    y_offset += line_height
    
    # Brightness
    cv2.putText(frame, f"Bright: {brightness:.1f}", (x1, y_offset),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, bright_color, 2)
    y_offset += line_height
    
    # Sharpness
    cv2.putText(frame, f"Sharp: {sharpness:.1f}", (x1, y_offset),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, sharp_color, 2)
    y_offset += line_height
    
    # Contrast
    cv2.putText(frame, f"Contrast: {contrast:.1f}", (x1, y_offset),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, contrast_color, 2)
    
    # Draw face size
    face_w = x2 - x1
    face_h = y2 - y1
    cv2.putText(frame, f"{face_w}x{face_h}px", (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)
    
    return frame


def draw_stats(frame: np.ndarray, stats: dict, y_start: int = 30) -> np.ndarray:
    """Draw running statistics on frame."""
    x = 10
    y = y_start
    line_height = 22
    
    cv2.putText(frame, "=== STATISTICS ===", (x, y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    y += line_height
    
    for name, stat in stats.items():
        text = f"{name}: min={stat.min():.1f} avg={stat.avg():.1f} max={stat.max():.1f}"
        cv2.putText(frame, text, (x, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
        y += line_height
    
    return frame


def draw_thresholds(frame: np.ndarray, y_start: int = 150) -> np.ndarray:
    """Draw current threshold values on frame."""
    x = 10
    y = y_start
    line_height = 20
    
    cv2.putText(frame, "=== THRESHOLDS ===", (x, y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    y += line_height
    
    cv2.putText(frame, f"Brightness: {THRESHOLDS['brightness']['critical_low']}-{THRESHOLDS['brightness']['good_low']} (dark) | "
                       f"{THRESHOLDS['brightness']['good_low']}-{THRESHOLDS['brightness']['good_high']} (good) | "
                       f"{THRESHOLDS['brightness']['good_high']}-{THRESHOLDS['brightness']['critical_high']} (bright)",
                (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (150, 150, 150), 1)
    y += line_height
    
    cv2.putText(frame, f"Sharpness: <{THRESHOLDS['sharpness']['critical']} (blurry) | "
                       f"{THRESHOLDS['sharpness']['critical']}-{THRESHOLDS['sharpness']['good']} (ok) | "
                       f">{THRESHOLDS['sharpness']['good']} (sharp)",
                (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (150, 150, 150), 1)
    y += line_height
    
    cv2.putText(frame, f"Contrast: <{THRESHOLDS['contrast']['critical']} (low) | "
                       f">{THRESHOLDS['contrast']['good']} (good)",
                (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (150, 150, 150), 1)
    
    return frame


def draw_instructions(frame: np.ndarray, h: int) -> np.ndarray:
    """Draw keyboard instructions."""
    y = h - 40
    cv2.putText(frame, "Keys: [Q]uit  [S]creenshot  [R]eset stats", (10, y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
    return frame


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 60)
    print("BRIGHTNESS AND SHARPNESS VISUALIZATION TOOL")
    print("=" * 60)
    print("\nOpening webcam (device 0)...")
    
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("ERROR: Could not open webcam. Make sure camera is connected.")
        return
    
    # Get camera resolution
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera resolution: {w}x{h}")
    print("\nPress 'q' to quit, 's' to save screenshot, 'r' to reset stats")
    print("-" * 60)
    
    # Initialize statistics
    stats = {
        'Brightness': MetricStats(values=[]),
        'Sharpness': MetricStats(values=[]),
        'Contrast': MetricStats(values=[]),
    }
    
    frame_count = 0
    fps_start = time.time()
    fps = 0
    
    screenshot_dir = "screenshots"
    os.makedirs(screenshot_dir, exist_ok=True)
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read frame")
            break
        
        frame_count += 1
        
        # Calculate FPS
        if frame_count % 30 == 0:
            fps = 30 / (time.time() - fps_start)
            fps_start = time.time()
        
        # Detect face
        detection = detect_face(frame)
        
        if detection is not None:
            bbox, confidence = detection
            x1, y1, x2, y2 = bbox
            
            # Extract face ROI with padding
            pad = int((x2 - x1) * 0.1)
            roi_x1 = max(0, x1 - pad)
            roi_y1 = max(0, y1 - pad)
            roi_x2 = min(frame.shape[1], x2 + pad)
            roi_y2 = min(frame.shape[0], y2 + pad)
            
            face_roi = frame[roi_y1:roi_y2, roi_x1:roi_x2]
            
            if face_roi.size > 0:
                # Compute metrics
                brightness = compute_brightness(face_roi)
                sharpness = compute_sharpness(face_roi)
                contrast = compute_contrast(face_roi)
                
                # Update statistics
                stats['Brightness'].add(brightness)
                stats['Sharpness'].add(sharpness)
                stats['Contrast'].add(contrast)
                
                # Draw metrics on frame
                frame = draw_metrics(frame, bbox, brightness, sharpness, contrast, confidence)
        else:
            # No face detected
            cv2.putText(frame, "No face detected", (10, frame.shape[0] // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
        
        # Draw overlays
        frame = draw_stats(frame, stats)
        frame = draw_thresholds(frame)
        frame = draw_instructions(frame, frame.shape[0])
        
        # Draw FPS
        cv2.putText(frame, f"FPS: {fps:.1f}", (frame.shape[1] - 100, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        
        # Show frame
        cv2.imshow("Brightness & Sharpness Visualization", frame)
        
        # Handle keyboard input
        key = cv2.waitKey(1) & 0xFF
        
        if key == ord('q') or key == 27:  # q or ESC
            break
        elif key == ord('s'):
            # Save screenshot
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(screenshot_dir, f"screenshot_{timestamp}.jpg")
            cv2.imwrite(filename, frame)
            print(f"Screenshot saved: {filename}")
        elif key == ord('r'):
            # Reset statistics
            for stat in stats.values():
                stat.reset()
            print("Statistics reset")
    
    cap.release()
    cv2.destroyAllWindows()
    
    # Print final statistics
    print("\n" + "=" * 60)
    print("FINAL STATISTICS")
    print("=" * 60)
    for name, stat in stats.items():
        if stat.values:
            print(f"{name}:")
            print(f"  Min: {stat.min():.1f}")
            print(f"  Avg: {stat.avg():.1f}")
            print(f"  Max: {stat.max():.1f}")
    print("=" * 60)


if __name__ == "__main__":
    main()
