
import cv2
import numpy as np
import json
import os

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_PATH = os.path.join(SCRIPT_DIR, '../../aviocl.png')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, '../data/walls.json')
IMAGE_WIDTH = 6050
IMAGE_HEIGHT = 4675

def detect_walls():
    # Read image
    img = cv2.imread(IMAGE_PATH)
    if img is None:
        print(f"Error: Could not read image at {IMAGE_PATH}")
        return

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Threshold to get black lines
    # Adjust 50 based on darkness of walls
    _, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)

    # Use probabilistic Hough transform to find lines
    lines = cv2.HoughLinesP(thresh, 1, np.pi/180, threshold=50, minLineLength=20, maxLineGap=10)

    walls = []
    
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            
            # Convert to Leaflet coordinates (Simple CRS)
            # Leaflet (0,0) is usually top-left in standard image overlay, 
            # but in our Map.astro configuration:
            # bounds = [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]];
            # This implies:
            #   Top-Left (Image 0,0) -> Leaflet (0, 0)
            #   Bottom-Left (Image 0, H) -> Leaflet (-H, 0)
            #   Top-Right (Image W, 0) -> Leaflet (0, W)
            
            # Wait, looking at Map.astro:
            # bounds = [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]];
            # This means y goes from -4675 (bottom?) to 0 (top).
            # Usually in computer graphics y=0 is top.
            # So Image (x, y) -> Leaflet (-y, x) ? No.
            
            # Let's re-read map config:
            # L.imageOverlay(url, bounds) usually maps URL to bounds.
            # If bounds are [[-H, 0], [0, W]], then:
            # South-West is (-H, 0)
            # North-East is (0, W)

            # In standard Leaflet Coordinate system (Lat, Lng):
            # Lat is Y, Lng is X.
            # So (-H, 0) is Lat=-H, Lng=0.
            # (0, W) is Lat=0, Lng=W.
            
            # Image (0,0) [Top-Left] maps to Lat=0, Lng=0.
            # Image (0, H) [Bottom-Left] maps to Lat=-H, Lng=0.
            # Image (W, 0) [Top-Right] maps to Lat=0, Lng=W.
            # Image (W, H) [Bottom-Right] maps to Lat=-H, Lng=W.
            
            # So transformation is:
            # Leaflet Lat = -Image Y
            # Leaflet Lng = Image X
            
            wall_segment = [
                [int(-y1), int(x1)], 
                [int(-y2), int(x2)]
            ]
            walls.append(wall_segment)

    print(f"Detected {len(walls)} wall segments.")

    # Save to JSON
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(walls, f, indent=2)
    
    print(f"Saved to {OUTPUT_PATH}")

if __name__ == "__main__":
    detect_walls()
