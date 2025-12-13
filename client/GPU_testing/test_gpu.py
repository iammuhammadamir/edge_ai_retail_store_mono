#!/usr/bin/env python3
"""
GPU Testing Script for InsightFace Models

Tests both detection and recognition models on CPU vs GPU
to verify GPU acceleration is working.

Models tested:
- buffalo_s (small/fast)
- buffalo_l (large/accurate)

Providers tested:
- CPUExecutionProvider
- CUDAExecutionProvider (GPU)

Usage:
    python test_gpu.py
"""

import os
import sys
import time
import cv2
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# =============================================================================
# CONFIGURATION
# =============================================================================

# Test image - will capture from camera if not provided
TEST_IMAGE_PATH = os.path.join(os.path.dirname(__file__), "test_face.jpg")

# Number of inference runs for timing
NUM_WARMUP = 3
NUM_RUNS = 10

# Models to test
MODELS = ["buffalo_s", "buffalo_l"]

# Providers to test
PROVIDERS = [
    ("CPU", ["CPUExecutionProvider"]),
    ("GPU", [("CUDAExecutionProvider", {"device_id": 0})]),
]

# =============================================================================
# HELPERS
# =============================================================================

def capture_test_image():
    """Capture a frame from the camera for testing."""
    import config as cfg
    
    print("Capturing test image from camera...")
    
    rtsp_url = cfg.RTSP_URL
    if rtsp_url.startswith("rtsp://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    
    cap = cv2.VideoCapture(rtsp_url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    if not cap.isOpened():
        print("ERROR: Cannot connect to camera")
        return None
    
    # Read a few frames to get a stable one
    for _ in range(5):
        ret, frame = cap.read()
    
    cap.release()
    
    if not ret:
        print("ERROR: Cannot read frame")
        return None
    
    # Apply cropping (same as visitor_counter.py)
    h, w = frame.shape[:2]
    x1 = int(w * 0.35)
    x2 = int(w * (1 - 0.35))
    y1 = int(h * 0.10)
    y2 = int(h * (1 - 0.40))
    frame = frame[y1:y2, x1:x2]
    
    # Resize
    target_width = cfg.TARGET_WIDTH
    scale = target_width / frame.shape[1]
    new_h = int(frame.shape[0] * scale)
    frame = cv2.resize(frame, (target_width, new_h))
    
    # Save for reuse
    cv2.imwrite(TEST_IMAGE_PATH, frame)
    print(f"Saved test image: {TEST_IMAGE_PATH} ({frame.shape[1]}x{frame.shape[0]})")
    
    return frame


def check_onnxruntime():
    """Check ONNX Runtime installation and available providers."""
    try:
        import onnxruntime as ort
        print(f"ONNX Runtime version: {ort.__version__}")
        print(f"Available providers: {ort.get_available_providers()}")
        
        cuda_available = "CUDAExecutionProvider" in ort.get_available_providers()
        print(f"CUDA available: {cuda_available}")
        
        return cuda_available
    except ImportError:
        print("ERROR: onnxruntime not installed")
        return False


def test_model(model_name, provider_name, providers, image):
    """
    Test a specific model with a specific provider.
    
    Returns dict with timing results.
    """
    from insightface.app import FaceAnalysis
    
    print(f"\n{'='*60}")
    print(f"Testing: {model_name} on {provider_name}")
    print(f"{'='*60}")
    
    # Initialize model
    print("Initializing model...")
    t0 = time.perf_counter()
    
    try:
        app = FaceAnalysis(
            name=model_name,
            root=os.path.expanduser("~/.insightface"),
            providers=providers
        )
        app.prepare(ctx_id=0 if provider_name == "GPU" else -1, det_size=(640, 640))
        init_time = time.perf_counter() - t0
        print(f"  Init time: {init_time:.2f}s")
    except Exception as e:
        print(f"  ERROR: Failed to initialize - {e}")
        return None
    
    # Warmup runs
    print(f"Warmup ({NUM_WARMUP} runs)...")
    for i in range(NUM_WARMUP):
        faces = app.get(image)
        print(f"  Run {i+1}: {len(faces)} face(s) detected")
    
    # Timed runs
    print(f"Benchmark ({NUM_RUNS} runs)...")
    times = []
    for i in range(NUM_RUNS):
        t0 = time.perf_counter()
        faces = app.get(image)
        elapsed = (time.perf_counter() - t0) * 1000  # ms
        times.append(elapsed)
        print(f"  Run {i+1}: {elapsed:.1f}ms ({len(faces)} faces)")
    
    # Stats
    avg_time = np.mean(times)
    min_time = np.min(times)
    max_time = np.max(times)
    std_time = np.std(times)
    
    print(f"\nResults for {model_name} on {provider_name}:")
    print(f"  Average: {avg_time:.1f}ms")
    print(f"  Min: {min_time:.1f}ms")
    print(f"  Max: {max_time:.1f}ms")
    print(f"  Std: {std_time:.1f}ms")
    
    # Check if embedding was extracted
    if faces:
        print(f"  Embedding shape: {faces[0].embedding.shape}")
        print(f"  Detection score: {faces[0].det_score:.3f}")
    
    return {
        "model": model_name,
        "provider": provider_name,
        "init_time": init_time,
        "avg_ms": avg_time,
        "min_ms": min_time,
        "max_ms": max_time,
        "std_ms": std_time,
        "faces_detected": len(faces) if faces else 0,
    }


def print_summary(results):
    """Print comparison summary."""
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    print(f"\n{'Model':<12} {'Provider':<8} {'Avg (ms)':<12} {'Min (ms)':<12} {'Speedup':<10}")
    print("-" * 70)
    
    # Group by model
    for model in MODELS:
        model_results = [r for r in results if r and r["model"] == model]
        
        cpu_result = next((r for r in model_results if r["provider"] == "CPU"), None)
        gpu_result = next((r for r in model_results if r["provider"] == "GPU"), None)
        
        for r in model_results:
            speedup = ""
            if r["provider"] == "GPU" and cpu_result:
                speedup = f"{cpu_result['avg_ms'] / r['avg_ms']:.2f}x"
            
            print(f"{r['model']:<12} {r['provider']:<8} {r['avg_ms']:<12.1f} {r['min_ms']:<12.1f} {speedup:<10}")
        
        print()
    
    # GPU working?
    gpu_results = [r for r in results if r and r["provider"] == "GPU"]
    cpu_results = [r for r in results if r and r["provider"] == "CPU"]
    
    if gpu_results and cpu_results:
        gpu_faster = all(
            gpu_results[i]["avg_ms"] < cpu_results[i]["avg_ms"] 
            for i in range(min(len(gpu_results), len(cpu_results)))
        )
        
        if gpu_faster:
            print("✓ GPU acceleration is WORKING! GPU is faster than CPU.")
        else:
            print("✗ GPU may not be working properly. GPU is not faster than CPU.")
    elif not gpu_results:
        print("✗ GPU tests failed. CUDA may not be available.")


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 70)
    print("InsightFace GPU Testing")
    print("=" * 70)
    
    # Check ONNX Runtime
    print("\n1. Checking ONNX Runtime...")
    cuda_available = check_onnxruntime()
    
    if not cuda_available:
        print("\nWARNING: CUDA not available. Will only test CPU.")
        providers_to_test = [PROVIDERS[0]]  # CPU only
    else:
        providers_to_test = PROVIDERS
    
    # Get test image
    print("\n2. Preparing test image...")
    if os.path.exists(TEST_IMAGE_PATH):
        print(f"Using existing test image: {TEST_IMAGE_PATH}")
        image = cv2.imread(TEST_IMAGE_PATH)
    else:
        image = capture_test_image()
    
    if image is None:
        print("ERROR: No test image available")
        return
    
    print(f"Image size: {image.shape[1]}x{image.shape[0]}")
    
    # Run tests
    print("\n3. Running benchmarks...")
    results = []
    
    for model in MODELS:
        for provider_name, providers in providers_to_test:
            result = test_model(model, provider_name, providers, image)
            results.append(result)
    
    # Summary
    print_summary(results)
    
    print("\n" + "=" * 70)
    print("Testing complete!")
    print("=" * 70)


if __name__ == "__main__":
    main()
