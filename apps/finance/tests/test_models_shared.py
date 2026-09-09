from django.test import TestCase
from apps.finance.models_shared import (
    CashAccount, DocumentSequenceCounter,
    FinancialRecordImmutableError,
)
from apps.finance.services_shared import next_document_number
from apps.finance.tests.models import DummyImmutableModel


class ImmutableFinancialRecordMixinTests(TestCase):
    def test_protected_field_cannot_change_after_creation(self):
        obj = DummyImmutableModel.objects.create(amount=100)
        obj.amount = 200
        with self.assertRaises(FinancialRecordImmutableError):
            obj.save()

    def test_unprotected_field_can_change_after_creation(self):
        obj = DummyImmutableModel.objects.create(amount=100)
        obj.note = 'updated'
        obj.save()
        obj.refresh_from_db()
        self.assertEqual(obj.note, 'updated')

    def test_protected_field_is_free_to_set_on_creation(self):
        obj = DummyImmutableModel.objects.create(amount=100)
        self.assertEqual(obj.amount, 100)


class NextDocumentNumberTests(TestCase):
    def test_first_number_for_a_type_and_year_is_one(self):
        number = next_document_number('INV', year=2026)
        self.assertEqual(number, 'INV-2026-000001')

    def test_numbers_increment_and_never_collide(self):
        first = next_document_number('INV', year=2026)
        second = next_document_number('INV', year=2026)
        self.assertNotEqual(first, second)
        self.assertEqual(second, 'INV-2026-000002')

    def test_different_document_types_have_independent_sequences(self):
        next_document_number('INV', year=2026)
        receipt_number = next_document_number('RCPT', year=2026)
        self.assertEqual(receipt_number, 'RCPT-2026-000001')

    def test_different_years_have_independent_sequences(self):
        next_document_number('INV', year=2026)
        number_2027 = next_document_number('INV', year=2027)
        self.assertEqual(number_2027, 'INV-2027-000001')


class CashAccountTests(TestCase):
    def test_can_create_cash_account(self):
        account = CashAccount.objects.create(name='Main Bank Account', account_type='bank')
        self.assertEqual(str(account), 'Main Bank Account')
