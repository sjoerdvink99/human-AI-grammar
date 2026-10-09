"""Procedural scene renderer and video I/O.

A *scene spec* is a small JSON description of an animated shot (background, camera,
objects with entrance animations, title and caption). Both the stand-in video API
(tool_2) and the clip model (model_2) produce scene specs, which are rendered here.
"""
from __future__ import annotations

import math
import re
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Iterable, Iterator

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 640, 360
FPS = 24
ENTER_DUR = 0.8
CAMERA_SETTLE = 2.0  # camera moves only during the first seconds so keyframes after that are stable

KINDS = [
    "circle", "rect", "person", "crowd", "building", "skyline", "tree", "globe", "coin",
    "bars", "wave", "cloud", "sun", "arrow", "drop", "house", "car", "factory", "clock",
    "number", "ice", "phone", "heart", "leaf",
]
ENTERS = ["fade", "rise", "pop", "slide", "grow", "none"]

_FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_font_cache: dict[tuple[int, bool], ImageFont.ImageFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    key = (size, bold)
    if key not in _font_cache:
        f = None
        for path in _FONT_CANDIDATES:
            if Path(path).exists():
                try:
                    f = ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
                    break
                except Exception:
                    continue
        _font_cache[key] = f or ImageFont.load_default(size=size)
    return _font_cache[key]


def hex_rgb(h: str, default=(200, 200, 200)) -> tuple[int, int, int]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(h or "").strip())
    if not m:
        return default
    v = m.group(1)
    return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _shade(c, f):
    return tuple(max(0, min(255, int(x * f))) for x in c)


def ease_out(p: float) -> float:
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3


def ease_back(p: float) -> float:
    p = max(0.0, min(1.0, p))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2


# ---------------------------------------------------------------- object drawing

def _draw_object(d: ImageDraw.ImageDraw, kind: str, cx: float, cy: float, s: float, col, label: str | None, t_local: float):
    """Draw one prop centred at (cx, cy) with characteristic size s (pixels)."""
    dark = _shade(col, 0.65)
    light = _shade(col, 1.25)
    r = s / 2
    if kind == "circle":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    elif kind == "rect":
        d.rounded_rectangle([cx - r, cy - r * 0.7, cx + r, cy + r * 0.7], radius=r * 0.12, fill=col)
    elif kind == "person":
        hr = s * 0.13
        d.ellipse([cx - hr, cy - r, cx + hr, cy - r + 2 * hr], fill=col)
        d.rounded_rectangle([cx - s * 0.2, cy - r + 2.3 * hr, cx + s * 0.2, cy + s * 0.15], radius=s * 0.08, fill=col)
        d.rectangle([cx - s * 0.15, cy + s * 0.1, cx - s * 0.03, cy + r], fill=dark)
        d.rectangle([cx + s * 0.03, cy + s * 0.1, cx + s * 0.15, cy + r], fill=dark)
    elif kind == "crowd":
        for i, dx in enumerate((-0.32, 0.0, 0.32)):
            _draw_object(d, "person", cx + dx * s, cy + (0.05 if i != 1 else 0) * s, s * (0.55 if i != 1 else 0.62), col if i == 1 else _shade(col, 0.85), None, t_local)
    elif kind == "building":
        d.rectangle([cx - r * 0.45, cy - r, cx + r * 0.45, cy + r], fill=col)
        for row in range(6):
            for c in range(3):
                x0 = cx - r * 0.33 + c * r * 0.24
                y0 = cy - r * 0.85 + row * r * 0.3
                d.rectangle([x0, y0, x0 + r * 0.12, y0 + r * 0.14], fill=light)
    elif kind == "skyline":
        heights = [0.6, 0.9, 0.5, 1.0, 0.7, 0.8, 0.45]
        bw = s / len(heights)
        for i, hgt in enumerate(heights):
            x0 = cx - r + i * bw
            d.rectangle([x0 + 1, cy + r - s * hgt * 0.9, x0 + bw - 1, cy + r], fill=col if i % 2 else dark)
    elif kind == "tree":
        d.rectangle([cx - s * 0.06, cy, cx + s * 0.06, cy + r], fill=(110, 75, 45))
        d.ellipse([cx - r * 0.75, cy - r, cx + r * 0.75, cy + r * 0.25], fill=col)
    elif kind == "globe":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
        d.ellipse([cx - r * 0.5, cy - r * 0.6, cx + r * 0.1, cy + r * 0.1], fill=(80, 170, 90))
        d.ellipse([cx + r * 0.1, cy + r * 0.05, cx + r * 0.7, cy + r * 0.55], fill=(80, 170, 90))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=light, width=2)
    elif kind == "coin":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
        d.ellipse([cx - r * 0.75, cy - r * 0.75, cx + r * 0.75, cy + r * 0.75], outline=dark, width=max(2, int(s * 0.04)))
        f = font(max(10, int(s * 0.5)), True)
        d.text((cx, cy), "$", font=f, fill=dark, anchor="mm")
    elif kind == "bars":
        vals = [0.35, 0.55, 0.45, 0.8, 1.0]
        bw = s / len(vals)
        grow = ease_out(t_local / 1.2)
        for i, v in enumerate(vals):
            x0 = cx - r + i * bw
            d.rectangle([x0 + 2, cy + r - s * v * grow, x0 + bw - 2, cy + r], fill=col)
    elif kind == "wave":
        pts = []
        for i in range(41):
            x = cx - r + s * i / 40
            y = cy + math.sin(i / 40 * math.pi * 4 + t_local * 2.5) * s * 0.08
            pts.append((x, y))
        pts += [(cx + r, cy + r * 0.6), (cx - r, cy + r * 0.6)]
        d.polygon(pts, fill=col)
    elif kind == "cloud":
        for dx, dy, rr in ((-0.3, 0.05, 0.28), (0.0, -0.1, 0.36), (0.3, 0.05, 0.28)):
            d.ellipse([cx + dx * s - rr * s, cy + dy * s - rr * s, cx + dx * s + rr * s, cy + dy * s + rr * s], fill=col)
    elif kind == "sun":
        for k in range(12):
            a = k * math.pi / 6 + t_local * 0.3
            d.line([cx + math.cos(a) * r * 0.65, cy + math.sin(a) * r * 0.65, cx + math.cos(a) * r, cy + math.sin(a) * r], fill=col, width=max(2, int(s * 0.05)))
        d.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], fill=col)
    elif kind == "arrow":
        d.polygon([(cx - r, cy + r * 0.15), (cx + r * 0.3, cy + r * 0.15), (cx + r * 0.3, cy + r * 0.45),
                   (cx + r, cy), (cx + r * 0.3, cy - r * 0.45), (cx + r * 0.3, cy - r * 0.15), (cx - r, cy - r * 0.15)], fill=col)
    elif kind == "drop":
        d.ellipse([cx - r * 0.6, cy - r * 0.1, cx + r * 0.6, cy + r], fill=col)
        d.polygon([(cx, cy - r), (cx - r * 0.55, cy + r * 0.3), (cx + r * 0.55, cy + r * 0.3)], fill=col)
    elif kind == "house":
        d.rectangle([cx - r * 0.7, cy - r * 0.1, cx + r * 0.7, cy + r], fill=col)
        d.polygon([(cx - r * 0.9, cy - r * 0.05), (cx, cy - r), (cx + r * 0.9, cy - r * 0.05)], fill=dark)
        d.rectangle([cx - r * 0.15, cy + r * 0.4, cx + r * 0.15, cy + r], fill=dark)
    elif kind == "car":
        d.rounded_rectangle([cx - r, cy - r * 0.1, cx + r, cy + r * 0.4], radius=r * 0.15, fill=col)
        d.rounded_rectangle([cx - r * 0.55, cy - r * 0.5, cx + r * 0.45, cy], radius=r * 0.15, fill=col)
        for wx in (-0.55, 0.55):
            d.ellipse([cx + wx * r - r * 0.2, cy + r * 0.25, cx + wx * r + r * 0.2, cy + r * 0.65], fill=(30, 30, 30))
    elif kind == "factory":
        d.rectangle([cx - r, cy, cx + r, cy + r], fill=col)
        d.rectangle([cx + r * 0.4, cy - r * 0.9, cx + r * 0.65, cy], fill=dark)
        puff = (t_local * 0.6) % 1
        d.ellipse([cx + r * 0.35, cy - r * (1.1 + puff * 0.5), cx + r * 0.75, cy - r * (0.8 + puff * 0.5)], fill=(190, 190, 190))
        d.polygon([(cx - r, cy), (cx - r * 0.5, cy - r * 0.4), (cx - r * 0.5, cy), (cx, cy - r * 0.4), (cx, cy)], fill=dark)
    elif kind == "clock":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(245, 245, 245), outline=col, width=max(3, int(s * 0.07)))
        a = t_local * 2.0 - math.pi / 2
        d.line([cx, cy, cx + math.cos(a) * r * 0.75, cy + math.sin(a) * r * 0.75], fill=col, width=3)
        d.line([cx, cy, cx + math.cos(a / 12) * r * 0.45, cy + math.sin(a / 12) * r * 0.45], fill=dark, width=4)
    elif kind == "number":
        text = label or "42%"
        m = re.match(r"([^\d]*)([\d][\d,]*\.?\d*)(.*)", text)
        if m:
            raw = m.group(2).replace(",", "")
            try:
                target = float(raw)
                p = ease_out(t_local / 1.5)
                val = target * p
                decimals = len(raw.split(".")[1]) if "." in raw else 0
                shown = f"{val:,.{decimals}f}" if "," in m.group(2) else f"{val:.{decimals}f}"
                text = m.group(1) + shown + m.group(3)
            except ValueError:
                pass
        d.text((cx, cy), text, font=font(max(14, int(s * 0.55)), True), fill=col, anchor="mm")
        label = None
    elif kind == "ice":
        melt = min(1.0, t_local / 6)
        top = cy - r + s * 0.4 * melt
        d.polygon([(cx - r, cy + r), (cx - r * 0.6, top), (cx + r * 0.5, top + r * 0.1), (cx + r, cy + r)], fill=col)
        d.ellipse([cx - r * 1.1, cy + r * 0.85, cx + r * 1.1, cy + r * 1.1], fill=(90, 150, 210))
    elif kind == "phone":
        d.rounded_rectangle([cx - r * 0.5, cy - r, cx + r * 0.5, cy + r], radius=r * 0.15, fill=(30, 30, 35))
        d.rectangle([cx - r * 0.42, cy - r * 0.85, cx + r * 0.42, cy + r * 0.8], fill=col)
    elif kind == "heart":
        d.ellipse([cx - r, cy - r * 0.7, cx, cy + r * 0.2], fill=col)
        d.ellipse([cx, cy - r * 0.7, cx + r, cy + r * 0.2], fill=col)
        d.polygon([(cx - r * 0.95, cy - r * 0.1), (cx + r * 0.95, cy - r * 0.1), (cx, cy + r)], fill=col)
    elif kind == "leaf":
        d.ellipse([cx - r, cy - r * 0.45, cx + r, cy + r * 0.45], fill=col)
        d.line([cx - r, cy, cx + r, cy], fill=dark, width=2)
    else:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    if label:
        d.text((cx, cy + r + 6), label, font=font(14, True), fill=(255, 255, 255), anchor="ma", stroke_width=2, stroke_fill=(0, 0, 0))


# ---------------------------------------------------------------- frames

def _wrap(text: str, f, width: int) -> list[str]:
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if f.getlength(trial) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _gradient(top, bottom) -> Image.Image:
    a = np.linspace(0, 1, H)[:, None, None]
    arr = (np.array(top)[None, None, :] * (1 - a) + np.array(bottom)[None, None, :] * a)
    arr = np.repeat(arr, W, axis=1).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def render_scene_frame(spec: dict, t: float, bg_cache: dict | None = None) -> Image.Image:
    bg = spec.get("background") or {}
    key = (bg.get("top"), bg.get("bottom"))
    if bg_cache is not None and key in bg_cache:
        img = bg_cache[key].copy()
    else:
        base = _gradient(hex_rgb(bg.get("top"), (20, 30, 60)), hex_rgb(bg.get("bottom"), (40, 80, 120)))
        if bg_cache is not None:
            bg_cache[key] = base
        img = base.copy()
    ground = spec.get("ground")
    if ground:
        ImageDraw.Draw(img).rectangle([0, int(H * 0.78), W, H], fill=hex_rgb(ground, (60, 60, 60)))

    for obj in spec.get("objects", []):
        start = float(obj.get("start", 0) or 0)
        tl = t - start
        if tl < 0:
            continue
        p = tl / ENTER_DUR
        enter = obj.get("enter", "fade")
        alpha, scale, dx, dy = 1.0, 1.0, 0.0, 0.0
        if enter == "fade":
            alpha = ease_out(p)
        elif enter == "rise":
            alpha = ease_out(p)
            dy = (1 - ease_out(p)) * H * 0.15
        elif enter == "pop":
            scale = max(0.01, ease_back(p))
        elif enter == "slide":
            dx = -(1 - ease_out(p)) * W * 0.35
            alpha = ease_out(p)
        elif enter == "grow":
            scale = max(0.01, ease_out(p))
        cx = float(obj.get("x", 0.5)) * W + dx
        cy = float(obj.get("y", 0.5)) * H + dy
        s = float(obj.get("size", 0.3)) * H * scale
        col = hex_rgb(obj.get("color"), (230, 180, 60))
        if alpha >= 0.999:
            _draw_object(ImageDraw.Draw(img), obj.get("kind", "circle"), cx, cy, s, col, obj.get("label"), tl)
        else:
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            _draw_object(ImageDraw.Draw(layer), obj.get("kind", "circle"), cx, cy, s, col, obj.get("label"), tl)
            a = layer.getchannel("A").point(lambda v: int(v * alpha))
            layer.putalpha(a)
            img.paste(layer, (0, 0), layer)

    d = ImageDraw.Draw(img)
    title = spec.get("title")
    if title:
        f = font(30, True)
        a = int(255 * max(0.0, min(1.0, ease_out(t / 0.8))))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for i, line in enumerate(_wrap(title, f, W - 80)[:2]):
            ld.text((W / 2, 34 + i * 36), line, font=f, fill=(255, 255, 255, a), anchor="ma",
                    stroke_width=2, stroke_fill=(0, 0, 0, a // 2))
        img.paste(layer, (0, 0), layer)
        d = ImageDraw.Draw(img)
    caption = spec.get("caption")
    if caption:
        f = font(16)
        lines = _wrap(caption, f, W - 60)[:3]
        band_h = 14 + 22 * len(lines)
        overlay = Image.new("RGBA", (W, band_h), (0, 0, 0, 150))
        img.paste(overlay, (0, H - band_h), overlay)
        d = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            d.text((W / 2, H - band_h + 8 + i * 22), line, font=f, fill=(255, 255, 255), anchor="ma")

    cam = spec.get("camera") or {}
    z0, z1 = float(cam.get("zoom_from", 1.0)), float(cam.get("zoom_to", 1.0))
    z = z0 + (z1 - z0) * ease_out(t / CAMERA_SETTLE)
    if abs(z - 1.0) > 1e-3:
        z = max(1.0, z)
        cw, ch = W / z, H / z
        img = img.crop((int((W - cw) / 2), int((H - ch) / 2), int((W + cw) / 2), int((H + ch) / 2))).resize((W, H), Image.BILINEAR)
    return img


def scene_frames(spec: dict, duration: float) -> Iterator[np.ndarray]:
    cache: dict = {}
    n = max(1, int(round(duration * FPS)))
    for i in range(n):
        yield np.asarray(render_scene_frame(spec, i / FPS, cache))


# ---------------------------------------------------------------- video I/O

def ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def write_video(frames: Iterable[np.ndarray], out: Path, size=(W, H), audio_from: Path | None = None) -> Path:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    silent = out.with_suffix(".silent.mp4") if audio_from else out
    writer = imageio_ffmpeg.write_frames(
        str(silent), size, fps=FPS, codec="libx264", pix_fmt_out="yuv420p", macro_block_size=8,
        quality=7, ffmpeg_log_level="error", output_params=["-movflags", "+faststart"],
    )
    writer.send(None)
    for f in frames:
        writer.send(np.ascontiguousarray(f[:, :, :3]))
    writer.close()
    if audio_from:
        mux_audio(silent, Path(audio_from), out)
        silent.unlink(missing_ok=True)
    return out


def mux_audio(video: Path, audio_src: Path, out: Path) -> None:
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio_src),
           "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "aac", "-shortest",
           "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)


def read_video(path: Path) -> tuple[dict, Iterator[np.ndarray]]:
    gen = imageio_ffmpeg.read_frames(str(path))
    meta = next(gen)
    w, h = meta["size"]

    def frames():
        for raw in gen:
            yield np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 3)

    return meta, frames()


def read_frame_at(path: Path, t: float) -> np.ndarray:
    meta, frames = read_video(path)
    idx = int(round(t * meta.get("fps", FPS)))
    last = None
    for i, f in enumerate(frames):
        last = f
        if i >= idx:
            break
    if last is None:
        raise ValueError("video has no frames")
    return last.copy()


# ---------------------------------------------------------------- voiceover audio

def tts_available() -> bool:
    return shutil.which("say") is not None


def synth_voice(text: str, out_wav: Path) -> float:
    """Synthesize a voiceover with macOS `say`; returns duration in seconds (0 if unavailable)."""
    if not text.strip() or not tts_available():
        return 0.0
    subprocess.run(["say", "-o", str(out_wav), "--file-format=WAVE", "--data-format=LEI16@22050", text],
                   check=True, timeout=60)
    with wave.open(str(out_wav)) as w:
        return w.getnframes() / w.getframerate()


def build_soundtrack(parts: list[tuple[Path | None, float]], out: Path) -> Path | None:
    """Concatenate per-scene voice WAVs, each padded/trimmed to its scene duration."""
    if not any(p for p, _ in parts):
        return None
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error"]
    filters = []
    for i, (wav, dur) in enumerate(parts):
        if wav:
            cmd += ["-i", str(wav)]
        else:
            cmd += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=22050:cl=mono"]
        filters.append(f"[{i}:a]aresample=22050,aformat=channel_layouts=mono,apad=whole_dur={dur:.3f},atrim=0:{dur:.3f}[a{i}]")
    concat = "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
    cmd += ["-filter_complex", ";".join(filters + [concat]), "-map", "[out]", "-c:a", "aac", str(out)]
    subprocess.run(cmd, check=True)
    return out


def render_scenes_to_video(scenes: list[dict], out: Path) -> dict:
    """scenes: [{spec, duration_s, voiceover}] -> mp4 with voiceover. Returns timing info."""
    out = Path(out)
    with tempfile.TemporaryDirectory() as td:
        parts, durations = [], []
        for i, sc in enumerate(scenes):
            wav = Path(td) / f"v{i}.wav"
            vlen = synth_voice(sc.get("voiceover", ""), wav)
            dur = min(12.0, max(float(sc.get("duration_s", 5)), vlen + 0.6))
            durations.append(dur)
            parts.append((wav if vlen else None, dur))

        def all_frames():
            for sc, dur in zip(scenes, durations):
                yield from scene_frames(sc["spec"], dur)

        audio = build_soundtrack(parts, Path(td) / "voice.m4a")
        write_video(all_frames(), out, audio_from=audio)
    times, acc = [], 0.0
    for dur in durations:
        times.append([round(acc, 3), round(acc + dur, 3)])
        acc += dur
    return {"duration": round(acc, 3), "scene_times": times}
