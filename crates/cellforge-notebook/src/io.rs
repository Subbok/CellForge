use crate::format::Notebook;
use anyhow::{Context, Result, bail};
use std::path::Path;

/// Hard cap on notebook file size. Refuses to even read files larger than
/// this into memory — blocks the DoS vector where a malicious user drops a
/// multi-GB `.ipynb` into a shared workspace and causes every reader to OOM.
/// 32 MiB covers the largest real notebooks (ML training runs with embedded
/// plots) while staying safely under any reasonable server memory budget.
pub const MAX_NOTEBOOK_SIZE: u64 = 32 * 1024 * 1024;

pub fn read_notebook(path: &Path) -> Result<Notebook> {
    // Stat first and reject oversize files without reading — prevents
    // allocating a huge String only to fail parsing.
    let meta = std::fs::metadata(path)
        .with_context(|| format!("Failed to stat notebook: {}", path.display()))?;
    if meta.len() > MAX_NOTEBOOK_SIZE {
        bail!(
            "notebook '{}' is {} MiB, exceeds {} MiB cap",
            path.display(),
            meta.len() / 1024 / 1024,
            MAX_NOTEBOOK_SIZE / 1024 / 1024
        );
    }
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read notebook: {}", path.display()))?;
    let notebook: Notebook = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse notebook: {}", path.display()))?;
    Ok(notebook)
}

pub fn write_notebook(path: &Path, notebook: &Notebook) -> Result<()> {
    let content = serde_json::to_string_pretty(notebook).context("Failed to serialize notebook")?;

    // Write to a sibling temp file, then rename onto the target. `rename` is
    // atomic on POSIX and on Windows since Win10 (MoveFileExW). Keeping the
    // temp in the same directory avoids crossing a filesystem boundary —
    // cross-fs rename would fall back to a copy+delete and lose atomicity.
    // The point: a crash mid-write can never leave a half-written ipynb on
    // disk; the user either sees the old version or the fully-written new one.
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("notebook path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("notebook path has no file name: {}", path.display()))?;
    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));

    if let Err(e) = std::fs::write(&tmp_path, &content) {
        return Err(anyhow::Error::from(e).context(format!(
            "Failed to write temp notebook: {}",
            tmp_path.display()
        )));
    }
    if let Err(e) = std::fs::rename(&tmp_path, path) {
        // Best-effort cleanup so we don't leak a `.tmp` next to the target
        // when the rename itself fails (e.g. permission, target locked).
        let _ = std::fs::remove_file(&tmp_path);
        return Err(anyhow::Error::from(e).context(format!(
            "Failed to atomically replace notebook: {}",
            path.display()
        )));
    }
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
