# Mine plan 3D

A web app that turns a 2D underground mine plan into a navigable 3D model. It builds the model from reusable tunnel modules rather than generating the whole mine from scratch.

1. Upload a plan image (PNG or JPEG), for example a tele-remote bogging plan.
2. Georeference it by clicking two grid intersections and typing their easting and northing. Rotated sheets are handled.
3. Select the portions to model and exclude the legend, title block and notes.
4. Run automatic detection of drive centrelines, junctions, dead ends and coloured stopes, then correct the result in the editor (draw, delete, move, undo).
5. Assemble the model from a tunnel kit: imported GLB modules, or the built-in parametric pieces where no asset fits.
6. Explore it in an overview (with the plan draped underneath) or walk through it first-person with collision. Export the result as a GLB.

## Stack

| Part | Tech |
|---|---|
| API | Node.js 20+, Express, TypeScript (run with `tsx`) |
| Client | React 18, Vite, Three.js, React Three Fiber, Drei |
| Plan processing | Pure TypeScript raster pipeline in `server/src/processing` (no native dependencies) |
| Data | JSON file store (default, zero setup) or PostgreSQL through Prisma |
| Files | Local disk (`data/storage`) or any S3-compatible object store |

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

## PostgreSQL and object storage

Copy `.env.example` to `.env`, then:

```bash
# PostgreSQL
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
