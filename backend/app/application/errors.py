from __future__ import annotations


class ApplicationError(Exception):
    """A user-facing application failure independent from FastAPI."""


class InvalidRequestError(ApplicationError):
    pass


class PayloadValidationError(ApplicationError):
    pass


class ResourceNotFoundError(ApplicationError):
    pass


class ResourceConflictError(ApplicationError):
    pass


class ResourceStateError(ApplicationError):
    pass


class UnsupportedMediaError(ApplicationError):
    pass


class MediaTooLargeError(ApplicationError):
    pass
