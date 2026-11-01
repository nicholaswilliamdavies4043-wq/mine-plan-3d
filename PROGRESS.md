# Build progress (paused 1 Nov 2026)

This file is a checkpoint so the build can resume. Say "continue" in a new session and point to this file.

## Done (written and, where noted, tested)

- **Monorepo**: npm workspaces `shared`, `server`, `client` (root `package.json`, `vitest.config.ts`, `.env.example`, `.gitignore`).
- **shared/**: types, georeferencing (2-point similarity, rotated sheets), network editing (snap, split, merge), kit assembly (straight tiling, connector matching for T/X/bend assets, parametric hubs, dead ends, infrastructure spacing, collision), asset normalisation matrices. Tests pass (`shared/test`).
- **server/** (Express + TS):
  - Detection pipeline in `src/processing/` (wall mask → distance transform → wide-area removal → skeleton → graph cleanup → gap bridging → stope detection). Tuned on the 445 S6S7 sheet. Tests pass (`server/test/detect.test.ts`).
  - Routes: projects, plans (upload, patch, image, detect with replace/merge), assets (validate, import, files, thumbnail), kits.
  - Storage: local disk or S3. Store: JSON file (default) or Prisma/PostgreSQL (`prisma/schema.prisma`; not yet generated or migrated, because Prisma engine downloads are blocked in the build sandbox).
  - API smoke-tested end to end with the sample plan.
- **client/** (React + Vite + R3F), written but **not yet built or type-checked**:
  - `main.tsx`, `api.ts`, `styles.css` (Sandvik palette, Arial).
  - Pages: `ProjectsPage`, `ProjectPage`, `PlanEditorPage` (calibrate → select portion → detect → edit, undo/redo, autosave), `ViewerPage` (overview + walk-through, headlamp, collision, GLB export).
  - `components/PlanCanvas.tsx` (2D editor), `components/AssetImportWizard.tsx`, `components/assetAnalysis.ts` (opening detection by raycasting).
  - `three/builtinKit.ts`, `three/MineModel.tsx`, `three/WalkControls.tsx`, `three/loaders.ts` (glTF/Draco/Meshopt, OBJ/FBX/STL → GLB conversion).

## Remaining (next steps, in order)

1. `client/src/pages/AssetLibraryPage.tsx`: asset grid (thumbnail, category, size, licence; edit and delete) and a kit editor (slot → asset, infrastructure decorations and spacing, angle tolerance). `main.tsx` already imports it, so the client won't build until this file exists.
2. `npm install`, then `npm run typecheck`, `npm test` and `npm run build`. Fix any errors.
3. Run end to end: upload the sample plan, calibrate, detect, view in 3D, then screenshot and check.
4. Write `README.md`: setup, PostgreSQL/Prisma, S3, the asset workflow, and the 3DAssets.dev licence note.
5. Git: `git init`, commit, and push to GitHub user `nicholaswilliamdavies4043-wq`. GitHub was blocked from the build sandbox, so the push has to run from this PC (commands go in the README).

## Notes

- The sample plan (`445 S7S8.jpg`) is customer site data and is git-ignored (`samples/`). Don't commit it to a public repo.
- Debug detection: `npx tsx server/scripts/detect-sample.ts <plan.jpg> out.png x0,y0,x1,y1 "ex0,ey0,ex1,ey1"`.
