# Built-in Library

CellForge ships with a small Python helper library that is automatically
available in every notebook kernel. You do not need to install anything.

## Importing

```python
import cellforge as cf
```

## Visualization helpers

### `cf.bar(values, labels, **kwargs)`

Render an inline SVG bar chart in the cell output.

```python
cf.bar([10, 25, 17], ["A", "B", "C"], title="Scores")
```

### `cf.line(values, labels, **kwargs)`

Render an inline SVG line chart.

```python
cf.line([1, 4, 2, 8, 5], ["Mon", "Tue", "Wed", "Thu", "Fri"], title="Traffic")
```

### `cf.pie(values, labels, **kwargs)`

Render an inline SVG pie chart.

```python
cf.pie([40, 30, 30], ["Python", "Rust", "JS"], title="Languages")
```

### `cf.hbar(values, labels, **kwargs)`

Render a horizontal bar chart.

### `cf.stat(label, value, delta=None, caption=None)`

Render a KPI stat card.

```python
cf.stat("Revenue", "$12.4k", delta="+8.2%", caption="vs last month")
```

### `cf.callout(text, kind="info", title=None)`

Render a styled callout box. `kind` can be `info`, `warning`, `error`,
or `success`.

### `cf.progress(value, max, label=None)`

Render a progress bar.

### `cf.diagram(edges, kind="flow", title=None)`

Render a flow or sequence diagram from a list of `(from, to, label)` edges.

```python
cf.diagram([
    ("Start", "Process", "begin"),
    ("Process", "End", "finish"),
], title="Workflow")
```

### `cf.mermaid(source)`

Render a Mermaid diagram. Requires an internet connection (loads from CDN).

```python
cf.mermaid("""
graph TD
    A[Start] --> B[Process]
    B --> C[End]
""")
```

## Common keyword arguments

| Argument | Type       | Description                       |
| -------- | ---------- | --------------------------------- |
| `title`  | `str`      | Chart title (displayed above)     |
| `color`  | `str`      | Single color for all data points  |
| `colors` | `list[str]`| Per-item colors                   |
| `scale`  | `float`    | Width multiplier (default `1.0`)  |
