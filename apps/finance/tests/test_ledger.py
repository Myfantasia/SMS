import threading

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.db import connection
from django.test import TestCase, TransactionTestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import StudentFeeLedgerEntry, FeeCategory
from apps.finance.services_fees import post_ledger_entry


def setUpModule():
    """`finance` has no real migrations yet (migrations are applied manually by
    the user for this project), so Django's post_migrate signal never creates a
    ContentType row for FeeCategory the way it would for a normally-migrated
    app. Left alone, the first GenericForeignKey access happens lazily inside
    whichever test runs first, inside that TestCase's per-test savepoint — the
    row then gets rolled back at that test's teardown while ContentType's
    process-wide get_for_model() cache keeps the now-dangling id, breaking every
    later test in this module. Pre-warm it once here, before any test's
    transaction opens, so the row is committed for real."""
    ContentType.objects.get_for_model(FeeCategory)


class LedgerTestData:
    @classmethod
    def _make_student(cls, username):
        user = User.objects.create_user(username=username, password='x')
        # StudentExtra.roll is unique=True with no default (see apps/identity/models.py) —
        # every StudentExtra needs a distinct roll, so reuse the (already-unique) username,
        # truncated to roll's max_length, matching the convention in school/tests/base.py.
        return StudentExtra.objects.create(user=user, roll=username[:20])


class PostLedgerEntryTests(LedgerTestData, TestCase):
    def setUp(self):
        self.student = self._make_student('ledger_student_a')
        self.category = FeeCategory.objects.create(name='Tuition')

    def test_first_charge_sets_running_balance_to_charge_amount(self):
        entry = post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Test charge',
        )
        self.assertEqual(entry.running_balance, 15000)

    def test_payment_reduces_running_balance(self):
        post_ledger_entry(
            student=self.student, entry_type='charge', amount=15000,
            reference=self.category, description='Charge',
        )
        payment_entry = post_ledger_entry(
            student=self.student, entry_type='payment', amount=-5000,
            reference=self.category, description='Payment',
        )
        self.assertEqual(payment_entry.running_balance, 10000)

    def test_entries_are_ordered_and_immutable_history(self):
        post_ledger_entry(student=self.student, entry_type='charge', amount=1000, reference=self.category, description='a')
        post_ledger_entry(student=self.student, entry_type='charge', amount=2000, reference=self.category, description='b')
        balances = list(
            StudentFeeLedgerEntry.objects.filter(student=self.student).order_by('id').values_list('running_balance', flat=True)
        )
        self.assertEqual(balances, [1000, 3000])

    def test_different_students_have_independent_balances(self):
        other_student = self._make_student('ledger_student_b')
        post_ledger_entry(student=self.student, entry_type='charge', amount=5000, reference=self.category, description='a')
        entry = post_ledger_entry(student=other_student, entry_type='charge', amount=9000, reference=self.category, description='b')
        self.assertEqual(entry.running_balance, 9000)


class ConcurrentPaymentTests(LedgerTestData, TransactionTestCase):
    """TransactionTestCase (not TestCase) is required here — select_for_update()
    row locking only takes effect against real, committed transactions running
    in separate threads; TestCase wraps each test in one outer transaction that
    would hide any race."""

    def test_concurrent_postings_never_lose_an_update(self):
        student = self._make_student('ledger_concurrent_student')
        category = FeeCategory.objects.create(name='Tuition')
        post_ledger_entry(student=student, entry_type='charge', amount=100000, reference=category, description='opening charge')

        errors = []

        def make_payment():
            try:
                post_ledger_entry(student=student, entry_type='payment', amount=-1000, reference=category, description='concurrent payment')
            except Exception as exc:  # noqa: BLE001 - surfaced via `errors` below
                errors.append(exc)
            finally:
                # Django opens a separate thread-local connection per thread and never
                # closes it automatically outside the request/response cycle — without
                # this, all 10 connections stay open after the threads finish, and the
                # test database can't be dropped at suite teardown.
                connection.close()

        threads = [threading.Thread(target=make_payment) for _ in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        final_entry = StudentFeeLedgerEntry.objects.filter(student=student).order_by('-id').first()
        self.assertEqual(final_entry.running_balance, 100000 - 10 * 1000)
