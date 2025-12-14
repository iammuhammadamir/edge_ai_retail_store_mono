#!/usr/bin/env python3
"""
GPU vs CPU Benchmark Test for ONNX Runtime

Compares average execution time between CUDAExecutionProvider and CPUExecutionProvider
using the InsightFace detection model.

Usage:
    # With GPU (requires LD_LIBRARY_PATH for cuDNN 8):
    export LD_LIBRARY_PATH=/home/mafiq/cudnn8/cudnn-linux-sbsa-8.9.7.29_cuda12-archive/lib:$LD_LIBRARY_PATH
    python test/gpu_vs_cpu_test.py
"""

import os
import sys
import time
import numpy as np

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import onnxruntime as ort


def get_test_input(input_shape, size=160):
    """Generate random test input matching model's expected shape."""
    # Replace dynamic dimensions with fixed values
    shape = []
    for dim in input_shape:
        if isinstance(dim, str) or dim is None:
            shape.append(size)  # Use smaller size to avoid OOM
        else:
            shape.append(dim)
    return np.random.randn(*shape).astype(np.float32)


def benchmark_model(model_path: str, providers: list, num_warmup: int = 5, num_runs: int = 50):
    """
    Benchmark a model with specified execution providers.
    
    Args:
        model_path: Path to ONNX model
        providers: List of execution providers to use
        num_warmup: Number of warmup runs (not counted)
        num_runs: Number of timed runs
        
    Returns:
        dict with timing statistics
    """
    try:
        sess = ort.InferenceSession(model_path, providers=providers)
    except Exception as e:
        return {"error": str(e)}
    
    active_providers = sess.get_providers()
    
    # Get input info
    inputs = sess.get_inputs()
    input_data = {}
    for inp in inputs:
        input_data[inp.name] = get_test_input(inp.shape)
    
    # Warmup runs
    try:
        for _ in range(num_warmup):
            sess.run(None, input_data)
    except Exception as e:
        return {"error": f"Warmup failed: {e}", "providers": active_providers}
    
    # Timed runs
    times = []
    try:
        for _ in range(num_runs):
            start = time.perf_counter()
            sess.run(None, input_data)
            end = time.perf_counter()
            times.append((end - start) * 1000)  # Convert to ms
    except Exception as e:
        return {"error": f"Run failed: {e}", "providers": active_providers}
    
    return {
        "providers": active_providers,
        "times_ms": times,
        "mean_ms": np.mean(times),
        "std_ms": np.std(times),
        "min_ms": np.min(times),
        "max_ms": np.max(times),
        "median_ms": np.median(times),
    }


def main():
    print("=" * 70)
    print("GPU vs CPU Benchmark Test")
    print("=" * 70)
    print()
    
    # Check available providers
    available = ort.get_available_providers()
    print(f"Available providers: {available}")
    print()
    
    # Model paths
    models_dir = "/home/mafiq/zmisc/models/insightface/models/buffalo_s"
    models = [
        ("det_500m.onnx", "Face Detection"),
        # Recognition model needs fixed 112x112 input, tested separately
    ]
    
    num_warmup = 5
    num_runs = 30
    
    print(f"Benchmark config: {num_warmup} warmup runs, {num_runs} timed runs")
    print()
    
    results = {}
    
    for model_file, model_name in models:
        model_path = os.path.join(models_dir, model_file)
        if not os.path.exists(model_path):
            print(f"Model not found: {model_path}")
            continue
            
        print("-" * 70)
        print(f"Model: {model_name} ({model_file})")
        print("-" * 70)
        
        results[model_name] = {}
        
        # Test CPU
        print("\n[CPU] Running benchmark...")
        cpu_result = benchmark_model(
            model_path, 
            providers=['CPUExecutionProvider'],
            num_warmup=num_warmup,
            num_runs=num_runs
        )
        results[model_name]['CPU'] = cpu_result
        
        if "error" in cpu_result:
            print(f"  ERROR: {cpu_result['error']}")
        else:
            print(f"  Active providers: {cpu_result['providers']}")
            print(f"  Mean: {cpu_result['mean_ms']:.2f} ms")
            print(f"  Std:  {cpu_result['std_ms']:.2f} ms")
            print(f"  Min:  {cpu_result['min_ms']:.2f} ms")
            print(f"  Max:  {cpu_result['max_ms']:.2f} ms")
        
        # Test GPU (CUDA)
        if 'CUDAExecutionProvider' in available:
            print("\n[GPU/CUDA] Running benchmark...")
            gpu_result = benchmark_model(
                model_path,
                providers=['CUDAExecutionProvider', 'CPUExecutionProvider'],
                num_warmup=num_warmup,
                num_runs=num_runs
            )
            results[model_name]['GPU'] = gpu_result
            
            if "error" in gpu_result:
                print(f"  ERROR: {gpu_result['error']}")
            else:
                print(f"  Active providers: {gpu_result['providers']}")
                print(f"  Mean: {gpu_result['mean_ms']:.2f} ms")
                print(f"  Std:  {gpu_result['std_ms']:.2f} ms")
                print(f"  Min:  {gpu_result['min_ms']:.2f} ms")
                print(f"  Max:  {gpu_result['max_ms']:.2f} ms")
                
                # Calculate speedup
                if "error" not in cpu_result and 'CUDAExecutionProvider' in gpu_result['providers']:
                    speedup = cpu_result['mean_ms'] / gpu_result['mean_ms']
                    print(f"\n  ⚡ GPU Speedup: {speedup:.2f}x faster than CPU")
        else:
            print("\n[GPU/CUDA] Not available - skipping")
            results[model_name]['GPU'] = {"error": "CUDAExecutionProvider not available"}
        
        print()
    
    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print()
    print(f"{'Model':<20} {'CPU (ms)':<15} {'GPU (ms)':<15} {'Speedup':<10}")
    print("-" * 60)
    
    for model_name, res in results.items():
        cpu_time = res.get('CPU', {}).get('mean_ms', float('nan'))
        gpu_time = res.get('GPU', {}).get('mean_ms', float('nan'))
        
        if not np.isnan(cpu_time) and not np.isnan(gpu_time):
            speedup = cpu_time / gpu_time
            speedup_str = f"{speedup:.2f}x"
        else:
            speedup_str = "N/A"
        
        cpu_str = f"{cpu_time:.2f}" if not np.isnan(cpu_time) else "Error"
        gpu_str = f"{gpu_time:.2f}" if not np.isnan(gpu_time) else "Error"
        
        print(f"{model_name:<20} {cpu_str:<15} {gpu_str:<15} {speedup_str:<10}")
    
    print()
    
    # Check if GPU is actually being used
    gpu_working = False
    for model_name, res in results.items():
        gpu_res = res.get('GPU', {})
        if 'providers' in gpu_res and 'CUDAExecutionProvider' in gpu_res['providers']:
            gpu_working = True
            break
    
    if gpu_working:
        print("✓ GPU (CUDA) is working correctly!")
    else:
        print("✗ GPU is NOT being used. Check LD_LIBRARY_PATH for cuDNN 8 libraries.")
        print("  Run with: export LD_LIBRARY_PATH=/home/mafiq/cudnn8/cudnn-linux-sbsa-8.9.7.29_cuda12-archive/lib:$LD_LIBRARY_PATH")


if __name__ == "__main__":
    main()
