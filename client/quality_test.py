#!/usr/bin/env python3
"""
Frame Quality Test Script
Records a 3-second clip from Mac webcam and scores all frames.
Outputs top 5 frames to debug.md with scores and embedded images.

Usage:
    python quality_test.py
    
    Press SPACE to start recording 3-second clip
    Press Q to quit
"""

import cv2
import os
import base64
import time
from datetime import datetime
from typing import List, Tuple
import numpy as np

from frame_quality import compute_quality_score, QualityScore


# =============================================================================
# CONFIGURATION
# =============================================================================

RECORD_DURATION_SEC: float = 6.0  # Duration of clip to record
FRAME_SKIP: int = 3  # Process every Nth frame (1 = all frames, 3 = every 3rd)
OUTPUT_DIR: str = "debug_output"
DEBUG_MD_FILE: str = "debug.md"
TOP_N_FRAMES: int = 5  # Number of top frames to include in debug output


# =============================================================================
# HELPERS
# =============================================================================

def image_to_base64(image: np.ndarray, max_width: int = 400) -> str:
    """Convert image to base64 string for markdown embedding."""
    # Resize for display
    h, w = image.shape[:2]
    if w > max_width:
        scale = max_width / w
        new_h = int(h * scale)
        image = cv2.resize(image, (max_width, new_h))
    
    # Encode to JPEG
    _, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


def draw_face_box(image: np.ndarray, bbox: Tuple[int, int, int, int], score: float) -> np.ndarray:
    """Draw face bounding box and score on image."""
    img = image.copy()
    x1, y1, x2, y2 = bbox
    
    # Draw box
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
    
    # Draw score
    label = f"Score: {score:.3f}"
    cv2.putText(img, label, (x1, y1 - 10), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    
    return img


def generate_debug_markdown(
    scored_frames: List[Tuple[int, np.ndarray, QualityScore]],
    total_frames: int,
    duration: float
) -> str:
    """Generate markdown content with embedded images and scores."""
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    md = f"""# Frame Quality Debug Report

**Generated**: {timestamp}  
**Total Frames Captured**: {total_frames}  
**Recording Duration**: {duration:.2f} seconds  
**Frames with Faces Detected**: {len(scored_frames)}  
**Top {TOP_N_FRAMES} Frames Shown Below**

---

## Quality Scoring Algorithm

The quality score is computed using 4 metrics:

| Metric | Weight | Description |
|--------|--------|-------------|
| **Sharpness** | 30% | Laplacian variance on face ROI - detects blur |
| **Frontality** | 25% | Yaw/pitch from eye detection - penalizes turned faces |
| **Face Size** | 15% | Face area relative to frame |
| **Brightness** | 15% | Mean brightness of face ROI - penalizes too dark/bright |
| **Contrast** | 15% | Std deviation of face ROI pixels |

**Formula**: `total = 0.30*sharpness + 0.25*frontality + 0.15*face_size + 0.15*brightness + 0.15*contrast`

**Note**: All metrics except face_size are computed on the **cropped face region** (ROI + 10% padding), not the full frame.

---

## Top {TOP_N_FRAMES} Frames

"""
    
    for rank, (frame_idx, frame, score) in enumerate(scored_frames[:TOP_N_FRAMES], 1):
        # Draw box on frame
        annotated = draw_face_box(frame, score.bbox, score.total)
        b64_img = image_to_base64(annotated)
        
        md += f"""### Rank #{rank} (Frame {frame_idx})

**Total Score: {score.total:.3f}**

| Metric | Score | Details |
|--------|-------|---------|  
| Sharpness | {score.sharpness:.3f} | Laplacian variance on face ROI |
| Frontality | {score.frontality:.3f} | Yaw: {score.yaw:.1f}°, Pitch: {score.pitch:.1f}° |
| Face Size | {score.face_size:.3f} | Relative to frame area |
| Brightness | {score.brightness:.3f} | Face ROI mean brightness |
| Contrast | {score.contrast:.3f} | Face ROI std deviation |

![Frame {frame_idx}]({b64_img})

---

"""
    
    # Add comparison section
    if len(scored_frames) >= 2:
        best = scored_frames[0][2]
        worst = scored_frames[-1][2]
        
        md += f"""## Score Distribution

| Metric | Best Frame | Worst Frame | Difference |
|--------|------------|-------------|------------|
| **Total** | {best.total:.3f} | {worst.total:.3f} | {best.total - worst.total:.3f} |
| Sharpness | {best.sharpness:.3f} | {worst.sharpness:.3f} | {best.sharpness - worst.sharpness:.3f} |
| Frontality | {best.frontality:.3f} | {worst.frontality:.3f} | {best.frontality - worst.frontality:.3f} |
| Face Size | {best.face_size:.3f} | {worst.face_size:.3f} | {best.face_size - worst.face_size:.3f} |
| Brightness | {best.brightness:.3f} | {worst.brightness:.3f} | {best.brightness - worst.brightness:.3f} |
| Contrast | {best.contrast:.3f} | {worst.contrast:.3f} | {best.contrast - worst.contrast:.3f} |

**Best frame pose**: Yaw {best.yaw:.1f}°, Pitch {best.pitch:.1f}°  
**Worst frame pose**: Yaw {worst.yaw:.1f}°, Pitch {worst.pitch:.1f}°

"""
    
    return md


# =============================================================================
# MAIN
# =============================================================================

def record_clip(cap: cv2.VideoCapture, duration: float, frame_skip: int = 1) -> List[np.ndarray]:
    """Record frames for specified duration, keeping every Nth frame."""
    frames = []
    frame_count = 0
    start_time = time.time()
    
    print(f"Recording for {duration} seconds (keeping every {frame_skip} frame)...")
    
    while time.time() - start_time < duration:
        ret, frame = cap.read()
        if ret:
            frame_count += 1
            if frame_count % frame_skip == 0:
                frames.append(frame)
        
        # Small delay to not overwhelm
        time.sleep(0.033)  # ~30 FPS
    
    print(f"Captured {frame_count} total frames, kept {len(frames)}")
    return frames


def run_test():
    """Main test loop."""
    print("=" * 60)
    print("FRAME QUALITY TEST")
    print("=" * 60)
    print()
    print("Controls:")
    print("  SPACE - Start recording 3-second clip")
    print("  Q     - Quit")
    print()
    print("=" * 60)
    
    # Open webcam
    print("Opening webcam...")
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("ERROR: Cannot open webcam")
        return
    
    # Set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    
    ret, frame = cap.read()
    if not ret:
        print("ERROR: Cannot read from webcam")
        return
    
    print(f"Webcam resolution: {frame.shape[1]}x{frame.shape[0]}")
    print()
    print("Position yourself in front of the camera.")
    print("Press SPACE when ready to record...")
    print()
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                continue
            
            # Show preview
            preview = frame.copy()
            cv2.putText(preview, "Press SPACE to record, Q to quit", (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            # Try to detect face and show box
            from frame_quality import detect_face
            bbox = detect_face(frame)
            if bbox:
                x1, y1, x2, y2 = bbox
                cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(preview, "Face detected", (x1, y1 - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            
            cv2.imshow("Quality Test - Preview", preview)
            
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('q'):
                break
            
            elif key == ord(' '):
                print("\n" + "=" * 40)
                print("RECORDING STARTED")
                print("=" * 40)
                
                # Record clip
                start_time = time.time()
                frames = record_clip(cap, RECORD_DURATION_SEC, FRAME_SKIP)
                duration = time.time() - start_time
                
                print(f"Captured {len(frames)} frames in {duration:.2f}s")
                
                # Score all frames
                print("Scoring frames...")
                scored_frames = []
                
                for i, f in enumerate(frames):
                    score = compute_quality_score(f)
                    if score is not None:
                        scored_frames.append((i, f, score))
                
                print(f"Faces detected in {len(scored_frames)}/{len(frames)} frames")
                
                if not scored_frames:
                    print("WARNING: No faces detected in any frame!")
                    print("Make sure your face is visible to the camera.")
                    continue
                
                # Sort by score
                scored_frames.sort(key=lambda x: x[2].total, reverse=True)
                
                # Print top 5 scores
                print("\nTop 5 scores:")
                for rank, (idx, _, score) in enumerate(scored_frames[:5], 1):
                    print(f"  #{rank}: Frame {idx} - Score: {score.total:.3f} "
                          f"(sharp={score.sharpness:.2f}, frontal={score.frontality:.2f}, "
                          f"yaw={score.yaw:.1f}°, pitch={score.pitch:.1f}°)")
                
                # Generate debug markdown
                print("\nGenerating debug.md...")
                md_content = generate_debug_markdown(scored_frames, len(frames), duration)
                
                md_path = os.path.join(OUTPUT_DIR, DEBUG_MD_FILE)
                with open(md_path, 'w') as f:
                    f.write(md_content)
                
                print(f"Debug report saved to: {md_path}")
                
                # Also save top frame as image
                best_frame = scored_frames[0][1]
                best_score = scored_frames[0][2]
                best_annotated = draw_face_box(best_frame, best_score.bbox, best_score.total)
                
                best_path = os.path.join(OUTPUT_DIR, "best_frame.jpg")
                cv2.imwrite(best_path, best_annotated)
                print(f"Best frame saved to: {best_path}")
                
                print("\n" + "=" * 40)
                print("RECORDING COMPLETE")
                print("=" * 40)
                print("\nPress SPACE to record again, Q to quit")
    
    except KeyboardInterrupt:
        print("\nInterrupted by user")
    
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("\nTest ended.")


if __name__ == "__main__":
    run_test()
