"""
CellForge widget helpers.

This module is embedded in the CellForge binary and written to
~/.config/cellforge/pylib/ on server startup, then exposed to every
launched kernel via PYTHONPATH — so `import cellforge_ui` works no
matter where the notebook lives on disk.
"""
import uuid

# Global registry for widgets to avoid expensive and dangerous gc.get_objects() calls
_WIDGETS = {}

class Widget:
    def __init__(self, kind, **kwargs):
        self.id = str(uuid.uuid4())
        self.kind = kind
        self.args = kwargs
        self._value = kwargs.get('value')
        # Register widget
        _WIDGETS[self.id] = self

    def _repr_mimebundle_(self, include=None, exclude=None):
        return {
            'application/vnd.cellforge.widget+json': {
                'id': self.id,
                'kind': self.kind,
                'args': self.args,
                'value': self._value,
            }
        }

    @property
    def value(self):
        return self._value

def slider(label="Value", min=0, max=100, step=1, value=50):
    return Widget('slider', label=label, min=min, max=max, step=step, value=value)

def button(label="Click me"):
    return Widget('button', label=label)

def text(label="Input", value=""):
    return Widget('text', label=label, value=value)

def dropdown(label="Select", options=[], value=None):
    if value is None and options:
        value = options[0]
    return Widget('dropdown', label=label, options=options, value=value)
