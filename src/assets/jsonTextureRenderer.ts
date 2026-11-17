import * as THREE from 'three';
import { ProceduralTextureAsset, TextureLayerOp } from './assetTypes';
import { mulberry32 } from './prng';

function renderLayer(
  ctx: CanvasRenderingContext2D,
  asset: ProceduralTextureAsset,
  layer: TextureLayerOp,
): void {
  const { width, height, seed } = asset;

  switch (layer.op) {
    case 'fill': {
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'rect': {
      ctx.fillStyle = layer.color;
      ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
      break;
    }
    case 'noise_speckle': {
      const rand = mulberry32((seed + (layer.seedOffset ?? 0)) >>> 0);
      const alpha = layer.alpha ?? 1;
      for (let i = 0; i < layer.count; i++) {
        const x = rand() * width;
        const y = rand() * height;
        const r = Math.floor(layer.minRgb[0] + rand() * (layer.maxRgb[0] - layer.minRgb[0]));
        const g = Math.floor(layer.minRgb[1] + rand() * (layer.maxRgb[1] - layer.minRgb[1]));
        const b = Math.floor(layer.minRgb[2] + rand() * (layer.maxRgb[2] - layer.minRgb[2]));
        ctx.fillStyle =
          alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, layer.size, layer.size);
      }
      break;
    }
    case 'dashed_line': {
      ctx.fillStyle = layer.color;
      const start = layer.start ?? 0;
      const end = layer.end ?? (layer.orientation === 'horizontal' ? width : height);
      const step = layer.dashLength + layer.gapLength;
      for (let p = start; p < end; p += step) {
        if (layer.orientation === 'horizontal') {
          ctx.fillRect(p, layer.position, layer.dashLength, layer.thickness);
        } else {
          ctx.fillRect(layer.position, p, layer.thickness, layer.dashLength);
        }
      }
      break;
    }
    case 'crosswalk_ring': {
      ctx.fillStyle = layer.color;
      const limit = width - layer.margin - layer.stripeLength;
      for (let i = 54; i < width - 54; i += layer.step) {
        ctx.fillRect(i, layer.margin, layer.stripeWidth, layer.stripeLength);
        ctx.fillRect(i, limit, layer.stripeWidth, layer.stripeLength);
        ctx.fillRect(layer.margin, i, layer.stripeLength, layer.stripeWidth);
        ctx.fillRect(limit, i, layer.stripeLength, layer.stripeWidth);
      }
      break;
    }
    case 'grid_lines': {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = layer.lineWidth;
      for (let x = 0; x <= width; x += layer.stepX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += layer.stepY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    }
    case 'radial_gradient': {
      const grad = ctx.createRadialGradient(
        layer.cx,
        layer.cy,
        layer.rInner,
        layer.cx,
        layer.cy,
        layer.rOuter,
      );
      for (const stop of layer.stops) {
        grad.addColorStop(stop.offset, stop.color);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'light_cookie_lobe': {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // Soft outer elliptical projector lobe + fluted Fresnel lens pattern
      ctx.save();
      ctx.translate(layer.cx, layer.cy);
      ctx.scale(1, layer.ry / Math.max(1, layer.rx));
      const grad = ctx.createRadialGradient(0, 0, layer.hotRadius * 0.25, 0, 0, layer.rx);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.28, 'rgba(245, 248, 255, 0.85)');
      grad.addColorStop(0.62, 'rgba(180, 200, 220, 0.32)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, layer.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Subtle vertical optical lens fluting streaks
      if (layer.fluteCount > 0) {
        ctx.globalCompositeOperation = 'multiply';
        for (let i = 0; i < layer.fluteCount; i++) {
          const x = (i / layer.fluteCount) * width;
          const w = width / layer.fluteCount;
          const g = ctx.createLinearGradient(x, 0, x + w, 0);
          g.addColorStop(0, '#a8a8a8');
          g.addColorStop(0.5, '#ffffff');
          g.addColorStop(1, '#a8a8a8');
          ctx.fillStyle = g;
          ctx.fillRect(x, 0, w, height);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      break;
    }
    case 'roughness_grain': {
      const rand = mulberry32((seed + (layer.seedOffset ?? 0)) >>> 0);
      const base = Math.round(layer.baseValue * 255);
      ctx.fillStyle = `rgb(${base},${base},${base})`;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < layer.patchCount; i++) {
        const px = rand() * width;
        const py = rand() * height;
        const pr = (0.4 + rand() * 0.8) * layer.patchRadius;
        const delta = (rand() * 2 - 1) * layer.variance * 255;
        const v = Math.max(20, Math.min(250, Math.round(base + delta)));
        const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
        grad.addColorStop(0, `rgba(${v},${v},${v},0.45)`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'facade_windows': {
      const rand = mulberry32((seed + (layer.seedOffset ?? 0)) >>> 0);
      const rowH = height / layer.rows;
      const colW = width / layer.cols;
      for (let r = 0; r < layer.rows; r++) {
        ctx.fillStyle = layer.trimColor;
        ctx.fillRect(0, r * rowH, width, 6);
        for (let c = 0; c < layer.cols; c++) {
          const wx = c * colW + colW * 0.18;
          const wy = r * rowH + rowH * 0.22;
          const ww = colW * 0.64;
          const wh = rowH * 0.56;

          ctx.fillStyle = layer.frameColor;
          ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

          const roll = rand();
          if (roll < layer.litChance) {
            ctx.fillStyle = layer.litColor;
          } else if (roll < layer.litChance + 0.35) {
            ctx.fillStyle = layer.coolColors[0];
          } else {
            ctx.fillStyle = layer.coolColors[1];
          }
          ctx.fillRect(wx, wy, ww, wh);

          ctx.fillStyle = 'rgba(15, 20, 26, 0.55)';
          ctx.fillRect(wx + ww * 0.48, wy, 2, wh);
        }
      }
      break;
    }
    case 'storefront_bays': {
      const bayWidth = Math.floor(width / layer.bays.length);
      layer.bays.forEach((bay, i) => {
        const bx = i * bayWidth + 10;
        const innerW = bayWidth - 20;
        ctx.fillStyle = '#243447';
        ctx.fillRect(bx, 78, innerW, 152);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
        ctx.fillRect(bx + 8, 92, innerW - 16, 126);
        ctx.fillStyle = bay.awningColor;
        ctx.fillRect(bx - 2, 28, innerW + 4, 42);
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(bay.name, bx + innerW * 0.5, 54);
      });
      break;
    }
    case 'police_door_emblem': {
      ctx.clearRect(0, 0, width, height);

      // Shield badge with crisp dark outline for contrast over any base vehicle paint
      ctx.fillStyle = layer.badgeColor ?? '#1e3a8a';
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(38, 22);
      ctx.lineTo(60, 29);
      ctx.lineTo(56, 62);
      ctx.lineTo(38, 76);
      ctx.lineTo(20, 62);
      ctx.lineTo(16, 29);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = layer.badgeCenterColor ?? '#fbbf24';
      ctx.beginPath();
      ctx.arc(38, 47, 8.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      ctx.font = '900 28px sans-serif';
      ctx.strokeStyle = 'rgba(9, 13, 20, 0.92)';
      ctx.lineWidth = 5;
      ctx.strokeText(layer.title, 72, 50);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(layer.title, 72, 50);

      ctx.font = 'bold 13px monospace';
      ctx.strokeStyle = 'rgba(9, 13, 20, 0.92)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(layer.subtitle, 74, 72);
      ctx.fillStyle = layer.accentColor ?? '#fbbf24';
      ctx.fillText(layer.subtitle, 74, 72);
      break;
    }
    case 'precinct_sign_plate': {
      ctx.fillStyle = layer.bgColor ?? '#0f172a';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = layer.borderColor ?? '#3b82f6';
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, width - 12, height - 12);

      const textCenterX = layer.medicalCross ? width * 0.55 : width * 0.5;
      if (layer.medicalCross) {
        const cx = 62;
        const cy = height * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(cx - 11, cy - 27, 22, 54);
        ctx.fillRect(cx - 27, cy - 11, 54, 22);
      }

      ctx.fillStyle = layer.titleColor ?? '#f8fafc';
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(layer.title, textCenterX, 66);

      ctx.fillStyle = layer.subtitleColor ?? '#93c5fd';
      ctx.font = '600 18px monospace';
      ctx.fillText(layer.subtitle, textCenterX, 100);
      break;
    }
    case 'road_sign_plate': {
      const bg = layer.bgColor ?? '#dc2626';
      const border = layer.borderColor ?? '#ffffff';
      const fg = layer.textColor ?? '#ffffff';
      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      const r = Math.min(width, height) * 0.44;

      ctx.save();
      ctx.beginPath();
      if (layer.shape === 'octagon') {
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4 + Math.PI / 8;
          const px = cx + Math.cos(ang) * r;
          const py = cy + Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else if (layer.shape === 'triangle') {
        ctx.moveTo(cx - r, cy - r * 0.78);
        ctx.lineTo(cx + r, cy - r * 0.78);
        ctx.lineTo(cx, cy + r * 0.92);
        ctx.closePath();
      } else if (layer.shape === 'circle') {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      } else {
        ctx.rect(8, 8, width - 16, height - 16);
      }
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = Math.max(6, Math.round(Math.min(width, height) * 0.045));
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hasSub = Boolean(layer.subtitle && layer.subtitle.trim().length > 0);
      const titleFontSize = Math.round(
        Math.min(width, height) * (layer.title.length > 7 ? 0.16 : 0.24),
      );
      ctx.font = `900 ${titleFontSize}px sans-serif`;
      ctx.fillText(layer.title, cx, hasSub ? cy - titleFontSize * 0.38 : cy);
      if (hasSub && layer.subtitle) {
        const subFontSize = Math.max(14, Math.round(titleFontSize * 0.58));
        ctx.font = `700 ${subFontSize}px monospace`;
        ctx.fillText(layer.subtitle, cx, cy + subFontSize * 0.95);
      }
      break;
    }
  }
}

export function renderJsonTextureToCanvas(
  asset: ProceduralTextureAsset,
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = Math.max(16, Math.min(2048, asset.width));
  canvas.height = Math.max(16, Math.min(2048, asset.height));
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const layer of asset.layers) {
    renderLayer(ctx, asset, layer);
  }
  return canvas;
}

export function renderJsonTexture(
  asset: ProceduralTextureAsset,
  maxDeviceAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = renderJsonTextureToCanvas(asset);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace =
    asset.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(asset.anisotropy ?? 8, maxDeviceAnisotropy);
  if (asset.repeat && (asset.repeat[0] !== 1 || asset.repeat[1] !== 1)) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(asset.repeat[0], asset.repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}
