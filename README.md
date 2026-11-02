# Mine plan 3D

A web app that turns a 2D underground mine plan into a navigable 3D model. It builds the model from reusable tunnel modules rather than generating the whole mine from scratch.

1. Upload a plan image (PNG or JPEG), for example a tele-remote bogging plan.
2. Georeference it by clicking two grid intersections and typing their easting and northing. Rotated sheets are handled.
3. Select the portions to model and exclude the legend, title block and notes.
4. Run automatic detection of drive centrelines, junctions, dead ends and coloured stopes, then correct the result in the editor (draw, delete, move, undo).
5. Assemble the model from a tunnel kit: imported GLB modules, or the built-in parametric pieces where no asset fits.
6. Explore it in an overview (with the plan draped underneath) or walk through it first-person with collision. Export the result as a GLB.

### Saving and sharing projects

- **Download project** (project page) saves everything as one `.mine3d` file: the plans and their images, your edits, the kit and the 3D assets it uses.
- **Open project file** (projects page) loads a `.mine3d` file on any PC running the app. Assets already in the library are reused, and the project opens as a new copy.
- **Export GLB** (3D viewer) saves the assembled model for Blender, Deswik, Unity or any glTF viewer.

### Measuring distances

Works like a plan distance calculator.

- **Calibrate**:
  - Pick two grid points with their coordinates (C).
  - Or, with no grid on the sheet, use **Calibrate by known distance** (K): draw over a scale bar or a dimensioned drive and type its length.
  - With both set, the known distance is shown as a check against the grid scale.
- **Measure** (L) in the plan editor:
  - **Line**: click two points.
  - **Polyline**: click along a route, then double-click or press Enter to finish.
  - Points snap to junctions, drives and the ends of other measurements. Ctrl places freely; Shift locks to 15° steps.
- **Units**: m, km, ft or cm. Measurements export to CSV.
- **On the walls in 3D**: measurements marked *Show in 3D* appear in the 3D model as a tape on the drive's left wall at shoulder height, with distance ticks and a sign giving the label and length. You read them as you walk through.
- **Tools tab** (3D model): measure in the model itself.
  - In Overview, click the drive floors.
  - In Walk, press **Mark point here** (or M) where you stand, walk on, and mark again.
  - Distances include changes in RL.

### Working offline

- Every page you open is kept on the device. Plan images and 3D models are cached too, and the app itself is cached by a service worker in production builds.
- While the server cannot be reached, the app keeps working, and the top bar shows **Offline · n changes on this device**. You can still:
  - edit plans (drives, stopes, regions, scale, measurements);
  - change project settings, placed items and kits;
  - create projects and upload plans;
  - delete plans and projects.
- When the connection is back, the changes are sent in order and merged with the server's current copy:
  - Edits by other people in the meantime are kept, record by record (drive segments, junctions, stopes, items, measurements).
  - Only a value changed on both sides counts as a conflict. The offline version wins and you are told.
- These still need the server: detection, asset import and opening `.mine3d` files.

### Data source

**Data source** (left bar, or the connection badge in the top bar) shows:

- which database the server uses, the connection state, latency and when data was last saved;
- where files are stored and the record counts;
- the changes waiting on this device.

### Inventory and named drives

- **Inventory** (left bar): add equipment and objects with their own 3D models, such as loaders, refuge chambers, pumps and signs.
- Placing items: in a project's 3D model, open the **Inventory** tab.
  - In Overview, click **Place** and then a point in a drive. The item lands on the drive floor.
  - In Walk, **Place here** puts the item 4 m in front of you.
- Select a placed item to move, rotate or scale it with the gizmo (G / R / S), or type exact values: easting, northing, RL, heading and scale. You can also label, duplicate or remove it. Items are saved with the project and included in `.mine3d` downloads.
- **Drive and crosscut names**: in the plan editor, select a drive segment and give it a name and type (drive, crosscut, ore drive, ramp and so on). **Apply name to the whole straight run** names it through the junctions.
  - Names show on the plan, as signs along the drives in 3D, and in the walk-through location bar (name, type and E/N/RL).

### Interface

- Dark and light themes (switch in the top bar).
- Blender-style plan editor with a tool rail (shortcuts V H C R X D S), collapsible properties and a status bar showing pixel, easting/northing and zoom.
- Precise drawing tools: a crosshair and a 4× magnifier (M), live length and bearing readouts, a 15° angle lock (Shift), snapping (N, or Ctrl to place without snapping) and arrow-key nudging of junctions.
- Every parameter has an (i) tip, and **Info & parameters** in the left rail explains every input in full.

## Stack

| Part | Tech |
|---|---|
| API | Node.js 20+, Express, TypeScript (run with `tsx`) |
| Client | React 18, Vite, Three.js, React Three Fiber, Drei |
| Plan processing | Pure TypeScript raster pipeline in `server/src/processing` (no native dependencies) |
| Data | PostgreSQL when `DATABASE_URL` is set (tables created automatically), otherwise a JSON file store |
| Files | In PostgreSQL alongside the data, on local disk (`data/storage`), or any S3-compatible object store |
| Offline | IndexedDB cache and change queue with three-way merge (`client/src/offline`, `shared/src/merge.ts`), service worker (`client/public/sw.js`) |

## Quick start (Windows, macOS or Linux)

```bash
npm install
npm run dev          # API on :4000, client on http://localhost:5173
```

Other commands:

```bash
npm test             # unit tests (assembly, georeferencing, detection)
npm run typecheck
npm run build        # builds the client; `npm start` then serves API + client on :4000
```

To debug detection on a plan without the UI:

```bash
npx tsx server/scripts/detect-sample.ts plan.jpg out.png x0,y0,x1,y1 "ex0,ey0,ex1,ey1"
```

## PostgreSQL (Render or any host)

Set `DATABASE_URL` and start the server. That is all:

- The server creates its tables (`mp_docs`, `mp_blobs`) on start-up, so no migrations are needed.
- It also stores plan images and 3D asset files in the database, so they survive redeploys (Render's disk is wiped on every deploy).
- TLS is switched on automatically for remote hosts such as `*.render.com`. Use `DATABASE_SSL=true|false` to force it.
- If the database is down, the server still starts. Requests answer 503, clients keep their changes offline, and the Data source page shows the error.

**On Render:**

1. Deploy `render.yaml` as a Blueprint. It creates the web service and a PostgreSQL database and wires `DATABASE_URL`.
   - Or set it up by hand: create a PostgreSQL database, then in the web service → *Environment* add `DATABASE_URL` = the database's **Internal Database URL**.
   - Build command: `npm ci --include=dev && npm run build`. Start command: `npm start`.
2. Open **Data source** in the app. It should show *PostgreSQL · Connected*.

**Moving existing local data into PostgreSQL:**

```bash
DATABASE_URL=postgresql://... npm run db:import
```

This copies `data/db.json` and `data/storage` into the database. Records that already exist there are skipped.

## Other storage options

Copy `.env.example` to `.env`, then:

```bash
# PostgreSQL through Prisma (alternative to the built-in driver)
DATA_STORE=prisma
DATABASE_URL=postgresql://user:pass@localhost:5432/mineplan?schema=public
npm run prisma:generate -w server
npm run prisma:migrate -w server

# S3 / MinIO
STORAGE_DRIVER=s3
S3_BUCKET=...
S3_REGION=...
S3_ENDPOINT=...          # optional, e.g. MinIO
```

The JSON file store is for single-user or local use. Use PostgreSQL for shared deployments.

## How the pieces fit

```
shared/   types, georeferencing, network editing, kit assembly (pure, unit tested)
server/   REST API, storage, glTF validation, plan detection pipeline
client/   plan editor (2D canvas), asset import wizard, kit editor, 3D viewer
```

**Detection** (`server/src/processing/detect.ts`) works in these steps:

1. Make a wall-ink mask, and ignore coloured annotation.
2. Run a distance transform and estimate the drive width.
3. Remove open areas wider than a drive, which leaves the corridors.
4. Fill small holes and remove noise.
5. Skeletonise the corridors.
6. Build a graph, then prune spurs and merge junctions.
7. Bridge gaps where annotation crosses a drive.

Stopes are found from coloured outlines and hatching. All thresholds can be changed in the UI.

**Assembly** (`shared/src/assembly.ts`) works as follows:

- Each drive is split into nearly straight runs. Straight modules are tiled along each run with instanced rendering and stretched slightly so they fit.
- At each junction, an imported T, cross or 90° bend asset is used when its openings match the junction's branch angles within the kit tolerance.
- Otherwise a compact parametric connector is fitted to the actual branch directions.
- Dead ends get an end-wall module.
- Infrastructure assets (ground support, cable trays, pipes) can be repeated along the drives.

## Importing tunnel assets

In **Asset library → Import asset**:

1. Choose a `.glb`, or a `.gltf` with its `.bin` and texture files. OBJ (+MTL), FBX and STL files are converted to GLB in the browser.
2. The files are validated (structure, version, missing resources, polygon count) and shown in a 3D preview.
3. Set the units, up axis and forward axis, or click **Auto-detect**. Auto-detect casts rays to find the openings and suggests the category and forward axis.
4. Check the openings, the cross-section, the connection type and the pivot.
5. Record the source and licence and confirm the licence allows your use. Import is blocked until you do.

Then create a **kit** (one asset per slot) and choose it on the project page. Empty slots fall back to the built-in pieces.

One asset source to look at is the "Underground Mine and Shaft Works" pack on 3DAssets.dev. Treat it as optional: check that the files are available, compatible and licensed for your use before you import them.

## Data handling

Mine plans are site data and may be customer-confidential. `samples/`, `debug/` and `data/` are git-ignored, so don't commit plans or the database to the repository. Keep the repository private.
