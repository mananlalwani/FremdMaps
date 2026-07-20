# Navigation-data contributor workflow

Navigation data is static JSON in `client/public/data/floor*/`. It is public project content and is
loaded directly by the browser, so edit carefully and retain the approved source for every change.

## Files and coordinate system

Each floor contains three files:

| File         | Purpose                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `nodes.json` | Searchable rooms, invisible waypoints, bathrooms, and stairway portals. |
| `walls.json` | Wall polylines that block visibility-graph edges.                       |
| `zones.json` | Rectangular traffic zones that multiply route edge costs.               |

The map uses Leaflet Simple CRS: `lat` is the image Y-axis and `lng` is the image X-axis. Wall entries
are polylines of two or more `[lat, lng]` points; a two-point polyline is one wall segment.

## Editing rules

1. Keep each node's `uid` stable and unique across the project. The containing `floor<N>` directory
   determines its floor at load time; an optional on-disk `floor` value must match that directory.
   Give nodes accurate `rooms` and `type` values; waypoints are intentionally not searchable.
   Add optional `searchAliases` only for alternate search terms (such as Spanish names); keep
   `rooms` aligned with the official labels shown on the floor plan.
2. For stairways, use `type: "stairway"` and matching `connectsTo` names on every linked floor. Verify
   the resulting cross-floor route after changing a portal.
3. Keep walls aligned to the floor-plan image. Do not add duplicate consecutive wall points.
4. Keep traffic-zone bounds inside the image and use an intensity in the validator's supported range.
5. For any wall change, inspect affected routes and retain the approved source and rationale with the
   pull request.

## Validate a change

```bash
pnpm run validate:data
node scripts/validate-data.mjs --report=json
pnpm run build
pnpm test
pnpm run test:e2e
```

Resolve every validation failure, unreachable or isolated node, and canonical-route failure. Keep
`scripts/canonical-routes.json` aligned with supported rooms and stairways; it validates data but is
not a public runtime asset.

Floor-plan images are shipped as optimized PNG overlays. Keep replacement images aligned to the
existing Simple CRS coordinate system and validate routes after changing them.
