"""
CellForge Demo Plugin — Python helpers.

Tests that plugin pylib gets injected into kernel PYTHONPATH.

Usage:
    import bliss_demo
    bliss_demo.chart([10, 30, 50, 20, 40], labels=["A","B","C","D","E"])
    bliss_demo.info()
"""


class DemoChart:
    """Displays a simple bar chart via the plugin's custom MIME renderer."""

    def __init__(self, values, labels=None, title="Demo Chart"):
        self.values = values
        self.labels = labels or [str(i) for i in range(len(values))]
        self.title = title

    def _repr_mimebundle_(self, **kwargs):
        return {
            "application/vnd.cellforge.demo-chart": {
                "values": self.values,
                "labels": self.labels,
                "title": self.title,
            }
        }

    def __repr__(self):
        return f"<DemoChart: {self.title} ({len(self.values)} bars)>"


def chart(values, labels=None, title="Demo Chart"):
    """Create a demo bar chart.

    The chart is rendered by the bliss-demo frontend plugin — it won't
    display in a plain Python REPL.
    """
    return DemoChart(values, labels=labels, title=title)


def info():
    """Print plugin info — proves the pylib import works."""
    print("bliss-demo plugin v0.1.0")
    print(f"  module: {__file__}")
    print("  contributes: theme, widget, toolbar, sidebar, cell action,")
    print("                keybinding, export format, status bar item")
    return "bliss-demo loaded OK"
