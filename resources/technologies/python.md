---
id: python
name: Python
keywords: ["python", "python3", "pip", "pytest", "django", "flask", "fastapi", "pandas"]
---

# Python Resource

Craft for Python projects. All sections sourced from official Python and tool documentation.

## Core rules

1. Follow PEP 8 style: 4-space indentation, `snake_case` for functions and variables, `PascalCase` for classes (source: https://peps.python.org/pep-0008/).
2. Use type hints for function signatures; they catch contract errors early and document intent (source: https://docs.python.org/3/library/typing.html).
3. Raise specific exceptions with context (`raise ValueError(f"...") from exc`), never bare `except:` — it swallows bugs including `KeyboardInterrupt` (source: https://docs.python.org/3/tutorial/errors.html).
4. Isolate dependencies in a virtual environment (`python -m venv .venv`) and pin them (`requirements.txt` or `pyproject.toml`) (source: https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/).
5. Prefer standard-library solutions before adding a third-party dependency.

## Testing patterns

1. Use `pytest`: tests live in `tests/`, files named `test_*.py`, functions named `test_*` (source: https://docs.pytest.org/en/stable/explanation/anatomy.html).
2. Every public function gets at least one happy-path and one edge-case test; use `@pytest.mark.parametrize` for input matrices (source: https://docs.pytest.org/en/stable/how-to/parametrize.html).
3. Use fixtures for setup/teardown and `tmp_path` for filesystem isolation; never let tests touch real user data (source: https://docs.pytest.org/en/stable/how-to/tmp_path.html).
4. Run the full suite with `python -m pytest` before reporting done; use `pytest.raises` for expected exceptions (source: https://docs.pytest.org/en/stable/reference/reference.html#pytest-raises).

## Tooling and limits

1. Package metadata lives in `pyproject.toml`; build with `python -m build` (source: https://packaging.python.org/en/latest/tutorials/packaging-projects/).
2. Lint and format with the project's configured tools (commonly `ruff` or `flake8` + `black`); do not add new linters without asking.
3. Type-check with `mypy` when the project configures it (source: https://mypy.readthedocs.io/).
4. Standard library guarantees: Python 3.x docs version-pinned to the project's `requires-python` (source: https://docs.python.org/3/).

## Common mistakes

1. Mutable default arguments (`def f(items=[]):`) — the default is shared across calls; use `None` and initialize inside (source: https://docs.python.org/3/reference/compound_stmts.html#function-definitions).
2. `except Exception: pass` — hides real failures; catch specific exceptions and log or re-raise.
3. Modifying a list while iterating over it — iterate over a copy (`for x in items[:]`).
4. Installing packages into the system Python instead of the project virtual environment.

_Last updated: 2026-07-18_
