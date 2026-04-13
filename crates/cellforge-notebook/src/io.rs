use crate::format::Notebook;
use anyhow::{Context, Result};
use std::path::Path;

pub fn read_notebook(path: &Path) -> Result<Notebook> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read notebook: {}", path.display()))?;
    let notebook: Notebook = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse notebook: {}", path.display()))?;
    Ok(notebook)
}

pub fn write_notebook(path: &Path, notebook: &Notebook) -> Result<()> {
    let content = serde_json::to_string_pretty(notebook).context("Failed to serialize notebook")?;
    std::fs::write(path, content)
        .with_context(|| format!("Failed to write notebook: {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::Cell;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn sample_notebook_json() -> &'static str {
        r##"{
  "metadata": {
    "kernelspec": {
      "name": "python3",
      "display_name": "Python 3",
      "language": "python"
    },
    "language_info": {
      "name": "python",
      "version": "3.11.0",
      "file_extension": ".py"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 5,
  "cells": [
    {
      "cell_type": "markdown",
      "id": "md-1",
      "source": "# Test Notebook",
      "metadata": {}
    },
    {
      "cell_type": "code",
      "id": "code-1",
      "source": ["print('hello')\n", "x = 42"],
      "metadata": {},
      "outputs": [
        {
          "output_type": "stream",
          "name": "stdout",
          "text": "hello\n"
        }
      ],
      "execution_count": 1
    },
    {
      "cell_type": "code",
      "id": "code-2",
      "source": "x + 1",
      "metadata": {},
      "outputs": [
        {
          "output_type": "execute_result",
          "execution_count": 2,
          "data": {
            "text/plain": "43"
          },
          "metadata": {}
        }
      ],
      "execution_count": 2
    }
  ]
}"##
    }

    #[test]
    fn read_and_write_roundtrip() {
        let mut tmp = NamedTempFile::new().unwrap();
        tmp.write_all(sample_notebook_json().as_bytes()).unwrap();
        tmp.flush().unwrap();

        let notebook = read_notebook(tmp.path()).unwrap();
        assert_eq!(notebook.nbformat, 4);
        assert_eq!(notebook.nbformat_minor, 5);
        assert_eq!(notebook.cells.len(), 3);

        match &notebook.cells[0] {
            Cell::Markdown(c) => assert_eq!(c.source.as_str(), "# Test Notebook"),
            _ => panic!("Expected markdown cell"),
        }
        match &notebook.cells[1] {
            Cell::Code(c) => {
                assert_eq!(c.source.as_str(), "print('hello')\nx = 42");
                assert_eq!(c.execution_count, Some(1));
                assert_eq!(c.outputs.len(), 1);
            }
            _ => panic!("Expected code cell"),
        }

        // Write back and re-read
        let tmp2 = NamedTempFile::new().unwrap();
        write_notebook(tmp2.path(), &notebook).unwrap();
        let notebook2 = read_notebook(tmp2.path()).unwrap();
        assert_eq!(notebook2.cells.len(), 3);
    }
}
