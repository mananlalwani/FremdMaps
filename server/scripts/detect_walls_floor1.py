#!/usr/bin/env python3
"""
Wall Detection Script for Floor 1

Detects walls from the floor1.png image using OpenCV edge detection
and Hough line transform, then converts to Leaflet Simple CRS coordinates.
"""

import cv2
import numpy as np
import json
import os

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_PATH = os.path.join(SCRIPT_DIR, '../../client/public/floor1.png')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, '../data/floor1/walls.json')
IMAGE_WIDTH = 6050
IMAGE_HEIGHT = 4675

def detect_walls():
    print("=" * 60)
    print("Floor 1 Wall Detection")
    print("=" * 60)
    print(f"Image: {IMAGE_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Dimensions: {IMAGE_WIDTH}x{IMAGE_HEIGHT}")
    print()
    
    # Read image
    print("Reading image...")
    img = cv2.imread(IMAGE_PATH)
    if img is None:
        print(f"Error: Could not read image at {IMAGE_PATH}")
        return

    print(f"Image loaded: {img.shape}")
    
    # Convert to grayscale
    print("Converting to grayscale...")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Threshold to get black lines
    # Adjust 50 based on darkness of walls
    print("Applying threshold to detect dark lines...")
    _, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)

    # Use probabilistic Hough transform to find lines
    print("Running Hough line detection...")
    lines = cv2.HoughLinesP(
        thresh, 
        rho=1, 
        theta=np.pi/180, 
        threshold=50, 
        minLineLength=20, 
        maxLineGap=10
    )

    walls = []
    
    if lines is not None:
        print(f"Found {len(lines)} line segments")
        
        for line in lines:
            x1, y1, x2, y2 = line[0]
            
            # Convert to Leaflet coordinates (Simple CRS)
            # Coordinate transformation:
            # - Leaflet bounds: [[-IMAGE_HEIGHT, 0], [0, IMAGE_WIDTH]]
            # - Image (0,0) [Top-Left] -> Leaflet (Lat=0, Lng=0)
            # - Image (0, H) [Bottom-Left] -> Leaflet (Lat=-H, Lng=0)
            # - Image (W, 0) [Top-Right] -> Leaflet (Lat=0, Lng=W)
            # - Image (W, H) [Bottom-Right] -> Leaflet (Lat=-H, Lng=W)
            #
            # Transformation:
            # - Leaflet Lat = -Image Y
            # - Leaflet Lng = Image X
            
            wall_segment = [
                [int(-y1), int(x1)], 
                [int(-y2), int(x2)]
            ]
            walls.append(wall_segment)
    else:
        print("Warning: No lines detected!")

    print(f"\nDetected {len(walls)} wall segments.")

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    # Save to JSON
    print(f"Saving to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(walls, f, indent=2)
    
    print("=" * 60)
    print(f"SUCCESS: Saved {len(walls)} walls to {OUTPUT_PATH}")
    print("=" * 60)

if __name__ == "__main__":
    detect_walls()
