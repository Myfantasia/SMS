"""Seed the waiver discount types that already exist as StudentFeeAdjustment
adjustment types (spec section 4.12). Idempotent: get_or_create on name, so
re-running never duplicates a row or overwrites an admin's edits.

Each seeded row is kind='fixed' with value 0 because the real amount is supplied
per adjustment. Admins can later change kind/value/category/active in the admin
or via the discount-types API.

Run `python manage.py seed_discount_types` after the finance migration lands.
"""
from django.core.management.base import BaseCommand

from apps.finance.models_fees import DiscountType, StudentFeeAdjustment

# The adjustment types that are waivers (they reduce a balance). Penalty and
# correction are not discounts and are deliberately not seeded.
WAIVER_ADJUSTMENT_TYPES = ('discount', 'scholarship', 'bursary')


class Command(BaseCommand):
    help = "Seed DiscountType rows for the existing waiver adjustment types (idempotent)."

    def handle(self, *args, **options):
        labels = dict(StudentFeeAdjustment.ADJUSTMENT_TYPE_CHOICES)
        for code in WAIVER_ADJUSTMENT_TYPES:
            name = labels[code]
            _, created = DiscountType.objects.get_or_create(
                name=name,
                defaults={'kind': 'fixed', 'value': 0, 'active': True},
            )
            self.stdout.write(f"  {'created' if created else 'exists'}: {name}")
        self.stdout.write(self.style.SUCCESS("Discount types seeded."))
