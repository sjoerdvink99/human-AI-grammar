// Scene renderer (the frontend half of tool_2): interactive plan view and [tool_2 translate] scene -> topdown_view.

export function layout(scene, cw, ch, pad = 30) {
  const s = Math.min((cw - 2 * pad) / scene.room.width, (ch - 2 * pad) / scene.room.depth);
  const ox = (cw - s * scene.room.width) / 2, oy = (ch - s * scene.room.depth) / 2;
  return { s, ox, oy, toPx: (x, y) => [ox + x * s, oy + y * s], toM: (px, py) => [(px - ox) / s, (py - oy) / s] };
}

export function drawScene(ctx, scene, { width, height, selection = [], point = null, showIds = false, hover = null }) {
  const L = layout(scene, width, height);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  const [rx, ry] = L.toPx(0, 0);
  const rw = scene.room.width * L.s, rh = scene.room.depth * L.s;
  ctx.fillStyle = '#fbf8f2'; ctx.fillRect(rx, ry, rw, rh);
  // 1 m grid
  ctx.strokeStyle = '#ece6dc'; ctx.lineWidth = 1;
  for (let x = 1; x < scene.room.width; x++) { ctx.beginPath(); ctx.moveTo(rx + x * L.s, ry); ctx.lineTo(rx + x * L.s, ry + rh); ctx.stroke(); }
  for (let y = 1; y < scene.room.depth; y++) { ctx.beginPath(); ctx.moveTo(rx, ry + y * L.s); ctx.lineTo(rx + rw, ry + y * L.s); ctx.stroke(); }
  ctx.strokeStyle = '#333'; ctx.lineWidth = 4; ctx.strokeRect(rx, ry, rw, rh);
  ctx.fillStyle = '#888'; ctx.font = '11px system-ui';
  ctx.fillText(`${scene.room.width} m`, rx + rw / 2 - 12, ry - 8);
  ctx.save(); ctx.translate(rx - 10, ry + rh / 2 + 12); ctx.rotate(-Math.PI / 2); ctx.fillText(`${scene.room.depth} m`, 0, 0); ctx.restore();

  const ordered = [...scene.objects].sort((a, b) => (b.floor ? 1 : 0) - (a.floor ? 1 : 0));
  for (const o of ordered) {
    const [cx, cy] = L.toPx(o.x, o.y);
    const w = o.w * L.s, d = o.d * L.s;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((o.rot * Math.PI) / 180);
    ctx.globalAlpha = o.floor ? 0.6 : 0.95;
    ctx.fillStyle = o.color; ctx.fillRect(-w / 2, -d / 2, w, d);
    ctx.globalAlpha = 1;
    const sel = selection.includes(o.id);
    ctx.strokeStyle = sel ? '#2f6fdf' : o.id === hover ? '#555' : 'rgba(0,0,0,.35)';
    ctx.lineWidth = sel ? 3 : 1;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    if (!o.floor) { // front marker
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const t = Math.min(8, d / 3);
      ctx.beginPath(); ctx.moveTo(-t, d / 2 - t); ctx.lineTo(t, d / 2 - t); ctx.lineTo(0, d / 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // labels on top
  ctx.font = `${showIds ? 13 : 11}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const o of ordered) {
    const [cx, cy] = L.toPx(o.x, o.y);
    const text = showIds ? o.id : o.label;
    const tw = ctx.measureText(text).width;
    const ly = o.floor ? cy + (o.d * L.s) / 2 - 9 : cy;
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(cx - tw / 2 - 2, ly - 7, tw + 4, 14);
    ctx.fillStyle = '#222'; ctx.fillText(text, cx, ly);
  }
  if (point) {
    const [px, py] = L.toPx(point.x, point.y);
    ctx.strokeStyle = '#d0453a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
  }
  ctx.restore();
  return L;
}

/** Topmost object under a point in metres (furniture before rugs). */
export function hitTest(scene, x, y) {
  const inside = (o) => {
    const r = ((o.rot % 360) + 360) % 360, swap = r === 90 || r === 270;
    const w = swap ? o.d : o.w, d = swap ? o.w : o.d;
    return Math.abs(x - o.x) <= w / 2 && Math.abs(y - o.y) <= d / 2;
  };
  return scene.objects.filter((o) => !o.floor).reverse().find(inside) || scene.objects.filter((o) => o.floor).find(inside) || null;
}

/** [tool_2 translate] scene_1 -> topdown_view_1 (PNG data URL with object ids, for model_7). */
export function renderTopDown(scene, size = 900) {
  const c = document.createElement('canvas');
  const aspect = scene.room.depth / scene.room.width;
  c.width = size; c.height = Math.round(size * aspect) + 60;
  drawScene(c.getContext('2d'), scene, { width: c.width, height: c.height, showIds: true });
  return c.toDataURL('image/png');
}
