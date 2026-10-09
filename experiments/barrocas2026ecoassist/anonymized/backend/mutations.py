"""tool_3 modify: deterministic edit operators applied to corpus programs.

Each operator appends a small, self-contained repair snippet to a program. The
trained repair model (r9) learns which operator helps for which metric profile.
"""
from __future__ import annotations

OPERATORS: dict[str, tuple[str, str]] = {
    "tight_layout": (
        "Recompute the layout so labels fit (fig.tight_layout()).",
        "plt.gcf().tight_layout()",
    ),
    "rotate_xticks": (
        "Rotate x tick labels 45 degrees, right-aligned.",
        "for _ax in plt.gcf().axes:\n"
        "    plt.setp(_ax.get_xticklabels(), rotation=45, ha='right')\n"
        "plt.gcf().tight_layout()",
    ),
    "thin_xticks": (
        "Show only every n-th x tick label when there are many.",
        "for _ax in plt.gcf().axes:\n"
        "    _lbls = [l for l in _ax.get_xticklabels()]\n"
        "    if len(_lbls) > 10:\n"
        "        _step = max(2, len(_lbls) // 8)\n"
        "        for _i, _l in enumerate(_lbls):\n"
        "            _l.set_visible(_i % _step == 0)",
    ),
    "enlarge_figure": (
        "Increase the figure size so there is more room for marks and labels.",
        "_w, _h = plt.gcf().get_size_inches()\n"
        "plt.gcf().set_size_inches(_w * 1.4, _h * 1.25)\n"
        "plt.gcf().tight_layout()",
    ),
    "larger_fonts": (
        "Raise every text element to at least 9 pt.",
        "import matplotlib.text as _mt\n"
        "for _t in plt.gcf().findobj(_mt.Text):\n"
        "    if _t.get_fontsize() < 9:\n"
        "        _t.set_fontsize(9)",
    ),
    "legend_outside": (
        "Move legends outside the plotting area to the right.",
        "for _ax in plt.gcf().axes:\n"
        "    if _ax.get_legend() is not None:\n"
        "        _ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), borderaxespad=0)\n"
        "plt.gcf().tight_layout()",
    ),
    "legend_best": (
        "Let matplotlib place legends where they cover the fewest marks.",
        "for _ax in plt.gcf().axes:\n"
        "    if _ax.get_legend() is not None:\n"
        "        _ax.legend(loc='best')",
    ),
    "shrink_figure": (
        "Reduce the figure size to remove empty canvas.",
        "_w, _h = plt.gcf().get_size_inches()\n"
        "plt.gcf().set_size_inches(_w * 0.75, _h * 0.75)\n"
        "plt.gcf().tight_layout()",
    ),
}
OPERATOR_KEYS = list(OPERATORS)


def apply_operator(code: str, op: str) -> str:
    """Return a modified copy of the program (r1_1 -> r1_2)."""
    desc, snippet = OPERATORS[op]
    return f"{code.rstrip()}\n\n# repair: {op}\n{snippet}\n"
