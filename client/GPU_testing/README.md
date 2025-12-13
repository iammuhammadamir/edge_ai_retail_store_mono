# GPU Testing for InsightFace

This folder contains scripts to verify GPU acceleration is working for InsightFace models.

## Usage

```bash
cd /home/mafiq/zmisc/client
source .venv/bin/activate

python GPU_testing/test_gpu.py
```

## What it tests

1. **ONNX Runtime** - Checks if CUDAExecutionProvider is available
2. **buffalo_s** (small model) - Tests on CPU and GPU
3. **buffalo_l** (large model) - Tests on CPU and GPU

## Expected output

If GPU is working, you should see:
- GPU times significantly faster than CPU times (2-5x speedup)
- "✓ GPU acceleration is WORKING!" message

If GPU is NOT working:
- GPU times similar to or slower than CPU
- "✗ GPU may not be working properly" message

## Cleanup

When done testing, delete this folder:
```bash
rm -rf /home/mafiq/zmisc/client/GPU_testing
```
