#!/bin/bash
# Wrapper script to run visitor_counter.py with GPU support
# This sets up cuDNN 8 libraries needed for ONNX Runtime GPU

export LD_LIBRARY_PATH=/home/mafiq/cudnn8/cudnn-linux-sbsa-8.9.7.29_cuda12-archive/lib:$LD_LIBRARY_PATH

# Activate venv and run
source /home/mafiq/zmisc/.venv/bin/activate
cd /home/mafiq/zmisc/edge_ai_retail_store_mono/client
python visitor_counter.py "$@"
