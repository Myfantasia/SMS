import datetime

from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase

from apps.identity.models import StudentExtra
from apps.finance.models_fees import Payment, Receipt
from apps.finance.models_shared import FinancialRecordImmutableError


class PaymentModelTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='payment_student', password='x')
        self.student = StudentExtra.objects.create(user=student_user, roll='payment_student')
        self.recorder = User.objects.create_user(username='payment_recorder', password='x')

    def test_can_create_manual_payment(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='cash', reference='RCPT-manual-1',
            status='confirmed', recorded_by=self.recorder, date=datetime.date(2026, 9, 9),
        )
        self.assertEqual(payment.status, 'confirmed')

    def test_amount_cannot_be_changed_after_creation(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='cash', reference='RCPT-manual-2',
            status='confirmed', recorded_by=self.recorder, date=datetime.date(2026, 9, 9),
        )
        payment.amount = 99999
        with self.assertRaises(FinancialRecordImmutableError):
            payment.save()

    def test_status_can_change_to_failed_after_creation(self):
        payment = Payment.objects.create(
            student=self.student, amount=5000, method='mpesa', reference='RCPT-manual-3',
            status='pending', recorded_by=self.recorder, date=datetime.date(2026, 9, 9),
        )
        payment.status = 'failed'
        payment.save()
        payment.refresh_from_db()
        self.assertEqual(payment.status, 'failed')


class ReceiptModelTests(TestCase):
    def setUp(self):
        student_user = User.objects.create_user(username='receipt_student', password='x')
        student = StudentExtra.objects.create(user=student_user, roll='receipt_student')
        recorder = User.objects.create_user(username='receipt_recorder', password='x')
        self.payment = Payment.objects.create(
            student=student, amount=5000, method='cash', reference='RCPT-manual-4',
            status='confirmed', recorded_by=recorder, date=datetime.date(2026, 9, 9),
        )

    def test_can_create_receipt_for_payment(self):
        receipt = Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000001')
        self.assertEqual(receipt.payment, self.payment)

    def test_receipt_number_must_be_unique(self):
        Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000002')
        student_user = User.objects.create_user(username='receipt_student_2', password='x')
        student2 = StudentExtra.objects.create(user=student_user, roll='receipt_student_2')
        payment2 = Payment.objects.create(
            student=student2, amount=100, method='cash', reference='x',
            status='confirmed', recorded_by=self.payment.recorded_by, date=datetime.date(2026, 9, 9),
        )
        with self.assertRaises(IntegrityError):
            Receipt.objects.create(payment=payment2, receipt_number='RCPT-2026-000002')

    def test_only_one_receipt_per_payment(self):
        Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000003')
        with self.assertRaises(IntegrityError):
            Receipt.objects.create(payment=self.payment, receipt_number='RCPT-2026-000004')
