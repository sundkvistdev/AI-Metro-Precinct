import { RadarLiveSnapshot, RadarStaticMapData } from '../sim/types';

export interface RadarViewport {
  cx: number;
  cz: number;
  halfSpan: number;
}

export interface RadarDrawOptions {
  showCallsigns?: boolean;
  showCaseLabels?: boolean;
  showScaleGrid?: boolean;
}

export function getMapDefaultViewport(radarMap: RadarStaticMapData | null): RadarViewport {
  if (!radarMap) {
    return { cx: 0, cz: 0, halfSpan: 140 };
  }
  return { cx: 0, cz: 0, halfSpan: Math.max(40, radarMap.halfSize * 1.04) };
}

export function computeAutoMinimapViewport(
  radarMap: RadarStaticMapData | null,
  radar: RadarLiveSnapshot,
  defaultSpan = 64,
): RadarViewport {
  if (radar.followedCrewDismounted) {
    const dismountedFollowed = radar.officers.filter(
      (o) => o.followedCrew && !o.dead,
    );
    if (dismountedFollowed.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const o of dismountedFollowed) {
        if (o.x < minX) minX = o.x;
        if (o.x > maxX) maxX = o.x;
        if (o.z < minZ) minZ = o.z;
        if (o.z > maxZ) maxZ = o.z;
      }
      const spanX = maxX - minX;
      const spanZ = maxZ - minZ;
      const maxSpan = Math.max(spanX, spanZ);
      const pad = Math.max(14, maxSpan * 0.32);
      return {
        cx: (minX + maxX) * 0.5,
        cz: (minZ + maxZ) * 0.5,
        halfSpan: Math.min(84, Math.max(20, maxSpan * 0.5 + pad)),
      };
    }
  }

  const followed = radar.cops.find((c) => c.id === radar.followedUnitId || c.followed);
  if (followed) {
    return { cx: followed.x, cz: followed.z, halfSpan: defaultSpan };
  }

  return getMapDefaultViewport(radarMap);
}

function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  arm: number,
  color: string,
  lineWidth: number,
): void {
  ctx.save();
  ctx.lineCap = 'square';
  // Dark halo underneath for high contrast over roads/buildings
  ctx.strokeStyle = 'rgba(9, 13, 22, 0.9)';
  ctx.lineWidth = lineWidth + 2;
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
  ctx.restore();
}

function drawNavMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  yaw: number,
  size: number,
  fillColor: string,
  strokeColor: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  // Three.js forward is (+sin(yaw), +cos(yaw)) in (X, Z) -> rotating (0, -1) by (PI - yaw) aligns chevron nose with heading
  ctx.rotate(Math.PI - yaw);
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.15);
  ctx.lineTo(size * 0.82, size * 0.85);
  ctx.lineTo(0, size * 0.36);
  ctx.lineTo(-size * 0.82, size * 0.85);
  ctx.closePath();

  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
  ctx.restore();
}

export function drawVectorRadar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radarMap: RadarStaticMapData | null,
  radar: RadarLiveSnapshot,
  viewport: RadarViewport,
  nowMs: number,
  options: RadarDrawOptions = {},
): void {
  const {
    showCallsigns = false,
    showCaseLabels = false,
    showScaleGrid = true,
  } = options;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e131b';
  ctx.fillRect(0, 0, width, height);

  const minDim = Math.max(1, Math.min(width, height));
  const halfSpan = Math.max(8, viewport.halfSpan);
  const scale = minDim / (halfSpan * 2);

  const toX = (wx: number) => width * 0.5 + (wx - viewport.cx) * scale;
  const toY = (wz: number) => height * 0.5 + (wz - viewport.cz) * scale;

  // Background grid
  if (showScaleGrid) {
    const gridStep = halfSpan > 110 ? 50 : 25;
    const minWorldX = viewport.cx - (width * 0.5) / scale;
    const maxWorldX = viewport.cx + (width * 0.5) / scale;
    const minWorldZ = viewport.cz - (height * 0.5) / scale;
    const maxWorldZ = viewport.cz + (height * 0.5) / scale;
    const startX = Math.floor(minWorldX / gridStep) * gridStep;
    const startZ = Math.floor(minWorldZ / gridStep) * gridStep;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= maxWorldX; x += gridStep) {
      const sx = toX(x);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let z = startZ; z <= maxWorldZ; z += gridStep) {
      const sy = toY(z);
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  }

  if (radarMap) {
    // 1. Zones (parks & station apron)
    for (const z of radarMap.zones) {
      ctx.save();
      ctx.translate(toX(z.cx), toY(z.cz));
      ctx.rotate(-z.rotY);
      const zw = z.w * scale;
      const zd = z.d * scale;
      if (z.kind === 'park') {
        ctx.fillStyle = 'rgba(22, 101, 52, 0.25)';
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
      } else {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.38)';
      }
      ctx.fillRect(-zw * 0.5, -zd * 0.5, zw, zd);
      ctx.lineWidth = 1;
      ctx.strokeRect(-zw * 0.5, -zd * 0.5, zw, zd);
      ctx.restore();
    }

    // 2. Extra strips (apron connectors / alleys)
    const stripW = Math.max(2.4, radarMap.roadWidth * scale);
    ctx.lineCap = 'butt';
    for (const s of radarMap.extraStrips) {
      ctx.beginPath();
      ctx.moveTo(toX(s.x1), toY(s.z1));
      ctx.lineTo(toX(s.x2), toY(s.z2));
      ctx.strokeStyle = '#293241';
      ctx.lineWidth = stripW;
      ctx.stroke();
    }

    // 3. Vector Road Polylines (shoulder + asphalt)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const roadPx = Math.max(2.4, radarMap.roadWidth * scale);
    for (const poly of radarMap.roadPolylines) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(toX(poly[0][0]), toY(poly[0][1]));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(toX(poly[i][0]), toY(poly[i][1]));
      }
      ctx.strokeStyle = '#1b222d';
      ctx.lineWidth = roadPx + 1.5;
      ctx.stroke();

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = Math.max(1.5, roadPx - 0.8);
      ctx.stroke();
    }

    // 4. Buildings (with police station highlighted)
    for (const b of radarMap.buildings) {
      const bw = Math.max(2, b.w * scale);
      const bd = Math.max(2, b.d * scale);
      ctx.save();
      ctx.translate(toX(b.x), toY(b.z));
      ctx.rotate(-b.rotY);
      ctx.fillStyle = b.isStation ? 'rgba(30, 64, 115, 0.82)' : '#1b212b';
      ctx.strokeStyle = b.isStation ? '#60a5fa' : '#3d4757';
      ctx.lineWidth = b.isStation ? 1.3 : 0.9;
      ctx.fillRect(-bw * 0.5, -bd * 0.5, bw, bd);
      ctx.strokeRect(-bw * 0.5, -bd * 0.5, bw, bd);
      if (b.isStation && bw >= 16) {
        ctx.fillStyle = '#bfdbfe';
        ctx.font = '700 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HQ', 0, 0);
      }
      ctx.restore();
    }
  }

  // 5. Wrecked Suspect Vehicles (larger red crosses)
  for (const w of radar.wreckedSuspectVehicles) {
    drawCross(ctx, toX(w.x), toY(w.z), 6.2, '#ef4444', 2.4);
  }

  // 6. Wrecked Cop Vehicles (larger blue crosses)
  for (const cop of radar.cops) {
    if (!cop.immobilized) continue;
    drawCross(ctx, toX(cop.x), toY(cop.z), 6.2, '#3b82f6', 2.4);
  }

  // 7. Dead Suspects (small red crosses)
  for (const ds of radar.deadSuspects) {
    drawCross(ctx, toX(ds.x), toY(ds.z), 3.6, '#f87171', 1.7);
  }

  // 8. Dead Cops (small blue crosses)
  for (const off of radar.officers) {
    if (!off.dead) continue;
    drawCross(ctx, toX(off.x), toY(off.z), 3.6, '#60a5fa', 1.7);
  }

  // 9. Active Incidents (red blips -> red '?' when sight lost)
  for (const inc of radar.incidents) {
    const ix = toX(inc.x);
    const iy = toY(inc.z);
    if (inc.showQuestionMark) {
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(ix, iy, 9.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '800 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#090d16';
      ctx.strokeText('?', ix, iy + 0.5);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('?', ix, iy + 0.5);
      if (showCaseLabels) {
        ctx.font = '600 9px monospace';
        ctx.fillStyle = '#fca5a5';
        ctx.fillText(`#${inc.caseNumber}`, ix, iy - 12);
      }
      ctx.restore();
    } else {
      ctx.save();
      if (inc.isVehicle) {
        const r = 5.4;
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#fee2e2';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(ix, iy - r);
        ctx.lineTo(ix + r, iy);
        ctx.lineTo(ix, iy + r);
        ctx.lineTo(ix - r, iy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#fee2e2';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ix, iy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (showCaseLabels) {
        ctx.font = '600 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fecaca';
        ctx.fillText(`#${inc.caseNumber}`, ix, iy - 9);
      }
      ctx.restore();
    }
  }

  // 10. Individual Living Cops (smaller blue blips, flashing if incapacitated, smaller blue nav marker if followed crew dismounted)
  for (const off of radar.officers) {
    if (off.dead) continue;
    const ox = toX(off.x);
    const oy = toY(off.z);
    if (off.incapacitated) {
      const blinkOn = Math.sin(nowMs * 0.015) > 0;
      ctx.save();
      ctx.globalAlpha = blinkOn ? 1.0 : 0.25;
      ctx.fillStyle = blinkOn ? '#38bdf8' : '#1d4ed8';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(ox, oy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (off.followedCrew && radar.followedCrewDismounted) {
      drawNavMarker(ctx, ox, oy, off.yaw, 5.8, '#38bdf8', '#eff6ff');
    } else {
      ctx.save();
      ctx.fillStyle = '#60a5fa';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(ox, oy, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 11. Active Cop Vehicles (larger blue blips; followed car is blue nav marker unless crew dismounted)
  for (const cop of radar.cops) {
    if (cop.immobilized) continue;
    const cx = toX(cop.x);
    const cy = toY(cop.z);
    if (cop.followed && !radar.followedCrewDismounted) {
      drawNavMarker(ctx, cx, cy, cop.yaw, 8.2, '#3b82f6', '#eff6ff');
    } else {
      ctx.save();
      ctx.fillStyle = cop.followed ? '#2563eb' : '#3b82f6';
      ctx.strokeStyle = cop.followed ? '#e0f2fe' : '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (showCallsigns) {
      ctx.save();
      ctx.font = '600 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = cop.followed ? '#93c5fd' : '#cbd5e1';
      ctx.fillText(cop.callsign, cx, cy + 13);
      ctx.restore();
    }
  }
}
