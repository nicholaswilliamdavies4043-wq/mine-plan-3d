# Build progress

## Update (2 Nov 2026): offline mode, measurements, PostgreSQL

- **Upload card fix**: the "Add a plan" card no longer overflows. The drop zone text wraps, long file names are shortened with an ellipsis, and the name and RL fields share a grid that can shrink.
- **Offline**:
  - IndexedDB cache and change queue with optimistic updates; the sync engine replays the queue with a three-way merge.
  - The service worker caches the app shell, plan images and model files.
  - Checked in Chromium (Playwright):
    - The editor reloads while offline.
    - Measurements, a new project, a plan upload and scale changes made offline all sync when the connection is back.
    - A stope and a measurement added on the server in the meantime are kept.
- **Measurements**:
  - Plan editor: known-distance calibration (K), Line and Polyline measure (L), units, CSV export.
  - 3D model: Tools tab for measuring in Overview and Walk.
  - Measurements are drawn on the drive walls (tape, ticks, signs).
  - Checked in Walk mode in Chromium.
- **PostgreSQL**:
  - Built-in node-postgres store and blob storage; tables are created automatically; TLS for Render.
  - Status endpoint `/api/system/status` and a Data source page; `render.yaml` blueprint; `npm run db:import`.
  - Tested against PostgreSQL 16: CRUD, detection, export/import, replay of offline ids, TLS, and the database being down (503).
- **Walk mode fix**: only clicks on the 3D view capture the mouse, so the side panel works while walking.
- 19 unit tests pass (merge, measurement helpers and wall layout added).

Not verified: a real Render deployment (no Render account in the build sandbox). The connection handling was tested with local PostgreSQL, with and without TLS.


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
