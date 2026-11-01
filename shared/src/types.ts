/** 2D point. In plan space this is image pixels (x right, y down); in world space it is [Easting, Northing] metres. */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Polygon = Vec2[];

// ---------------------------------------------------------------------------
// Plan network (output of detection, editable by the user). Coordinates are image pixels.
// ---------------------------------------------------------------------------

export interface NetNode {
  id: string;
  x: number;
  y: number;
}

export interface NetEdge {
  id: string;
  a: string; // node id at points[0]
  b: string; // node id at points[last]
  /** Polyline in image pixels including both end points. */
  points: Vec2[];
  /** Detected drive width in pixels (optional). */
  widthPx?: number;
  /** User-given name shown on signs and in the walk-through, e.g. "XC 3" or "445 S6S7 ore drive". */
  name?: string;
  kind?: DriveKind;
}

export type DriveKind = 'drive' | 'crosscut' | 'access' | 'ramp' | 'oreDrive' | 'stockpile' | 'other';

export const DRIVE_KINDS: { value: DriveKind; label: string }[] = [
  { value: 'drive', label: 'Drive' },
  { value: 'crosscut', label: 'Crosscut' },
  { value: 'oreDrive', label: 'Ore drive' },
  { value: 'access', label: 'Access' },
  { value: 'ramp', label: 'Ramp / decline' },
  { value: 'stockpile', label: 'Stockpile / cuddy' },
  { value: 'other', label: 'Other' },
];

export interface Stope {
  id: string;
  /** Outline in image pixels. */
  polygon: Polygon;
  /** Vertical extent of the stope volume in metres. */
  heightM: number;
  /** Offset of the stope base from the level floor (metres, negative = below). */
  baseOffsetM: number;
  label?: string;
}

export interface PlanNetwork {
  nodes: NetNode[];
  edges: NetEdge[];
  stopes: Stope[];
}

export const emptyNetwork = (): PlanNetwork => ({ nodes: [], edges: [], stopes: [] });

// ---------------------------------------------------------------------------
// Georeferencing
// ---------------------------------------------------------------------------

export interface GeoRefPoint {
  /** Image pixel position. */
  px: Vec2;
  /** Real-world [Easting, Northing] in metres. */
  world: Vec2;
}

export interface GeoRef {
  /** Two (or more) control points, e.g. grid intersections 39900E/19400N. */
  points: GeoRefPoint[];
  /** Fallback scale when fewer than 2 control points are defined. */
  metersPerPixel: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectionParams {
  /** How much darker than the local paper background a pixel must be to count as a wall line (0-255). */
  wallContrast: number;
  /** Pixels more saturated than this are treated as annotation colour (stopes, hatching), not walls. 0-1. */
  maxWallSaturation: number;
  /** Expected drive width (wall to wall) in pixels. 0 = estimate automatically. */
  driveWidthPx: number;
  /** Regions wider than driveWidth * wideAreaFactor are treated as open ground / pillars, not drives. */
  wideAreaFactor: number;
  /** Extra dilation of the wall mask in pixels (closes small gaps in scanned lines). */
  wallDilatePx: number;
  /** Fill holes in the drive mask smaller than this many (driveWidth^2) units (removes text labels inside drives). */
  holeFillFactor: number;
  /** Drop isolated drive blobs smaller than this many (driveWidth^2) units (small pillars, symbols). */
  minBlobFactor: number;
  /** Remove dead-end spurs shorter than driveWidth * spurFactor. */
  spurFactor: number;
  /** Polyline simplification tolerance as a fraction of driveWidth. */
  simplifyFactor: number;
  /** Bridge gaps (annotation crossing a drive) up to driveWidth * this. 0 disables. */
  bridgeGapFactor: number;
  /** Detect coloured stope outlines/hatching as stope polygons. */
  detectStopes: boolean;
  /** Minimum saturation for stope colour detection (0-1). */
  stopeMinSaturation: number;
  /** Default stope height in metres for detected stopes. */
  stopeHeightM: number;
}

export const defaultDetectionParams = (): DetectionParams => ({
  wallContrast: 32,
  maxWallSaturation: 0.12,
  driveWidthPx: 0,
  wideAreaFactor: 1.25,
  wallDilatePx: 1,
  holeFillFactor: 6,
  minBlobFactor: 12,
  spurFactor: 1.4,
  simplifyFactor: 0.5,
  bridgeGapFactor: 4.5,
  detectStopes: true,
  stopeMinSaturation: 0.09,
  stopeHeightM: 20,
});

export interface DetectionResult {
  network: PlanNetwork;
  /** Estimated drive width in pixels used by the run. */
  driveWidthPx: number;
  /** PNG data URL of the detected drive mask (for overlay). */
  maskPng?: string;
  stats: {
    wallPixels: number;
    drivePixels: number;
    nodes: number;
    edges: number;
    stopes: number;
    totalLengthPx: number;
    ms: number;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Project / plan records
// ---------------------------------------------------------------------------

export interface TunnelProfile {
  /** Drive width wall to wall (m). */
  width: number;
  /** Height of the vertical side walls (m). */
  wallHeight: number;
  /** Rise of the arched back above the walls (m). */
  archRise: number;
  /** Use per-edge widths detected from the plan instead of the uniform width. */
  useDetectedWidths: boolean;
}

export const defaultProfile = (): TunnelProfile => ({
  width: 5.5,
  wallHeight: 4.2,
  archRise: 1.3,
  useDetectedWidths: false,
});

/** An inventory item (equipment, signage, refuge chamber...) placed in the 3D model. */
export interface PlacedItem {
  id: string;
  assetId: string;
  label?: string;
  /** World position: [Easting, Northing, elevation RL] in metres (base of the item). */
  position: Vec3;
  /** Heading rotation about the vertical axis, degrees (counter-clockwise seen from above). */
  rotationDeg: number;
  /** Scale along the item's length, height and width. */
  scale: Vec3;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  /** Kit used for assembly; null = built-in parametric kit. */
  kitId: string | null;
  profile: TunnelProfile;
  /** Inventory items placed in the model. */
  items?: PlacedItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  projectId: string;
  name: string;
  imageKey: string;
  imageMime: string;
  imageWidth: number;
  imageHeight: number;
  /** Floor elevation (reduced level) of this plan in metres. */
  levelRL: number;
  georef: GeoRef;
  /** Portions of the plan selected for modelling (image px). Empty = whole sheet. */
  regions: Polygon[];
  /** Areas to ignore (title block, legend, notes). */
  excludes: Polygon[];
  params: DetectionParams;
  network: PlanNetwork;
  lastDetection?: Omit<DetectionResult, 'network' | 'maskPng'> | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Asset library
// ---------------------------------------------------------------------------

export type AssetCategory =
  | 'straight'
  | 'curve'
  | 'junctionT'
  | 'junctionX'
  | 'deadEnd'
  | 'entrance'
  | 'infrastructure'
  | 'item'
  | 'general';

export const ASSET_CATEGORIES: { value: AssetCategory; label: string }[] = [
  { value: 'straight', label: 'Straight drive' },
  { value: 'curve', label: 'Curve / bend' },
  { value: 'junctionT', label: 'T-junction' },
  { value: 'junctionX', label: 'Cross intersection' },
  { value: 'deadEnd', label: 'Dead end / face' },
  { value: 'entrance', label: 'Entrance / portal' },
  { value: 'infrastructure', label: 'Infrastructure (supports, pipes, trays)' },
  { value: 'item', label: 'Inventory item (equipment, signage, refuge…)' },
  { value: 'general', label: 'General component' },
];

export type UpAxis = 'Y' | 'Z';
/** Forward axis expressed in the Y-up corrected frame. */
export type ForwardAxis = '+X' | '-X' | '+Z' | '-Z';
export type Side = '+X' | '-X' | '+Z' | '-Z';

export interface AssetConnector {
  /** Side of the normalised asset the opening faces. */
  side: Side;
  /** Distance from the asset pivot to the opening plane (m). */
  distance: number;
  connectionType: string;
}

/**
 * Normalisation metadata. Canonical asset frame after normalisation:
 * +X = forward (along the drive), +Y = up, origin = pivot.
 *  - straight / deadEnd / entrance: pivot at floor centre of the start opening, piece spans x in [0, length].
 *  - junctions / curves / others: pivot at floor centre of the piece.
 */
export interface AssetMeta {
  unitScale: number; // model units -> metres
  upAxis: UpAxis;
  forward: ForwardAxis;
  /** Pivot in metres in the corrected (Y-up, forward=+X) frame, subtracted after rotation. */
  pivot: Vec3;
  /** Dimensions in metres after normalisation: length (X), height (Y), width (Z). */
  dims: { length: number; height: number; width: number };
  crossSection: { width: number; height: number };
  connectionType: string;
  connectors: AssetConnector[];
  /** For curves: bend angle in degrees (positive = turns left). */
  bendAngleDeg?: number;
  /** For T-junctions: side of the stem branch in the normalised frame (through-run along X). */
  stemSide?: '+Z' | '-Z';
  /** Scale the asset uniformly so its cross-section width matches the drive width. */
  fitToDriveWidth: boolean;
}

export interface AssetFile {
  name: string;
  key: string;
  size: number;
  mime: string;
}

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  files: AssetFile[];
  mainFile: string;
  thumbnailKey?: string | null;
  meta: AssetMeta;
  sourceUrl?: string;
  license?: string;
  licenseConfirmed: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type KitSlot = 'straight' | 'deadEnd' | 'junctionT' | 'junctionX' | 'curve90';

export const KIT_SLOTS: { slot: KitSlot; label: string; category: AssetCategory; required?: boolean }[] = [
  { slot: 'straight', label: 'Straight drive', category: 'straight', required: true },
  { slot: 'junctionT', label: 'T-junction', category: 'junctionT' },
  { slot: 'junctionX', label: 'Cross intersection', category: 'junctionX' },
  { slot: 'curve90', label: '90° bend', category: 'curve' },
  { slot: 'deadEnd', label: 'Dead end / face', category: 'deadEnd' },
];

/** Infrastructure repeated along straight drives (ground support rings, cable trays, pipes, lights). */
export interface KitDecoration {
  assetId: string;
  spacingM: number;
}

export interface Kit {
  id: string;
  name: string;
  description?: string;
  /** Asset id per slot. Empty slots fall back to the built-in parametric pieces. */
  slots: Partial<Record<KitSlot, string | null>>;
  decorations: KitDecoration[];
  /** Angular tolerance (deg) for matching junction/bend assets to plan geometry. */
  angleToleranceDeg: number;
  createdAt: string;
  updatedAt: string;
}

export interface GltfValidationReport {
  ok: boolean;
  format: 'glb' | 'gltf' | 'unknown';
  errors: string[];
  warnings: string[];
  missingResources: string[];
  meshes: number;
  materials: number;
  textures: number;
  triangles?: number;
}
