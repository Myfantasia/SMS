from django.db import IntegrityError
from django.test import TestCase

from apps.finance.models_fees import FeeCategory


class FeeCategoryTests(TestCase):
    def test_can_create_category(self):
        category = FeeCategory.objects.create(name='Tuition', description='Core tuition fee')
        self.assertEqual(str(category), 'Tuition')

    def test_name_must_be_unique(self):
        FeeCategory.objects.create(name='Transport')
        with self.assertRaises(IntegrityError):
            FeeCategory.objects.create(name='Transport')
