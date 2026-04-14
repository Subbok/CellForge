"""
CellForge Mermaid plugin — Python helper.

Usage in a notebook cell:

    import cellforge_mermaid
    cellforge_mermaid.diagram('''
        graph TD
            A[Start] --> B{Decision}
            B -->|Yes| C[Do something]
            B -->|No| D[Do nothing]
    ''')

The diagram source is sent to the frontend as a custom MIME type;
the plugin's JS module lazily loads the Mermaid library from a CDN
and renders the SVG client-side.
"""


class MermaidDiagram:
    """Display object that outputs a custom MIME bundle for CellForge's
    plugin renderer pipeline."""

    def __init__(self, source: str):
        self.source = source.strip()

    def _repr_mimebundle_(self, **kwargs):
        return {
            "application/vnd.cellforge.mermaid": {
                "source": self.source,
            }
        }

    def __repr__(self):
        lines = self.source.split("\n")
        preview = lines[0][:60] + ("..." if len(lines[0]) > 60 else "")
        return f"<MermaidDiagram: {preview}>"


def diagram(source: str) -> MermaidDiagram:
    """Create a Mermaid diagram from the given source string.

    The diagram is rendered by the CellForge frontend — it won't display
    in a plain Python REPL or standard Jupyter (they'd just show the repr).
    """
    return MermaidDiagram(source)
