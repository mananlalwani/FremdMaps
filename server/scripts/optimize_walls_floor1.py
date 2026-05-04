#!/usr/bin/env python3
"""
Wall Optimization Script for Floor 1

Merges collinear wall segments to reduce data size.
Reduces ~5,656 segments to ~1,000 by combining parallel adjacent lines.
"""

import json
import math
import os
from typing import List, Tuple

Point = Tuple[float, float]  # (lat, lng)
Wall = Tuple[Point, Point]   # (start, end)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_PATH = os.path.join(SCRIPT_DIR, '../data/floor1/walls.json')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, '../data/floor1/walls_optimized.json')

# Tolerance values
ANGLE_TOLERANCE = 2.0  # degrees
DISTANCE_TOLERANCE = 10.0  # pixels
COLLINEAR_TOLERANCE = 5.0  # pixels


def load_walls(path: str) -> List[Wall]:
    """Load walls from JSON file."""
    with open(path, 'r') as f:
        data = json.load(f)
    
    walls = []
    for wall in data:
        if len(wall) == 2 and len(wall[0]) == 2 and len(wall[1]) == 2:
            walls.append((tuple(wall[0]), tuple(wall[1])))
    
    return walls


def save_walls(walls: List[Wall], path: str):
    """Save walls to JSON file."""
    data = [[[w[0][0], w[0][1]], [w[1][0], w[1][1]]] for w in walls]
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Saved {len(walls)} walls to {path}")


def get_angle(wall: Wall) -> float:
    """Calculate angle of wall in degrees (0-180)."""
    (lat1, lng1), (lat2, lng2) = wall
    
    # Calculate angle from horizontal
    dx = lng2 - lng1
    dy = lat2 - lat1
    
    if dx == 0 and dy == 0:
        return 0
    
    angle = math.atan2(dy, dx) * 180 / math.pi
    
    # Normalize to 0-180 (treat lines as bidirectional)
    if angle < 0:
        angle += 180
    
    return angle


def walls_are_parallel(w1: Wall, w2: Wall, tolerance: float) -> bool:
    """Check if two walls are parallel within tolerance."""
    angle1 = get_angle(w1)
    angle2 = get_angle(w2)
    
    diff = abs(angle1 - angle2)
    
    # Account for wrap-around at 180
    if diff > 90:
        diff = 180 - diff
    
    return diff <= tolerance


def point_to_line_distance(point: Point, line_start: Point, line_end: Point) -> float:
    """Calculate perpendicular distance from point to line."""
    (lat, lng) = point
    (lat1, lng1) = line_start
    (lat2, lng2) = line_end
    
    # Vector from line_start to line_end
    dx = lng2 - lng1
    dy = lat2 - lat1
    
    # Handle degenerate case (point line)
    if dx == 0 and dy == 0:
        return math.sqrt((lng - lng1) ** 2 + (lat - lat1) ** 2)
    
    # Perpendicular distance formula
    numerator = abs(dy * lng - dx * lat + lng2 * lat1 - lat2 * lng1)
    denominator = math.sqrt(dx ** 2 + dy ** 2)
    
    return numerator / denominator


def walls_are_collinear(w1: Wall, w2: Wall, tolerance: float) -> bool:
    """Check if two walls lie on the same line."""
    # Check if endpoints of w2 are close to the line formed by w1
    dist1 = point_to_line_distance(w2[0], w1[0], w1[1])
    dist2 = point_to_line_distance(w2[1], w1[0], w1[1])
    
    return dist1 <= tolerance and dist2 <= tolerance


def distance_between_points(p1: Point, p2: Point) -> float:
    """Calculate Euclidean distance between two points."""
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def segments_overlap_or_adjacent(w1: Wall, w2: Wall, gap_tolerance: float) -> bool:
    """Check if two collinear segments overlap or are adjacent."""
    # Get all endpoints
    points = [w1[0], w1[1], w2[0], w2[1]]
    
    # Find min distance between any endpoint of w1 and any endpoint of w2
    min_dist = min(
        distance_between_points(w1[0], w2[0]),
        distance_between_points(w1[0], w2[1]),
        distance_between_points(w1[1], w2[0]),
        distance_between_points(w1[1], w2[1])
    )
    
    # Get maximum extent of each segment
    w1_length = distance_between_points(w1[0], w1[1])
    w2_length = distance_between_points(w2[0], w2[1])
    
    # If endpoints are close, segments are adjacent or overlapping
    return min_dist <= max(w1_length, w2_length) + gap_tolerance


def merge_two_walls(w1: Wall, w2: Wall) -> Wall:
    """Merge two collinear walls into a single wall spanning both."""
    # Get all four endpoints
    points = [w1[0], w1[1], w2[0], w2[1]]
    
    # Determine the direction of the line
    angle = get_angle(w1)
    
    # Project points onto the line and find extremes
    if abs(angle - 0) < 45 or abs(angle - 180) < 45:
        # Mostly horizontal - sort by lng
        points.sort(key=lambda p: p[1])
    else:
        # Mostly vertical - sort by lat
        points.sort(key=lambda p: p[0])
    
    # Return wall from min to max extent
    return (points[0], points[-1])


def optimize_walls(walls: List[Wall], 
                   angle_tol: float, 
                   collinear_tol: float,
                   distance_tol: float) -> List[Wall]:
    """
    Optimize walls by merging collinear segments.
    
    Algorithm:
    1. Group walls by angle
    2. Within each angle group, find collinear segments
    3. Merge adjacent/overlapping collinear segments
    """
    print(f"Starting with {len(walls)} walls")
    
    # Filter out degenerate walls (zero length)
    walls = [w for w in walls if w[0] != w[1]]
    print(f"After removing degenerate walls: {len(walls)}")
    
    # Group walls by angle
    angle_groups = {}
    for wall in walls:
        angle = round(get_angle(wall) / angle_tol) * angle_tol
        if angle not in angle_groups:
            angle_groups[angle] = []
        angle_groups[angle].append(wall)
    
    print(f"Grouped into {len(angle_groups)} angle groups")
    
    # Merge within each angle group
    merged_walls = []
    
    for angle, group in angle_groups.items():
        # Keep merging until no more merges possible
        changed = True
        current_walls = group[:]
        
        while changed:
            changed = False
            new_walls = []
            merged_indices = set()
            
            for i, w1 in enumerate(current_walls):
                if i in merged_indices:
                    continue
                
                # Try to find a wall to merge with
                merged = False
                for j, w2 in enumerate(current_walls[i+1:], start=i+1):
                    if j in merged_indices:
                        continue
                    
                    # Check if walls can be merged
                    if (walls_are_parallel(w1, w2, angle_tol) and
                        walls_are_collinear(w1, w2, collinear_tol) and
                        segments_overlap_or_adjacent(w1, w2, distance_tol)):
                        
                        # Merge the walls
                        merged_wall = merge_two_walls(w1, w2)
                        new_walls.append(merged_wall)
                        merged_indices.add(i)
                        merged_indices.add(j)
                        merged = True
                        changed = True
                        break
                
                if not merged:
                    new_walls.append(w1)
                    merged_indices.add(i)
            
            current_walls = new_walls
        
        merged_walls.extend(current_walls)
    
    print(f"After merging: {len(merged_walls)} walls")
    
    return merged_walls


def remove_duplicates(walls: List[Wall]) -> List[Wall]:
    """Remove duplicate walls."""
    unique = set()
    result = []
    
    for wall in walls:
        # Normalize wall direction (smaller point first)
        normalized = tuple(sorted([wall[0], wall[1]]))
        
        if normalized not in unique:
            unique.add(normalized)
            result.append(wall)
    
    return result


def main():
    print("=" * 60)
    print("Floor 1 Wall Optimization Script")
    print("=" * 60)
    
    # Load walls
    print(f"\nLoading walls from {INPUT_PATH}")
    walls = load_walls(INPUT_PATH)
    print(f"Loaded {len(walls)} walls")
    
    # Remove duplicates first
    print("\nRemoving duplicates...")
    walls = remove_duplicates(walls)
    print(f"After duplicate removal: {len(walls)} walls")
    
    # Optimize
    print(f"\nOptimizing walls...")
    print(f"  Angle tolerance: {ANGLE_TOLERANCE}°")
    print(f"  Collinear tolerance: {COLLINEAR_TOLERANCE} pixels")
    print(f"  Distance tolerance: {DISTANCE_TOLERANCE} pixels")
    
    optimized = optimize_walls(
        walls,
        ANGLE_TOLERANCE,
        COLLINEAR_TOLERANCE,
        DISTANCE_TOLERANCE
    )
    
    # Save results
    print(f"\nSaving optimized walls to {OUTPUT_PATH}")
    save_walls(optimized, OUTPUT_PATH)
    
    # Summary
    reduction = (1 - len(optimized) / len(walls)) * 100
    print("\n" + "=" * 60)
    print(f"Original walls: {len(walls)}")
    print(f"Optimized walls: {len(optimized)}")
    print(f"Reduction: {reduction:.1f}%")
    print("=" * 60)


if __name__ == "__main__":
    main()
