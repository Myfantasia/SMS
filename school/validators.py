import os
from django.core.exceptions import ValidationError


def safe_document_validator(file_obj):
    """
    Validates file sizes and extensions to prevent storage exhaustion
    and arbitrary code execution via malicious uploads.
    """
    # 1. Size Check: Cap uploads at 10 Megabytes
    max_size_bytes = 10 * 1024 * 1024
    if file_obj.size > max_size_bytes:
        raise ValidationError("Upload rejected: File size exceeds the 10MB limit.")

    # 2. Extension Check: Only allow safe document and image formats
    valid_extensions = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg']
    ext = os.path.splitext(file_obj.name)[1].lower()

    if ext not in valid_extensions:
        raise ValidationError(
            f"Upload rejected: Unsupported file format. Allowed types are: {', '.join(valid_extensions)}")