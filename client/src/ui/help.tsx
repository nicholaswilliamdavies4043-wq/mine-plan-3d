import { useMemo, useState } from 'react';
import { Icon } from './Icon';

export interface HelpEntry {
  title: string;
  text: string;
  tip?: string;
  group: string;
}

/** Explanations of every input and parameter, used by inline (i) tips and the Info tab. */
export const HELP: Record<string, HelpEntry> = {
  // workflow
  workflow: { group: 'Workflow', title: 'How it works', text: 'There are four steps. 1) Georeference the sheet and set its level. 2) Select the portion to model. 3) Detect drives and stopes automatically. 4) Correct the result, then build the 3D model.', tip: 'You can come back to any step. Your work saves automatically.' },
  // georeference
  georefPoints: { group: 'Scale & level', title: 'Grid control points', text: 'Click a grid intersection on the sheet, for example 39900E / 19400N, and type its easting and northing. Two points far apart give the scale, rotation and position of the sheet.', tip: 'Choose points near opposite corners. With three or more points, each point shows how far it is from the fit (± m); large values usually mean a typing error.' },
  metersPerPixel: { group: 'Scale & level', title: 'Metres per pixel', text: 'The ground distance covered by one image pixel. It is only used when fewer than two control points are set.', tip: 'For a 1:1000 plan scanned at 200 dpi, 1 px ≈ 0.127 m.' },
  levelRL: { group: 'Scale & level', title: 'Level floor RL', text: 'The reduced level (elevation, in metres) of the drive floors on this plan. Each plan is one level; plans with different RLs stack vertically in 3D.', tip: 'For the 445 level, enter 445 if your site uses that as the RL.' },
  rotation: { group: 'Scale & level', title: 'Rotation', text: 'The angle between the image x axis and grid east, calculated from the control points. Sheets printed sideways show about ±90°.' },
  scaleLine: { group: 'Scale & level', title: 'Calibrate by known distance', text: 'Draw a line over something whose real length you know, such as the scale bar or a dimensioned drive, and type that length. The scale (metres per pixel) is worked out from it, like the point calibration in a plan distance calculator.', tip: 'Grid control points also give rotation and position and take precedence. With both set, the line shows how far the typed distance is from the grid scale, as a check.' },
  // measurements
  measureTool: { group: 'Measure', title: 'Measure distances', text: 'Line: click two points. Polyline: click along a route and double-click or press Enter to finish. The distance uses the plan scale and appears on the sheet, in the list and as a CSV export. Points snap to junctions, drives and the ends of other measurements; hold Ctrl to place freely and Shift to lock to 15° steps.', tip: 'Shortcut: L. Change the unit (m, km, ft, cm) next to the Line / Polyline buttons.' },
  measureIn3D: { group: 'Measure', title: 'Measurements on the walls', text: 'Measurements marked "Show in 3D" are painted on the drive walls in the 3D model: a tape line at shoulder height with distance ticks, and a sign with the label and length that you can read while walking through.' },
  modelMeasure: { group: 'Measure', title: 'Measuring in the 3D model', text: 'Open the Tools tab in the 3D model. In Overview, click points on the drive floors. In Walk, press "Mark point here" (or M) where you stand. The distance includes changes in level (RL) between plans.' },
  // regions
  regions: { group: 'Select portion', title: 'Modelling regions', text: 'Polygons that limit detection to the part of the plan you want in 3D. Without a region, the whole sheet is processed.', tip: 'Use "Detect & add" on a region to model the plan portion by portion.' },
  excludes: { group: 'Select portion', title: 'Exclusions', text: 'Areas to ignore inside a region, such as the legend, title block, approvals table, notes or north arrow. Their lines would otherwise be mistaken for drive walls.' },
  // detection
  driveWidthPx: { group: 'Detection', title: 'Drive width on the sheet (px)', text: 'The typical wall-to-wall width of a drive, in image pixels. Leave it at 0 to estimate it automatically from the plan.', tip: 'If the estimate is wrong, measure a drive with the Draw drive tool and enter the value.' },
  wallContrast: { group: 'Detection', title: 'Wall line contrast', text: 'How much darker than the paper a pixel must be to count as a drive wall line (0–255).', tip: 'Raise it if paper texture or shading creates false walls. Lower it if faint walls are missed.' },
  maxWallSaturation: { group: 'Detection', title: 'Max wall colour saturation', text: 'Strongly coloured ink (stope outlines, hatching, symbols) is not treated as a wall. Pixels above this saturation are ignored when walls are traced.' },
  wideAreaFactor: { group: 'Detection', title: 'Max drive width factor', text: 'Free space wider than (drive width × this factor) is treated as open ground or pillar, not drive. It must be large enough to keep junctions, where two drives cross and the space is wider.', tip: 'Raise it (1.4–1.6) if junctions or wide drives disappear. Lower it if pillars between drives turn into tunnels.' },
  wallDilatePx: { group: 'Detection', title: 'Wall gap sealing (px)', text: 'Thickens the detected wall lines by this many pixels before tracing. This closes small breaks in scanned lines.', tip: '1 suits most scans. Use 0 for clean CAD exports and 2 for faint or broken photocopies.' },
  holeFillFactor: { group: 'Detection', title: 'Label hole filling', text: 'Text labels drawn inside a drive punch holes in it. Holes smaller than (drive width² × this factor) are filled.' },
  minBlobFactor: { group: 'Detection', title: 'Minimum blob size', text: 'Isolated drive fragments smaller than (drive width² × this factor) are discarded, for example small pillars and symbols.' },
  bridgeGapFactor: { group: 'Detection', title: 'Bridge gaps', text: 'Where annotation (brow markers, labels, hatching) interrupts a drive, a dead end is reconnected to the drive straight ahead if the gap is shorter than (drive width × this factor). 0 turns bridging off.' },
  spurFactor: { group: 'Detection', title: 'Spur removal', text: 'Short dead-end branches created by tracing noise are removed when they are shorter than drive width × this factor.' },
  simplifyFactor: { group: 'Detection', title: 'Simplification', text: 'How much the detected centrelines are straightened, as a fraction of drive width. Higher values give fewer, straighter tunnel modules.' },
  detectStopes: { group: 'Detection', title: 'Detect coloured stopes', text: 'Finds stope outlines and hatching drawn in colour and turns them into stope polygons, which become volumes in 3D.' },
  stopeMinSaturation: { group: 'Detection', title: 'Stope colour threshold', text: 'The minimum colour saturation for stope ink. Faded scans need a low value (0.08–0.12). Clean digital plans work at 0.25 or higher.' },
  stopeHeightM: { group: 'Detection', title: 'Stope height (m)', text: 'The vertical extent given to detected stopes. You can change the height of each stope after detection.' },
  // editing
  toolSelect: { group: 'Editing tools', title: 'Select (V)', text: 'Click a drive, junction, stope or region to select it. Drag junctions to move them. The arrow keys nudge a selected junction by 0.5 px (5 px with Shift). Delete removes the selection.' },
  toolPan: { group: 'Editing tools', title: 'Pan (H)', text: 'Drag to move the view. You can also pan with the right or middle mouse button, or Alt + drag, while any tool is active. Use the wheel to zoom.' },
  toolRegion: { group: 'Editing tools', title: 'Region (R) / Exclusion (X)', text: 'Click points to outline an area. Double-click, press Enter or click the first point to close it. Backspace removes the last point and Esc cancels.' },
  toolDrive: { group: 'Editing tools', title: 'Draw drive (D)', text: 'Click along the centreline of a drive. The ends snap to existing junctions and drives (blue ring) and join them. Double-click or press Enter to finish.', tip: 'Hold Shift to lock the segment to 15° steps. The magnifier and the live length/bearing readout help with precise placement.' },
  toolStope: { group: 'Editing tools', title: 'Draw stope (S)', text: 'Outline a stope by hand. It is extruded as a volume in 3D using its height and base offset.' },
  toolCalibrate: { group: 'Editing tools', title: 'Pick grid point (C)', text: 'Click a grid intersection to add a georeference control point, then type its coordinates in the panel.' },
  snapping: { group: 'Editing tools', title: 'Snapping', text: 'When it is on, drive ends snap to nearby junctions and drives so the network stays connected. Hold Ctrl while clicking to place a point without snapping.' },
  loupe: { group: 'Editing tools', title: 'Magnifier', text: 'Shows an enlarged view around the pointer while you draw or calibrate, so you can place points to sub-pixel precision.' },
  driveName: { group: 'Editing tools', title: 'Drive and crosscut names', text: 'Select a drive segment and type its name, for example "XC 3" or "445 S6S7 ore drive". "Apply name to the whole straight run" names every segment that carries straight on through the junctions. Names appear as signs along the drive, and the walk-through shows which drive you are in.' },
  driveKind: { group: 'Editing tools', title: 'Drive type', text: 'Drive, crosscut, ore drive, access, ramp or stockpile. The type is shown on the signs and in the location read-out.' },
  tidy: { group: 'Editing tools', title: 'Tidy', text: 'Merges drive segments joined end to end without a junction into single drives. This makes the next assembly cleaner.' },
  stopeBase: { group: 'Editing tools', title: 'Stope base offset (m)', text: 'Moves the stope volume up or down relative to the level floor. Use a negative value for stopes that extend below the level.' },
  // assembly
  driveProfile: { group: '3D assembly', title: 'Drive profile', text: 'The tunnel cross-section used by the built-in modules: width (wall to wall), vertical wall height, and arch rise of the back above the walls.', tip: 'Total height = wall height + arch rise.' },
  useDetectedWidths: { group: '3D assembly', title: 'Use widths measured from the plan', text: 'Each drive gets the width measured on the sheet instead of the uniform profile width. This is useful when access drives and ore drives differ.' },
  kit: { group: '3D assembly', title: 'Tunnel kit', text: 'The set of imported 3D modules used to build the model. Slots without an asset use the built-in parametric pieces.' },
  kitSlots: { group: '3D assembly', title: 'Kit slots', text: 'Straight modules are tiled along drives. T, cross and 90° bend pieces are placed where the angles at a junction match the asset openings within the tolerance. Dead-end assets close the faces.' },
  angleTolerance: { group: '3D assembly', title: 'Junction angle tolerance', text: 'How far, in degrees, the branch directions at a junction may differ from an asset\'s openings and still use that asset. Junctions outside the tolerance get a fitted connector that matches their actual angles.' },
  decorations: { group: '3D assembly', title: 'Infrastructure along drives', text: 'An asset (ground support ring, cable tray, pipe or light) repeated along every drive at the given spacing.' },
  // assets
  assetUnits: { group: 'Asset import', title: 'Model units', text: 'The unit the model was authored in. Models from CAD are often in millimetres; game assets are usually in metres. Check that the size readout looks realistic.' },
  assetUp: { group: 'Asset import', title: 'Up axis', text: 'glTF models are Y-up. Many CAD and BIM exports are Z-up. If the tunnel appears lying on its side, switch this.' },
  assetForward: { group: 'Asset import', title: 'Forward (drive axis)', text: 'The axis the drive runs along. After correction it is shown as the red axis in the preview.', tip: '"Auto-detect" casts rays into the model to find the open ends and sets this for you.' },
  assetOpenings: { group: 'Asset import', title: 'Openings', text: 'The sides where the tunnel is open and joins the next module. A straight piece has two opposite openings, a T-junction three and a cross four. Distance is measured from the pivot to the opening.' },
  assetCrossSection: { group: 'Asset import', title: 'Opening width and height', text: 'The size of the tunnel opening, used to scale the asset to the drive width of the plan.' },
  connectionType: { group: 'Asset import', title: 'Connection type', text: 'A label for compatible cross-sections, for example "5x5 arch". Pieces with the same connection type join without steps.' },
  fitToDriveWidth: { group: 'Asset import', title: 'Scale to drive width', text: 'Uniformly scales the asset so its opening width matches the drive width being modelled.' },
  assetPivot: { group: 'Asset import', title: 'Pivot', text: 'The reference point used to place the asset. Straights and dead ends: the floor centre of the start opening. Junctions and bends: the floor centre of the piece. The offset adjusts it.' },
  assetLicence: { group: 'Asset import', title: 'Source and licence', text: 'Record where the model came from and its licence. Import is blocked until you confirm that the licence permits this use.' },
  // inventory
  inventory: { group: 'Inventory', title: 'Inventory items', text: 'Equipment and objects with their own 3D model (loaders, trucks, refuge chambers, pumps, signs). They are added once on the Inventory page and can be placed in any project.' },
  itemPlace: { group: 'Inventory', title: 'Placing items', text: 'In the 3D model, open the Inventory tab and click Place on an item. In Overview, click a point in a drive to drop it there; it lands on the drive floor. In Walk through, "Place in front of me" puts it 4 m ahead of you.' },
  itemTransform: { group: 'Inventory', title: 'Move, rotate and scale', text: 'Click a placed item to select it. Drag the arrows (Move), the rings (Rotate, about all three axes) or the handles (Scale) on the gizmo, or type exact values: position as easting, northing and RL, heading, pitch and roll in degrees, and scale (1 = original size).', tip: 'Turn on "Keep in drive" to stop items being moved through walls.' },
  itemRotation: { group: 'Inventory', title: 'Rotation (heading, pitch, roll)', text: 'Heading turns the item about the vertical axis, like a compass bearing. Pitch tilts its front up (+) or down (-), for example a pump on a sloping floor. Roll turns it about its own length axis. They are applied in that order. In Overview, the Rotate gizmo (R) shows three rings, one per axis, aligned with the item.', tip: '"Level" sets pitch and roll back to 0 and keeps the heading.' },
  // viewer
  locationHud: { group: '3D viewer', title: 'Location read-out', text: 'While walking, the bar at the top shows the name and type of the drive or crosscut you are in, with your easting, northing and RL. Name drives in the plan editor to make this useful.' },
  viewOverview: { group: '3D viewer', title: 'Overview', text: 'Orbit around the model: left-drag to rotate, right-drag to pan, wheel to zoom. Walls face inwards, so you can look into the drives from above.' },
  viewWalk: { group: '3D viewer', title: 'Walk through', text: 'A first-person view at 1.7 m eye height with a cap-lamp. Click the view to look around. Use W A S D or the arrow keys to move, Shift to run and Esc to release the mouse.' },
  wallMeasures: { group: '3D viewer', title: 'Show measurements on walls', text: 'Shows the distances measured on the plans and in the 3D model as tape lines and signs on the drive walls.' },
  collision: { group: '3D viewer', title: 'Stay inside drives', text: 'Stops you walking through walls by keeping you within the drive centrelines plus half the drive width.' },
  underlay: { group: '3D viewer', title: 'Plan underlay', text: 'Drapes the original plan image under the model so you can compare the 3D drives with the drawing.' },
  exportGlb: { group: '3D viewer', title: 'Export GLB', text: 'Downloads the assembled model as a single GLB file for Blender, Deswik, Unity or other glTF viewers.' },
};

export function InfoTip({ k }: { k: keyof typeof HELP | string }) {
  const h = HELP[k];
  if (!h) return null;
  return (
    <span className="info-tip" tabIndex={0} aria-label={`${h.title}: ${h.text}`}>
      <Icon name="info" size={14} />
      <span className="pop"><strong>{h.title}</strong><br />{h.text}{h.tip && <><br /><span className="muted">{h.tip}</span></>}</span>
    </span>
  );
}

/** Field label with an (i) tip. */
export function L({ k, children }: { k: string; children: React.ReactNode }) {
  return <span className="lbl">{children}<InfoTip k={k} /></span>;
}

export function HelpBrowser({ groups, compact }: { groups?: string[]; compact?: boolean }) {
  const [q, setQ] = useState('');
  const entries = useMemo(() => {
    const all = Object.entries(HELP).filter(([, h]) => !groups || groups.includes(h.group));
    const s = q.trim().toLowerCase();
    return s ? all.filter(([, h]) => (h.title + ' ' + h.text + ' ' + (h.tip ?? '')).toLowerCase().includes(s)) : all;
  }, [q, groups]);
  const byGroup = new Map<string, [string, HelpEntry][]>();
  for (const e of entries) {
    if (!byGroup.has(e[1].group)) byGroup.set(e[1].group, []);
    byGroup.get(e[1].group)!.push(e);
  }
  return (
    <div className="stack">
      <div className="search" style={{ width: '100%' }}>
        <Icon name="search" size={16} />
        <input placeholder="Search parameters and inputs" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {[...byGroup.entries()].map(([g, items]) => (
        <details key={g} className="panel" open={!compact || !!q}>
          <summary><Icon name="chevron" size={14} className="chev" />{g}<span className="spacer" /><span className="badge">{items.length}</span></summary>
          <div className="inner">
            {items.map(([key, h]) => (
              <div key={key} className="help-item">
                <div className="t">{h.title}</div>
                <div className="d">{h.text}</div>
                {h.tip && <div className="tipline">Tip: {h.tip}</div>}
              </div>
            ))}
          </div>
        </details>
      ))}
      {!entries.length && <div className="muted small">Nothing matches "{q}".</div>}
    </div>
  );
}
