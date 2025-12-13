# Threshold Adjustment Tools

This folder contains tools for visualizing and tuning quality scoring thresholds.

**No face detection** - just draws fixed-size boxes to help you see what different pixel sizes look like, and measures brightness/sharpness at various locations.

## Usage

```bash
cd /home/mafiq/zmisc/client
source .venv/bin/activate

# Run visualization
python adjust_thresholds/visualize_thresholds.py
```

## Output

The script captures a frame from the camera and generates:

1. **`size_boxes_*.jpg`** - Shows boxes of different pixel sizes (50, 70, 100, 130, 150px) centered in the frame
2. **`brightness_samples_*.jpg`** - Shows brightness values at 5 locations (80x80px boxes)
3. **`sharpness_samples_*.jpg`** - Shows sharpness (Laplacian variance) at 5 locations
4. **`contrast_samples_*.jpg`** - Shows contrast (std dev) at 5 locations

## Tuning Workflow

1. Run the script (no need for someone in front of camera)
2. Check the output images in `adjust_thresholds/output/`
3. Based on the visualizations, adjust thresholds in `config.py`:

```python
QUALITY_THRESHOLDS = {
    'face_size': {
        'critical_px': 50,      # Adjust based on size_boxes image
        'good_px': 100,
    },
    'sharpness': {
        'critical': 50,         # Adjust based on sharpness_thresholds image
        'good': 300,
    },
    # ... etc
}
```

4. Re-run the script to verify your changes

## Cleanup

When done tuning, you can delete this entire folder:
```bash
rm -rf /home/mafiq/zmisc/client/adjust_thresholds
```
