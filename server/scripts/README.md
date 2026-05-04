# Wall Extraction Scripts - Quick Reference

This document explains how to run the Python wall extraction scripts for each floor.

## Prerequisites

- Python 3 with OpenCV (`cv2`) and NumPy installed
- Floor plan images in `client/public/` directory
- Image dimensions: 6050 x 4675 pixels (standard for this project)

## Scripts Overview

### 1. Wall Detection Scripts
Extract wall segments from floor plan images using OpenCV Hough Line Transform.

**Floor 1:**
```bash
cd /home/manan/SchoolNavigationApp/server/scripts
python3 detect_walls_floor1.py
```

**Floor 2:**
```bash
cd /home/manan/SchoolNavigationApp/server/scripts
python3 detect_walls.py
```

### 2. Wall Optimization Scripts
Merge collinear/adjacent segments to reduce file size (typically 50% reduction).

**Floor 1:**
```bash
cd /home/manan/SchoolNavigationApp/server/scripts
python3 optimize_walls_floor1.py
```

**Floor 2:**
```bash
cd /home/manan/SchoolNavigationApp/server/scripts
python3 optimize_walls.py
```

## Adding a New Floor

To add a new floor (e.g., Floor 3):

1. **Add floor image:**
   ```bash
   cp /path/to/floor3.png /home/manan/SchoolNavigationApp/client/public/floor3.png
   ```

2. **Create data directory:**
   ```bash
   mkdir -p /home/manan/SchoolNavigationApp/server/data/floor3
   echo '[]' > /home/manan/SchoolNavigationApp/server/data/floor3/nodes.json
   ```

3. **Copy and modify detection script:**
   ```bash
   cd /home/manan/SchoolNavigationApp/server/scripts
   cp detect_walls_floor1.py detect_walls_floor3.py
   ```
   
   Edit `detect_walls_floor3.py`:
   - Change `IMAGE_PATH` to `../../client/public/floor3.png`
   - Change `OUTPUT_PATH` to `../data/floor3/walls.json`

4. **Run detection:**
   ```bash
   python3 detect_walls_floor3.py
   ```

5. **Copy and modify optimization script:**
   ```bash
   cp optimize_walls_floor1.py optimize_walls_floor3.py
   ```
   
   Edit `optimize_walls_floor3.py`:
   - Change `INPUT_PATH` to `../data/floor3/walls.json`
   - Change `OUTPUT_PATH` to `../data/floor3/walls_optimized.json`

6. **Run optimization:**
   ```bash
   python3 optimize_walls_floor3.py
   ```

7. **Update constants.ts:**
   Edit `/home/manan/SchoolNavigationApp/client/src/utils/constants.ts`:
   ```typescript
   export const FLOORS = {
     DEFAULT: '2',
     AVAILABLE: [
       { id: '1', name: 'Floor 1', image: '/floor1.png' },
       { id: '2', name: 'Floor 2', image: '/floor2.png' },
       { id: '3', name: 'Floor 3', image: '/floor3.png' }, // Add this
     ],
   } as const;
   ```

## Tuning Wall Detection

If wall detection quality is poor, adjust these parameters in `detect_walls_floorX.py`:

```python
# Line 26: Threshold for detecting black lines (0-255)
# Lower = more sensitive, detects lighter lines
# Higher = less sensitive, only darkest lines
_, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)

# Line 29: Hough Transform parameters
lines = cv2.HoughLinesP(
    thresh, 
    rho=1,              # Distance resolution (pixels)
    theta=np.pi/180,    # Angle resolution (radians)
    threshold=50,       # Min votes for a line
    minLineLength=20,   # Min line length (pixels)
    maxLineGap=10       # Max gap to bridge (pixels)
)
```

**Common adjustments:**
- **Too many small segments:** Increase `minLineLength` (e.g., 30-40)
- **Missing walls:** Lower `threshold` (e.g., 30-40)
- **Gaps in walls:** Increase `maxLineGap` (e.g., 15-20)

## Tuning Optimization

Adjust these parameters in `optimize_walls_floorX.py`:

```python
# Line 22-24: Tolerance values
ANGLE_TOLERANCE = 2.0       # Max angle diff for parallel (degrees)
DISTANCE_TOLERANCE = 10.0   # Max gap between segments (pixels)
COLLINEAR_TOLERANCE = 5.0   # Max offset for collinear (pixels)
```

**Common adjustments:**
- **Too aggressive (losing detail):** Decrease all tolerances
- **Not enough reduction:** Increase tolerances
- **Preserving corners:** Keep `ANGLE_TOLERANCE` low (1-3°)

## Output Files

Each floor should have 3 files in `server/data/floorX/`:

1. **nodes.json** - Room/waypoint nodes (edited in Admin Mode)
2. **walls.json** - Raw detected wall segments
3. **walls_optimized.json** - Optimized/merged segments

## Troubleshooting

**"Could not read image":**
- Check image path is correct
- Verify image file exists and is readable
- Ensure image is a valid PNG/JPG

**"No lines detected":**
- Image might be too light/faded
- Try lowering threshold value (line 26)
- Check if image has clear black/dark lines

**OpenCV not installed:**
```bash
pip install opencv-python numpy
```

**Script permissions:**
```bash
chmod +x detect_walls_floor*.py optimize_walls_floor*.py
```

## Performance Notes

- **Detection time:** ~2-5 seconds per floor (6050x4675 image)
- **Optimization time:** ~10-30 seconds for 5,000+ segments
- **Typical reduction:** 50-60% fewer segments after optimization
- **File sizes:** 
  - Raw walls: 400-500 KB
  - Optimized walls: 200-250 KB

## Coordinate System

Leaflet Simple CRS mapping used:
- Image (0, 0) [Top-Left] → Leaflet (Lat=0, Lng=0)
- Image (W, H) [Bottom-Right] → Leaflet (Lat=-H, Lng=W)

**Transformation:**
```
Leaflet Lat = -Image Y
Leaflet Lng = Image X
```

This matches the bounds configuration in `Map.astro`:
```javascript
const bounds = [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]];
```
