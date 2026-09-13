from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.application.errors import (
    ApplicationError,
    InvalidRequestError,
    MediaTooLargeError,
    PayloadValidationError,
    ResourceConflictError,
    ResourceNotFoundError,
    ResourceStateError,
    UnsupportedMediaError,
)


ERROR_STATUS = {
    InvalidRequestError: 400,
    ResourceNotFoundError: 404,
    ResourceConflictError: 409,
    ResourceStateError: 409,
    MediaTooLargeError: 413,
    UnsupportedMediaError: 415,
    PayloadValidationError: 422,
}


def install_application_error_handler(application: FastAPI) -> None:
    @application.exception_handler(ApplicationError)
    async def application_error_handler(_request: Request, error: ApplicationError) -> JSONResponse:
        status_code = next(
            (status for error_type, status in ERROR_STATUS.items() if isinstance(error, error_type)),
            400,
        )
        return JSONResponse(status_code=status_code, content={"detail": str(error)})

