from django.contrib.auth.models import User
from rest_framework import serializers

from apps.academics.models import AcademicYear, ExamTerm
from apps.finance.models_fees import (
    FeeCategory, FeeStructure, FeeStructureItem, Invoice, InvoiceLineItem, Payment,
    StudentFeeAdjustment, StudentFeeLedgerEntry, FeeClearancePolicy, FeeClearanceOverride,
)
from apps.identity.models import StudentExtra
from school.rbac import user_has_permission

# Ledger amounts are 32-bit integer columns and running balances add up, so
# input is capped well below the limit to keep a typo from overflowing a column.
MAX_AMOUNT = 1_000_000_000


class FeeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeCategory
        fields = ['id', 'name', 'description']


class FeeStructureItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = FeeStructureItem
        fields = ['id', 'category', 'category_name', 'amount', 'is_optional']


class FeeStructureSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeStructure
        fields = ['id', 'grade_level', 'term', 'name', 'status', 'created_at']
        read_only_fields = ['status', 'created_at']


class FeeStructureDetailSerializer(FeeStructureSerializer):
    items = FeeStructureItemSerializer(many=True, read_only=True)

    class Meta(FeeStructureSerializer.Meta):
        fields = FeeStructureSerializer.Meta.fields + ['items']


class InvoiceLineItemReadSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = InvoiceLineItem
        fields = ['id', 'category_name', 'description', 'amount']


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = InvoiceLineItemReadSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'student', 'fee_structure', 'total', 'status', 'invoice_number', 'issued_at',
            'voided_at', 'void_reason', 'line_items',
        ]
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    receipt_number = serializers.CharField(source='receipt.receipt_number', read_only=True, default=None)
    is_voided = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            'id', 'student', 'invoice', 'amount', 'method', 'reference', 'status', 'date',
            'receipt_number', 'is_voided', 'voided_at', 'void_reason',
        ]
        read_only_fields = fields

    def get_is_voided(self, obj):
        return obj.voided_at is not None


class InvoiceDetailSerializer(InvoiceSerializer):
    """`payments` and `credit_applications` must be prefetched by the view."""
    payments = PaymentSerializer(many=True, read_only=True)
    credit_applied = serializers.SerializerMethodField()

    class Meta(InvoiceSerializer.Meta):
        fields = InvoiceSerializer.Meta.fields + ['payments', 'credit_applied']
        read_only_fields = fields

    def get_credit_applied(self, obj):
        return sum(application.amount for application in obj.credit_applications.all())


class StudentFeeAdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentFeeAdjustment
        fields = [
            'id', 'student', 'category', 'adjustment_type', 'amount', 'reason',
            'requested_by', 'approved_by', 'created_at',
        ]
        read_only_fields = fields


class StudentFeeLedgerEntrySerializer(serializers.ModelSerializer):
    """Deliberately omits `reference`: it is a generic FK that can dangle after a
    hard delete, so it is never dereferenced here."""

    class Meta:
        model = StudentFeeLedgerEntry
        fields = ['id', 'entry_type', 'amount', 'running_balance', 'description', 'date']
        read_only_fields = fields


class PaymentCreateSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=StudentExtra.objects.all())
    invoice = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), required=False, allow_null=True)
    amount = serializers.IntegerField(min_value=1, max_value=MAX_AMOUNT)
    method = serializers.ChoiceField(choices=Payment.METHOD_CHOICES)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    date = serializers.DateField(required=False, allow_null=True, default=None)


class AdjustmentCreateSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=StudentExtra.objects.all())
    category = serializers.PrimaryKeyRelatedField(queryset=FeeCategory.objects.all(), required=False, allow_null=True)
    adjustment_type = serializers.ChoiceField(choices=StudentFeeAdjustment.ADJUSTMENT_TYPE_CHOICES)
    amount = serializers.IntegerField(min_value=-MAX_AMOUNT, max_value=MAX_AMOUNT)
    reason = serializers.CharField(max_length=2000)
    approved_by = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False, allow_null=True)

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError("Adjustment amount must not be zero.")
        return value

    def validate_approved_by(self, user):
        """The named approver must be a real, active user who actually holds the
        approve permission. (Not being the requester is enforced by the service.)"""
        if user is not None and not (user.is_active and user_has_permission(user, 'finance.approve_adjustment')):
            raise serializers.ValidationError("The approver must be an active user with the finance.approve_adjustment permission.")
        return user


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField()


class PageQuerySerializer(serializers.Serializer):
    """limit/offset query params shared by every list-style endpoint."""
    limit = serializers.IntegerField(min_value=1, max_value=500, required=False, default=200)
    offset = serializers.IntegerField(min_value=0, required=False, default=0)

    def slice(self, queryset):
        offset = self.validated_data['offset']
        return queryset[offset:offset + self.validated_data['limit']]


class InvoiceListQuerySerializer(PageQuerySerializer):
    student_id = serializers.IntegerField(min_value=1, required=False)
    fee_structure_id = serializers.IntegerField(min_value=1, required=False)
    status = serializers.ChoiceField(choices=Invoice.STATUS_CHOICES, required=False)


class PaymentListQuerySerializer(PageQuerySerializer):
    student_id = serializers.IntegerField(min_value=1, required=False)


class FeeClearanceQuerySerializer(serializers.Serializer):
    term_id = serializers.IntegerField(min_value=1, required=False, default=None)
    grace_threshold = serializers.IntegerField(min_value=0, max_value=MAX_AMOUNT, required=False, default=0)


class CollectionsTrendQuerySerializer(serializers.Serializer):
    days = serializers.IntegerField(min_value=1, max_value=366, required=False, default=30)


class ExamTermLookupQuerySerializer(serializers.Serializer):
    academic_year_id = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        # DRF's HTML-form input handling (which query params go through) treats an
        # empty string on a non-required field as "not provided" and silently skips
        # it rather than validating it — so `?academic_year_id=` would otherwise pass
        # straight through instead of failing IntegerField's int() coercion. Catch it
        # explicitly so a blank value 400s the same way a non-integer one does.
        if self.initial_data.get('academic_year_id') == '':
            raise serializers.ValidationError({'academic_year_id': 'This field may not be blank.'})
        return attrs


class FeeClearancePolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeClearancePolicy
        fields = ['block_report_cards', 'block_promotion', 'grace_threshold', 'updated_at', 'updated_by']
        read_only_fields = fields


class FeeClearancePolicyUpdateSerializer(serializers.Serializer):
    """PATCH-style: every field is optional so a PUT/PATCH can change just one
    of them; the service only touches fields that were actually supplied."""
    block_report_cards = serializers.BooleanField(required=False)
    block_promotion = serializers.BooleanField(required=False)
    grace_threshold = serializers.IntegerField(required=False, min_value=0, max_value=MAX_AMOUNT)


class FeeClearanceOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeClearanceOverride
        fields = [
            'id', 'student', 'gate', 'term', 'academic_year', 'reason', 'granted_by',
            'created_at', 'revoked_at', 'revoked_by', 'revoke_reason',
        ]
        read_only_fields = fields


class ClearanceOverrideCreateSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=StudentExtra.objects.all())
    gate = serializers.ChoiceField(choices=FeeClearanceOverride.GATE_CHOICES)
    term = serializers.PrimaryKeyRelatedField(queryset=ExamTerm.objects.all(), required=False, allow_null=True)
    academic_year = serializers.PrimaryKeyRelatedField(queryset=AcademicYear.objects.all(), required=False, allow_null=True)
    reason = serializers.CharField(max_length=2000)


class ClearanceOverrideRevokeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class ClearanceOverrideListQuerySerializer(serializers.Serializer):
    student_id = serializers.IntegerField(min_value=1, required=False)
    gate = serializers.ChoiceField(choices=FeeClearanceOverride.GATE_CHOICES, required=False)
