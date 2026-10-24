import pytest


@pytest.fixture(autouse=True)
def _empty_folder(tmp_path, monkeypatch):
    """Run each test in an empty folder, so your real rules.txt never changes a test's result."""
    monkeypatch.chdir(tmp_path)
