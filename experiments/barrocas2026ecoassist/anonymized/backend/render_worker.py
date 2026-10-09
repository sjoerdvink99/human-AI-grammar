"""Subprocess worker: executes chart programs and captures the rendering.

Reads a JSON list of jobs {id, code, format} on stdin, writes a JSON list of
results on stdout. Each job runs in a fresh namespace with all figures closed.
"""
import base64
import io
import json
import sys
import traceback

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

DPI = 100


def _bbox(b, fig_h):
    # convert display coords (origin bottom-left) to image pixel coords (origin top-left)
    return [float(b.x0), float(fig_h - b.y1), float(b.x1), float(fig_h - b.y0)]


def _layout(fig):
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    w, h = fig.canvas.get_width_height()
    texts, legends, axes, points = [], [], [], []
    for t in fig.findobj(matplotlib.text.Text):
        if not t.get_visible() or not t.get_text().strip():
            continue
        try:
            bb = t.get_window_extent(renderer)
        except Exception:
            continue
        if bb.width <= 0 or bb.height <= 0:
            continue
        rot = float(t.get_rotation()) % 180
        uw, uh = bb.width, bb.height
        if rot not in (0.0, 90.0):
            t.set_rotation(0)
            ub = t.get_window_extent(renderer)
            uw, uh = ub.width, ub.height
            t.set_rotation(rot)
        elif rot == 90.0:
            uw, uh = bb.height, bb.width
        texts.append({"text": t.get_text()[:60], "size": float(t.get_fontsize()), "bbox": _bbox(bb, h),
                      "rot": rot, "w": float(uw), "h": float(uh)})
    for ax in fig.axes:
        if not ax.get_visible():
            continue
        is_pie = any(isinstance(p, matplotlib.patches.Wedge) for p in ax.patches)
        axes.append({
            "bbox": _bbox(ax.get_window_extent(renderer), h),
            "has_title": bool(ax.get_title().strip()),
            "has_xlabel": bool(ax.get_xlabel().strip()),
            "has_ylabel": bool(ax.get_ylabel().strip()),
            "is_pie": is_pie,
        })
        leg = ax.get_legend()
        if leg is not None and leg.get_visible():
            legends.append(_bbox(leg.get_window_extent(renderer), h))
        # data marks in display coords
        for line in ax.get_lines():
            xy = line.get_xydata()
            if len(xy):
                d = ax.transData.transform(xy)
                points += [[float(x), float(h - y)] for x, y in d[:: max(1, len(d) // 200)]]
        for coll in ax.collections:
            try:
                offs = coll.get_offsets()
                if len(offs):
                    d = coll.get_offset_transform().transform(offs)
                    points += [[float(x), float(h - y)] for x, y in d[:: max(1, len(d) // 200)]]
            except Exception:
                pass
        for p in ax.patches:
            try:
                bb = p.get_window_extent(renderer)
                cx, cy = (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2
                points.append([float(cx), float(h - cy)])
                points.append([float(cx), float(h - bb.y1)])
            except Exception:
                pass
    fig_legends = [lg for lg in getattr(fig, "legends", []) if lg.get_visible()]
    for lg in fig_legends:
        legends.append(_bbox(lg.get_window_extent(renderer), h))
    return {"width": w, "height": h, "texts": texts, "legends": legends, "axes": axes, "points": points}


def run_job(job):
    plt.close("all")
    ns = {"__name__": "__chart__", "plt": plt, "np": np}
    out = {"id": job.get("id"), "ok": False}
    stdout_backup = sys.stdout
    sys.stdout = io.StringIO()
    try:
        plt.show = lambda *a, **k: None  # neutralise
        exec(compile(job["code"], "<chart>", "exec"), ns)
        fig = plt.gcf()
        if not fig.axes:
            raise RuntimeError("The program did not draw any axes.")
        fmt = job.get("format", "png")
        if fmt == "svg":
            buf = io.StringIO()
            fig.savefig(buf, format="svg", dpi=DPI)
            out["svg"] = buf.getvalue()
        else:
            layout = _layout(fig)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=DPI)
            png = buf.getvalue()
            img = plt.imread(io.BytesIO(png))
            rgb = img[..., :3]
            out["white_fraction"] = float((rgb.min(axis=2) > 0.96).mean())
            out["png"] = base64.b64encode(png).decode()
            out["layout"] = layout
        out["ok"] = True
    except Exception:
        out["error"] = traceback.format_exc(limit=3)[-1500:]
    finally:
        sys.stdout = stdout_backup
        plt.close("all")
    return out


def main():
    jobs = json.load(sys.stdin)
    fig_dpi = plt.rcParams["figure.dpi"] = DPI  # noqa: F841
    results = [run_job(j) for j in jobs]
    sys.stdout.write(json.dumps(results))


if __name__ == "__main__":
    main()
