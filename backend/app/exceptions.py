class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class PdfValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(message, status_code=400)


class NotFoundError(AppError):
    def __init__(self, message: str = "Purchase order not found."):
        super().__init__(message, status_code=404)


class ConflictError(AppError):
    def __init__(self, message: str):
        super().__init__(message, status_code=409)
