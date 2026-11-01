import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { clampToDrives, nearestDrive, type Assembly, type CollisionSegment } from '@mineplan/shared';

const EYE = 1.7;

/** First-person walk-through: click to capture the mouse, WASD/arrows to move, Shift to run, Esc to release. */
export function WalkControls({ assembly, collide, speed, onLocate }: {
  assembly: Assembly; collide: boolean; speed: number;
  /** called a few times per second with the camera floor position and the drive it is in */
  onLocate?: (p: { x: number; y: number; z: number }, seg: CollisionSegment | null) => void;
}) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const lastLocate = useRef(0);

  useEffect(() => {
    if (assembly.spawn) {
      const [x, y, z] = assembly.spawn.position;
      camera.position.set(x, y + EYE, z);
      const [dx, dz] = assembly.spawn.dir;
      camera.lookAt(x + dx * 10, y + EYE, z + dz * 10);
    }
  }, [assembly]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  useFrame((state, dt) => {
    if (onLocate && state.clock.elapsedTime - lastLocate.current > 0.25) {
      lastLocate.current = state.clock.elapsedTime;
      const y = camera.position.y - EYE;
      const hit = nearestDrive([camera.position.x, camera.position.z], y, assembly.collision);
      onLocate({ x: camera.position.x, y, z: camera.position.z }, hit && hit.d < hit.seg.r + 3 ? hit.seg : null);
    }
    const k = keys.current;
    const v = speed * (k.ShiftLeft || k.ShiftRight ? 3 : 1) * Math.min(dt, 0.1);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    const move = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) move.add(fwd);
    if (k.KeyS || k.ArrowDown) move.sub(fwd);
    if (k.KeyD || k.ArrowRight) move.add(right);
    if (k.KeyA || k.ArrowLeft) move.sub(right);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(v);
    let nx = camera.position.x + move.x, nz = camera.position.z + move.z;
    // find floor level of the nearest drive (multi-level models)
    let floorY = camera.position.y - EYE;
    if (assembly.collision.length) {
      let best = Infinity;
      for (const s of assembly.collision) {
        const d = Math.abs(s.y - floorY);
        if (d < best) { best = d; floorY = s.y; }
      }
    }
    if (collide && assembly.collision.length) [nx, nz] = clampToDrives([nx, nz], floorY, assembly.collision, 0.6);
    camera.position.set(nx, floorY + EYE, nz);
  });

  return <PointerLockControls makeDefault />;
}
