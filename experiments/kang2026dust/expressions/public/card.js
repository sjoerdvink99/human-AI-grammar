// P4.4 [tool translate]: archive_choice_1 -> archive_view_1 (a PNG image card rendered on a canvas).

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Render a highlight (and optionally one of its entries) as an image; returns a data URL. */
export function renderCard(highlight, entry) {
  const W = 1080, PAD = 80, inner = W - PAD * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const blocks = [];
  const add = (text, font, color, lh, gapAfter) => {
    ctx.font = font;
    blocks.push({ lines: wrap(ctx, text, inner), font, color, lh, gapAfter });
  };
  add(`“${highlight.text}”`, 'italic 44px Georgia, serif', '#24211c', 60, 20);
  add(`— ${highlight.author || 'Unknown'}, ${highlight.source}`, '28px system-ui, sans-serif', '#7a7366', 38, 50);
  if (entry) {
    add('MY RESPONSE', '600 22px system-ui, sans-serif', '#b4542c', 32, 6);
    add(entry.response, '30px system-ui, sans-serif', '#3b362e', 42, 40);
    add('REMIX', '600 22px system-ui, sans-serif', '#b4542c', 32, 6);
    add(entry.remixText || entry.remix, '34px Georgia, serif', '#24211c', 48, 0);
  }
  const H = PAD * 2 + blocks.reduce((s, b) => s + b.lines.length * b.lh + b.gapAfter, 0) + 40;
  canvas.width = W;
  canvas.height = H;

  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#b4542c';
  ctx.fillRect(0, 0, 14, H);

  let y = PAD;
  for (const b of blocks) {
    ctx.font = b.font;
    ctx.fillStyle = b.color;
    ctx.textBaseline = 'top';
    for (const l of b.lines) {
      ctx.fillText(l, PAD, y);
      y += b.lh;
    }
    y += b.gapAfter;
  }
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#b7ae9e';
  ctx.fillText(entry ? new Date(entry.createdAt).toLocaleDateString() : 'not yet remixed', PAD, H - PAD + 20);
  return canvas.toDataURL('image/png');
}
