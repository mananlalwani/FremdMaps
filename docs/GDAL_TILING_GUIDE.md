# GDAL Tiling Guide

This document explains how to convert floor plan PNGs into tiled web maps using GDAL.

## ⚠️ Current Implementation

**We are NOT using GDAL tiles** in the current implementation. The app uses `L.imageOverlay` with optimized PNGs instead, because:

1. **Coordinate alignment** - imageOverlay maintains pixel-perfect alignment with node/wall coordinates
2. **Simplicity** - No coordinate system transformations needed
3. **Performance** - With optimized PNGs (8-bit compression), load times are acceptable
4. **Proven** - This approach was chosen after experiencing coordinate misalignment issues with tiles

## When to Use GDAL Tiles

Consider using GDAL tiles if:
- Floor plan images exceed 10MB even after optimization
- Users frequently zoom into small areas (tiles load only visible regions)
- You can verify coordinate alignment matches the tile coordinate system

## GDAL Tiling Process

### Prerequisites

```bash
# Install GDAL tools (already installed on this system)
sudo apt-get install gdal-bin  # Ubuntu/Debian
brew install gdal              # macOS

# Verify installation
gdal_translate --version
gdal2tiles.py --version
```

### Step 1: Optimize PNG (Reduce File Size)

```bash
# Convert 16-bit to 8-bit (reduces size by ~50%)
convert input.png -depth 8 -colors 256 output_8bit.png

# Example from this project:
convert floorone.png -depth 8 -colors 256 floorone_optimized.png
# Result: 7.6MB → 957KB (87% reduction)
```

### Step 2: Convert PNG to GeoTIFF

```bash
# Add georeferencing metadata
# -a_ullr: Upper-left X, Upper-left Y, Lower-right X, Lower-right Y
# For 6050x4675 pixel image:
gdal_translate -of GTiff -a_srs EPSG:3857 \
  -a_ullr 0 0 6050 4675 \
  floorone_optimized.png floorone.tif
```

### Step 3: Generate Tile Pyramid

```bash
# Generate tiles in XYZ format
gdal2tiles.py -p raster -z 0-6 -w none floorone.tif tiles/floor1/

# Parameters:
# -p raster: Non-geographic raster (for floor plans)
# -z 0-6: Zoom levels (adjust based on image size)
# -w none: No web viewer HTML files
# tiles/floor1/: Output directory
```

**Output structure:**
```
tiles/floor1/
├── 0/0/0.png
├── 1/0/0.png
├── 1/0/1.png
├── 2/...
└── tilemapresource.xml
```

### Step 4: Move Tiles to Public Directory

```bash
# Copy to Astro public folder
cp -r tiles/floor1/ client/public/tiles/floor1/
```

### Step 5: Update Map.astro to Use Tiles

**Current approach (imageOverlay):**
```typescript
const bounds = [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]];
L.imageOverlay("/floor1.png", bounds).addTo(map);
```

**Tile approach (if switching):**
```typescript
const bounds = [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]];
map.setMaxBounds(bounds);

L.tileLayer('/tiles/floor1/{z}/{x}/{y}.png', {
    minZoom: 0,
    maxZoom: 6,
    noWrap: true,
    tms: false,  // GDAL uses XYZ tile scheme
    bounds: bounds
}).addTo(map);
```

## Coordinate System Issues

### The Problem

GDAL tiles use a different coordinate origin than Leaflet Simple CRS:

**Leaflet Simple CRS (current):**
- Origin: Top-left (0, 0)
- Y-axis: Inverted (negative values go down)
- Coordinates: `lat=-2296, lng=1932` maps to pixel (1932, 2296)

**GDAL TMS:**
- Origin: Bottom-left
- Y-axis: Normal (positive up)
- Requires coordinate transformation

### The Solution (If Using Tiles)

You must transform all node/wall coordinates when switching to tiles:

```typescript
// Transform function
function transformToTileCoords(lat: number, lng: number) {
    // Flip Y-axis for TMS
    return {
        lat: lat, // or IMAGE_HEIGHT + lat depending on tile system
        lng: lng
    };
}
```

**This is complex and error-prone**, which is why we use imageOverlay instead.

## File Size Comparison

| Method | Floor 1 | Floor 2 | Total | Load Time (4G) |
|--------|---------|---------|-------|----------------|
| **Original PNG** | 7.6MB | 3.6MB | 11.2MB | 15-20s |
| **Optimized PNG (current)** | 957KB | 3.6MB | 4.6MB | 5-7s ✅ |
| **GDAL Tiles** | ~2MB | ~5MB | ~7MB | 2-3s (initial) |

## Conclusion

**Recommendation:** Stick with optimized imageOverlay approach unless you have specific performance requirements that justify the complexity of coordinate transformation.

If you do switch to tiles, thoroughly test that:
1. Node markers appear at correct room locations
2. Walls align with floor plan walls
3. Pathfinding routes follow hallways accurately

## Additional Resources

- [GDAL Documentation](https://gdal.org/)
- [Leaflet TileLayer Docs](https://leafletjs.com/reference.html#tilelayer)
- [Leaflet CRS Simple](https://leafletjs.com/examples/crs-simple/crs-simple.html)
