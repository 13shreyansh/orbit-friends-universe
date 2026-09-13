from __future__ import annotations


class StaleMemoryRevision(ValueError):
    pass


def validate_expected_revision(*, current_version: int, expected_version: int) -> None:
    if current_version != expected_version:
        raise StaleMemoryRevision(
            f"memory revision changed: expected {expected_version}, current {current_version}"
        )


def next_revision_version(current_version: int) -> int:
    if current_version < 0:
        raise ValueError("current revision version cannot be negative")
    return current_version + 1
