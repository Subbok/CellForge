"""
CellForge — built-in Python library for notebooks.

One import gives you everything:

    import cellforge as cf

    # Interactive widgets
    s = cf.slider("Speed", min=1, max=100, value=50)
    b = cf.button("Run")
    t = cf.text("Name", value="Alice")
    d = cf.dropdown("Color", options=["red", "green", "blue"])

    # Charts
    cf.bar([10, 30, 50], labels=["A", "B", "C"], title="Sales")
    cf.line([1, 4, 2, 8], title="Trend", color="#ff79c6")
    cf.pie([40, 30, 20], labels=["X", "Y", "Z"])
    cf.hbar([90, 60, 80], labels=["CPU", "RAM", "Disk"])

    # Diagrams
    cf.mermaid("graph TD; A-->B")

    # UI elements
    cf.stat("Accuracy", "94.2%", delta="+1.3%")
    cf.callout("Done!", kind="success")
    cf.progress(73, 100, label="Training")

    # Live-updating progress
    for i in cf.track(range(100), label="Epoch"):
        train_step()
"""

__version__ = "0.3.0"

# Widgets (interactive, stateful) — from separate module
from cellforge_ui import slider, button, text, dropdown, Widget

# ── Internal imports ──

import uuid as _uuid

try:
    from IPython.display import display as _display, update_display as _update_display, clear_output as _clear_output
    _HAS_IPYTHON = True
except ImportError:
    _HAS_IPYTHON = False


# ── MIME base ──

class _MimeObj:
    """Base class for objects that render via a custom MIME bundle."""
    _mime_type = "application/vnd.cellforge.viz"

    def __init__(self, kind, **data):
        self._kind = kind
        self._data = data

    def _repr_mimebundle_(self, **kwargs):
        return {self._mime_type: {"kind": self._kind, **self._data}}

    def __repr__(self):
        return f"<cellforge.{self._kind}>"


# ── Charts ──

def bar(values, labels=None, title="", color=None, colors=None, scale=1.0):
    """Vertical bar chart."""
    return _MimeObj("bar",
        values=list(values),
        labels=labels or [str(i) for i in range(len(values))],
        title=title, color=color, colors=colors, scale=scale,
    )

def line(values, labels=None, title="", color=None, scale=1.0, show_every=1):
    """Line chart with connected dots."""
    return _MimeObj("line",
        values=list(values),
        labels=labels or [str(i) for i in range(len(values))],
        title=title, color=color, scale=scale, show_every=int(show_every),
    )

def pie(values, labels=None, title="", colors=None, scale=1.0):
    """Pie chart."""
    return _MimeObj("pie",
        values=list(values),
        labels=labels or [str(i) for i in range(len(values))],
        title=title, colors=colors, scale=scale,
    )

def hbar(values, labels=None, title="", color=None, colors=None, scale=1.0):
    """Horizontal bar chart."""
    return _MimeObj("hbar",
        values=list(values),
        labels=labels or [str(i) for i in range(len(values))],
        title=title, color=color, colors=colors, scale=scale,
    )


# ── UI elements ──

def stat(label, value, delta=None, caption=None):
    """KPI stat tile with an optional delta indicator."""
    return _MimeObj("stat",
        label=str(label),
        value=str(value),
        delta=str(delta) if delta is not None else None,
        caption=str(caption) if caption is not None else None,
    )

def callout(text_content, kind="info", title=None):
    """Colored callout box. Kinds: info, warning, error, success."""
    return _MimeObj("callout",
        text=str(text_content),
        callout_kind=kind,
        callout_title=title,
    )

def progress(value, max=100, label="", color=None):
    """Static progress bar."""
    return _MimeObj("progress",
        value=float(value),
        max=float(max),
        label=str(label),
        color=color,
    )


# ── Diagrams (pure SVG) ──

def diagram(edges, kind="flow", title="", scale=1.0):
    """Simple diagram — pure SVG, works everywhere (PDF, HTML, notebook).

    kind="flow":
        edges: list of tuples (from, to) or (from, to, label)
    kind="sequence":
        edges: list of tuples (from, to, label)
    """
    return _MimeObj("diagram",
        edges=[(e[0], e[1], e[2] if len(e) > 2 else "") for e in edges],
        diagram_kind=kind, title=title, scale=scale,
    )


# ── Mermaid diagrams ──

class MermaidDiagram:
    """Display object that outputs a custom MIME bundle for CellForge's
    Mermaid renderer."""

    def __init__(self, source: str, scale: float = 1.0):
        self.source = source.strip()
        self.scale = scale

    def _repr_mimebundle_(self, **kwargs):
        return {
            "application/vnd.cellforge.mermaid": {
                "source": self.source,
                "scale": self.scale,
            }
        }

    def __repr__(self):
        lines = self.source.split("\n")
        preview = lines[0][:60] + ("..." if len(lines[0]) > 60 else "")
        return f"<MermaidDiagram: {preview}>"


def mermaid(source: str, scale: float = 1.0) -> MermaidDiagram:
    """Create a Mermaid diagram from the given source string."""
    return MermaidDiagram(source, scale=scale)


# ── Live-updating progress ──

class Progress:
    """A progress bar that updates in-place using IPython display."""

    def __init__(self, total=100, label=""):
        self.total = total
        self.label = label
        self.current = 0
        self._display_id = str(_uuid.uuid4())
        self._shown = False

    def _bundle(self):
        return {
            _MimeObj._mime_type: {
                "kind": "progress",
                "value": float(self.current),
                "max": float(self.total),
                "label": self.label,
                "color": None,
            }
        }

    def show(self):
        """Initial display — must call once before update()."""
        if _HAS_IPYTHON and not self._shown:
            _display(self, display_id=self._display_id)
            self._shown = True

    def update(self, value, label=None):
        """Update the progress bar value in-place."""
        self.current = value
        if label is not None:
            self.label = label
        if not _HAS_IPYTHON or not self._shown:
            return
        try:
            _update_display(self, display_id=self._display_id)
        except Exception:
            _clear_output(wait=True)
            _display(self, display_id=self._display_id)

    def done(self, label=None):
        """Mark as complete (fill to 100%)."""
        self.current = self.total
        if label is not None:
            self.label = label
        self.update(self.current)

    def _repr_mimebundle_(self, **kwargs):
        return self._bundle()

    def __repr__(self):
        pct = (self.current / max(self.total, 1)) * 100
        return f"<Progress: {self.label} {pct:.0f}%>"


def track(iterable, label="", total=None):
    """Wrap an iterable with a live-updating progress bar. Like tqdm."""
    if total is None:
        try:
            total = len(iterable)
        except TypeError:
            total = 0

    p = Progress(total=total, label=label)
    p.show()

    for i, item in enumerate(iterable):
        yield item
        p.update(i + 1)

    p.done()
