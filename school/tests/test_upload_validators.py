import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from PIL import Image

from school.validators import profile_pic_validator


def _real_png(name='ok.png'):
    buf = io.BytesIO()
    Image.new('RGB', (10, 10), color='red').save(buf, format='PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


class ProfilePicValidatorTests(SimpleTestCase):
    def test_accepts_a_real_image(self):
        profile_pic_validator(_real_png())  # should not raise

    def test_rejects_oversized_file(self):
        oversized = SimpleUploadedFile('big.png', b'\x00' * (6 * 1024 * 1024), content_type='image/png')
        with self.assertRaises(ValidationError):
            profile_pic_validator(oversized)

    def test_rejects_disallowed_extension(self):
        buf = io.BytesIO()
        Image.new('RGB', (10, 10), color='blue').save(buf, format='PNG')
        disguised = SimpleUploadedFile('not_allowed.gif', buf.getvalue(), content_type='image/gif')
        with self.assertRaises(ValidationError):
            profile_pic_validator(disguised)

    def test_rejects_non_image_disguised_as_png(self):
        fake = SimpleUploadedFile('fake.png', b'this is not an image, just text', content_type='image/png')
        with self.assertRaises(ValidationError):
            profile_pic_validator(fake)
