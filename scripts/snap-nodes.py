"""Safely align navigation nodes into nearby horizontal and vertical groups.

By default the script previews changes only. Use ``--write`` to update files;
``--backup`` additionally writes a ``.bak`` copy before each replacement.

Usage:
  python3 scripts/snap-nodes.py
  python3 scripts/snap-nodes.py --write --backup
  python3 scripts/snap-nodes.py --floor 1 --threshold 40 --write
"""

import argparse
import json
import shutil
import statistics
from pathlib import Path

DEFAULT_THRESHOLD = 50.0
DATA_ROOT = Path(__file__).parent.parent / 'client' / 'public' / 'data'


def discover_floors() -> list[str]:
    """Return numeric floor IDs found in the data directory."""
    return sorted(
        (path.name.removeprefix('floor') for path in DATA_ROOT.glob('floor*')
         if path.is_dir() and path.name.removeprefix('floor').isdigit()),
        key=int,
    )


def cluster(values: list[float], threshold: float) -> list[list[int]]:
    """Group values within ``threshold`` of the group's first value.

    Using an absolute span prevents chained clustering: 0, 40, 80 with a 50px
    threshold becomes [0, 40] and [80], rather than one 80px-wide group.
    """
    if not values:
        return []

    indexed = sorted(enumerate(values), key=lambda item: item[1])
    groups: list[list[int]] = []
    current = [indexed[0][0]]
    group_start = indexed[0][1]

    for index, value in indexed[1:]:
        if value - group_start <= threshold:
            current.append(index)
            continue
        groups.append(current)
        current = [index]
        group_start = value
    groups.append(current)
    return groups


def snap_axis(nodes: list[dict], axis: str, threshold: float) -> tuple[int, list[tuple[int, float, float]]]:
    """Snap groups on one coordinate axis to their median value."""
    groups = cluster([node[axis] for node in nodes], threshold)
    changes: list[tuple[int, float, float]] = []
    snapped_groups = 0

    for group in groups:
        if len(group) < 2:
            continue
        median = statistics.median(nodes[index][axis] for index in group)
        snapped_groups += 1
        for index in group:
            old_value = nodes[index][axis]
            if old_value != median:
                changes.append((index, old_value, median))
                nodes[index][axis] = median

    return snapped_groups, changes


def process_floor(floor_id: str, threshold: float, write: bool, backup: bool) -> int:
    path = DATA_ROOT / f'floor{floor_id}' / 'nodes.json'
    if not path.exists():
        print(f'  [skip] {path} not found')
        return 0

    with path.open(encoding='utf-8') as handle:
        nodes = json.load(handle)
    if not isinstance(nodes, list):
        raise ValueError(f'{path} must contain an array')
    if not nodes:
        print(f'\nFloor {floor_id}: 0 nodes (nothing to snap)')
        return 0
    if any(not isinstance(node, dict) or 'lat' not in node or 'lng' not in node for node in nodes):
        raise ValueError(f'{path} contains a node without lat/lng coordinates')

    print(f'\nFloor {floor_id}: {len(nodes)} nodes')
    row_groups, lat_changes = snap_axis(nodes, 'lat', threshold)
    column_groups, lng_changes = snap_axis(nodes, 'lng', threshold)
    changes = [('lat', *change) for change in lat_changes] + [('lng', *change) for change in lng_changes]
    print(f'  Rows:    {row_groups} groups snapped, {len(lat_changes)} node(s) moved')
    print(f'  Columns: {column_groups} groups snapped, {len(lng_changes)} node(s) moved')
    for axis, index, old, new in changes:
        rooms = ', '.join(nodes[index].get('rooms', ['unnamed']))
        print(f'    [{rooms}] {axis} {old:.2f} -> {new:.2f}')

    if not changes:
        return 0
    if not write:
        print('  [dry-run] No file written. Re-run with --write to apply these changes.')
        return len(changes)

    if backup:
        backup_path = path.with_suffix('.json.bak')
        shutil.copy2(path, backup_path)
        print(f'  Backup:  {backup_path}')
    with path.open('w', encoding='utf-8') as handle:
        json.dump(nodes, handle, indent=2)
        handle.write('\n')
    print(f'  Written: {path}')
    return len(changes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--floor', action='append', dest='floors', help='Floor ID to process (repeatable)')
    parser.add_argument('--threshold', type=float, default=DEFAULT_THRESHOLD, help='Maximum group span in pixels')
    parser.add_argument('--write', action='store_true', help='Write changes; default is a dry run')
    parser.add_argument('--backup', action='store_true', help='Create .json.bak files before writing (requires --write)')
    args = parser.parse_args()

    if args.threshold <= 0:
        parser.error('--threshold must be greater than zero')
    if args.backup and not args.write:
        parser.error('--backup requires --write')

    floors = args.floors or discover_floors()
    if not floors:
        parser.error(f'No floor data directories found under {DATA_ROOT}')

    total_changes = sum(process_floor(floor, args.threshold, args.write, args.backup) for floor in floors)
    action = 'Applied' if args.write else 'Previewed'
    print(f'\n{action} {total_changes} coordinate change(s).')
    if args.write:
        print('Run `pnpm run validate:data` before committing the updated navigation data.')


if __name__ == '__main__':
    main()
