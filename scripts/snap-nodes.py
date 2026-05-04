"""
snap-nodes.py
Snaps navigation nodes to straight rows (by lat) and columns (by lng).

Algorithm:
  1. Sort nodes by lat. Walk the sorted list; start a new row-group whenever
     the gap to the next node exceeds THRESHOLD. Snap every node in the group
     to the median lat of that group.
  2. Repeat independently for lng to straighten columns.

Usage:
  python3 scripts/snap-nodes.py
"""

import json
import statistics
from pathlib import Path

THRESHOLD = 50  # units — nodes within this distance share a row / column

DATA_ROOT = Path(__file__).parent.parent / "server" / "data"
FLOORS = ["1", "2"]


def cluster(values: list[float], threshold: float) -> list[list[int]]:
    """
    Given a list of floats, return groups of *indices* (into the original list)
    such that consecutive values (when sorted) within `threshold` of each other
    are in the same group.
    """
    indexed = sorted(enumerate(values), key=lambda x: x[1])
    groups: list[list[int]] = []
    current: list[int] = [indexed[0][0]]

    for k in range(1, len(indexed)):
        prev_val = indexed[k - 1][1]
        curr_val = indexed[k][1]
        if abs(curr_val - prev_val) <= threshold:
            current.append(indexed[k][0])
        else:
            groups.append(current)
            current = [indexed[k][0]]
    groups.append(current)
    return groups


def snap_axis(nodes: list[dict], axis: str) -> tuple[int, list[tuple]]:
    """
    Snap all nodes along `axis` ('lat' or 'lng') to the median of their group.
    Returns (number_of_groups_with_more_than_1_node, list_of_changes).
    """
    values = [n[axis] for n in nodes]
    groups = cluster(values, THRESHOLD)

    changes: list[tuple] = []  # (index, old_val, new_val)
    snapped_groups = 0

    for group in groups:
        if len(group) < 2:
            continue
        group_vals = [nodes[i][axis] for i in group]
        median_val = statistics.median(group_vals)
        snapped_groups += 1
        for i in group:
            old = nodes[i][axis]
            if old != median_val:
                changes.append((i, old, median_val))
                nodes[i][axis] = median_val

    return snapped_groups, changes


def process_floor(floor_id: str) -> None:
    path = DATA_ROOT / f"floor{floor_id}" / "nodes.json"
    if not path.exists():
        print(f"  [skip] {path} not found")
        return

    with open(path) as f:
        nodes = json.load(f)

    print(f"\nFloor {floor_id}: {len(nodes)} nodes")

    # --- lat pass (rows) ---
    row_groups, lat_changes = snap_axis(nodes, "lat")
    print(f"  Rows:    {row_groups} groups snapped, {len(lat_changes)} node(s) moved")
    for idx, old, new in lat_changes:
        rooms = ", ".join(nodes[idx]["rooms"])
        print(f"    [{rooms}]  lat {old:.2f} -> {new:.2f}")

    # --- lng pass (columns) ---
    col_groups, lng_changes = snap_axis(nodes, "lng")
    print(f"  Columns: {col_groups} groups snapped, {len(lng_changes)} node(s) moved")
    for idx, old, new in lng_changes:
        rooms = ", ".join(nodes[idx]["rooms"])
        print(f"    [{rooms}]  lng {old:.2f} -> {new:.2f}")

    with open(path, "w") as f:
        json.dump(nodes, f, indent=2)
    print(f"  Written: {path}")


if __name__ == "__main__":
    for floor in FLOORS:
        process_floor(floor)
    print("\nDone.")
