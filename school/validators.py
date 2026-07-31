import os
from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError


def profile_pic_validator(file_obj):
    """
    Validates profile picture uploads (Teacher/Staff/Student). Unlike
    safe_document_validator, this only ever needs to accept real images, so it goes
    one step further than an extension check: Image.verify() actually decodes the
    file to confirm it's a genuine image rather than some other file type wearing a
    .png/.jpg extension.
    """
    max_size_bytes = 5 * 1024 * 1024
    if file_obj.size > max_size_bytes:
        raise ValidationError("Upload rejected: Profile picture exceeds the 5MB limit.")

    valid_extensions = ['.png', '.jpg', '.jpeg']
    ext = os.path.splitext(file_obj.name)[1].lower()
    if ext not in valid_extensions:
        raise ValidationError(
            f"Upload rejected: Unsupported file format. Allowed types are: {', '.join(valid_extensions)}")

    file_obj.seek(0)
    try:
        Image.open(file_obj).verify()
    except (UnidentifiedImageError, OSError):
        raise ValidationError("Upload rejected: File is not a valid image.")
    finally:
        # Image.verify() leaves the file object in a state where it can't be reused
        # (Pillow closes/consumes it) — rewind so Django can still save the upload.
        file_obj.seek(0)


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