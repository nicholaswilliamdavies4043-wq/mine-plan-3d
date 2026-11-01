# Build progress

## Status (1 Nov 2026): working MVP

- All three workspaces pass the type check, and all 9 unit tests pass.
- The client builds with `vite build`.
- The API was tested end to end:
  - Projects, plan upload and detection on the 445 S6S7 sheet.
  - Kits.
  - Asset import, including the licence check and file serving.
- The built client is served by the API, including SPA routes.
- On the sample plan, assembly produced 176 drive segments (about 2.7 km at 0.55 m/px), 431 straight modules, 188 fitted connectors and 93 dead ends. The geometry was checked for NaN values and the footprint looks right.

Not yet verified: the 3D viewer and the import wizard haven't been run in a real browser, because no browser was available in the build sandbox. Check these first after `npm run dev`.

## Next steps (suggested)

1. Browser check: walk-through controls, asset preview and thumbnail capture, GLB export.
2. Generate and migrate Prisma against a real PostgreSQL. This wasn't possible in the build sandbox because Prisma engine downloads were blocked.
3. Detection on low-resolution scans: gaps where annotation (brow markers, hatching) crosses a drive are fixed by hand today. Options: a larger bridge distance, or learning the annotation symbols.
4. Multi-level: ramps and shafts that connect plans at different RLs.
5. PDF plan upload (rasterise on the server).
6. Lighting and infrastructure presets, and level-of-detail for very large mines.
