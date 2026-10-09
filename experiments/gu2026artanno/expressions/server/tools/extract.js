// tool_1 extract: artwork_metadata_1 -> bounding_boxes_1 + basic_labels_1 (deterministic parsing).

/**
 * @param {{id:string,width:number,height:number}[]} artworks
 * @param {{artworkId:string, objects:{label:string,bbox:number[]}[]}[]} artworkMetadata
 */
export function tool1Extract(artworks, artworkMetadata) {
  const boundingBoxes = [];
  const basicLabels = [];
  const errors = [];
  for (const meta of artworkMetadata) {
    const art = artworks.find((a) => a.id === meta.artworkId);
    if (!art) { errors.push(`metadata for unknown artwork ${meta.artworkId}`); continue; }
    (meta.objects || []).forEach((obj, i) => {
      const bbox = Array.isArray(obj.bbox) ? obj.bbox.map(Number) : [];
      if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) { errors.push(`${meta.artworkId} object ${i}: invalid bbox`); return; }
      let [x, y, w, h] = bbox;
      x = Math.max(0, Math.min(art.width - 1, x));
      y = Math.max(0, Math.min(art.height - 1, y));
      w = Math.max(1, Math.min(art.width - x, w));
      h = Math.max(1, Math.min(art.height - y, h));
      const unitId = `${meta.artworkId}-u${i + 1}`;
      boundingBoxes.push({ unitId, artworkId: meta.artworkId, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      basicLabels.push({ unitId, label: String(obj.label || 'unknown').toLowerCase().trim() });
    });
  }
  return { boundingBoxes, basicLabels, errors };
}
