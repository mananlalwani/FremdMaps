# School Navigation

FremdMaps models indoor travel through a multi-floor school. Its language distinguishes stored map facts, a calculated route, and the route currently shown to a visitor.

## Language

**Destination**:
A named place a visitor can travel to. One destination may refer to several nodes on different floors when those nodes share the same room name or alias.
_Avoid_: Room result, endpoint

**Origin**:
The named place where a route plan begins. An explicit visitor selection identifies one node; otherwise an origin may refer to several matching nodes.
_Avoid_: Start room, source node

**Navigation data**:
The nodes, walls, stairway connections, and traffic zones that describe where travel is possible. A change to any of these facts creates a new coherent revision.
_Avoid_: Map data, graph data

**Limited revision**:
A coherent navigation-data revision for one floor, used only when the complete multi-floor navigation data cannot be loaded. It cannot support cross-floor route plans.
_Avoid_: Partial data, fallback state

**Route plan**:
A reachable path from an origin to a destination, including its weighted cost and any floor transitions. Explicit selections pin individual nodes; otherwise the plan prefers the shortest reachable same-floor pair before considering cross-floor pairs.
_Avoid_: Path result, directions

**Active route**:
The route plan currently presented to the visitor across the visible floor, transition cue, and turn-by-turn directions.
_Avoid_: Current path, route display

**Traffic zone**:
An area whose intensity increases the weighted cost of travel through it.

**Stairway**:
A destination node that links floors and permits a route plan to transition between them.
