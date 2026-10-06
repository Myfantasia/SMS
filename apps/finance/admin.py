from django.contrib import admin, messages
from django.core.exceptions import ObjectDoesNotExist, PermissionDenied, ValidationError
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from unfold.admin import TabularInline as UnfoldTabularInline

from apps.finance.models_fees import (
    DiscountType,
    FeeCategory,
    FeeStructure,
    FeeStructureItem,
    StudentFeeItemEnrollment,
    StudentFeeLedgerEntry,
    StudentFeeAdjustment,
    Invoice,
    InvoiceLineItem,
    InvoiceCreditApplication,
    Payment,
    Receipt,
    FeeClearancePolicy,
    FeeClearanceOverride,
)
from apps.finance.models_shared import CashAccount
from apps.finance.services_fees import hard_delete_financial_record


class SuperuserOnlyActionsMixin:
    """Mixin to hide hard_delete_selected action from non-superusers."""

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not request.user.is_superuser and 'hard_delete_selected' in actions:
            del actions['hard_delete_selected']
        return actions


@admin.action(description="Hard delete (superuser only, must already be voided)")
def hard_delete_selected(modeladmin, request, queryset):
    if not request.user.is_superuser:
        modeladmin.message_user(request, "Only a superuser may hard-delete a financial record.", level=messages.ERROR)
        return
    deleted = 0
    for obj in list(queryset):
        try:
            hard_delete_financial_record(model_class=type(obj), pk=obj.pk, operator=request.user)
        except (PermissionDenied, ValidationError, ObjectDoesNotExist) as exc:
            detail = ' '.join(exc.messages) if isinstance(exc, ValidationError) else str(exc)
            modeladmin.message_user(request, f"{obj}: {detail}", level=messages.ERROR)
            break
        deleted += 1
    if deleted:
        modeladmin.message_user(request, f"Hard-deleted {deleted} record(s).", level=messages.SUCCESS)


@admin.register(CashAccount)
class CashAccountAdmin(UnfoldModelAdmin):
    list_display = ['name', 'account_type', 'is_active']
    list_filter = ['account_type', 'is_active']


@admin.register(FeeCategory)
class FeeCategoryAdmin(UnfoldModelAdmin):
    list_display = ['name', 'description']
    search_fields = ['name']


@admin.register(DiscountType)
class DiscountTypeAdmin(UnfoldModelAdmin):
    list_display = ['name', 'kind', 'value', 'category', 'active']
    list_filter = ['kind', 'active']
    search_fields = ['name']
    # Never hard-deleted once used: deactivate (active=False) instead.
    def has_delete_permission(self, request, obj=None):
        return False


class FeeStructureItemInline(UnfoldTabularInline):
    model = FeeStructureItem
    extra = 1


@admin.register(FeeStructure)
class FeeStructureAdmin(UnfoldModelAdmin):
    list_display = ['name', 'grade_level', 'term', 'status']
    list_filter = ['status', 'grade_level', 'term']
    inlines = [FeeStructureItemInline]


@admin.register(StudentFeeItemEnrollment)
class StudentFeeItemEnrollmentAdmin(UnfoldModelAdmin):
    list_display = ['student', 'fee_structure_item', 'enrolled_at']
    list_filter = ['fee_structure_item__fee_structure']
    autocomplete_fields = ['student']


@admin.register(StudentFeeLedgerEntry)
class StudentFeeLedgerEntryAdmin(UnfoldModelAdmin):
    list_display = ['student', 'entry_type', 'amount', 'running_balance', 'date']
    list_filter = ['entry_type', 'date']
    autocomplete_fields = ['student']
    # Deliberately no add/edit/delete permissions beyond Django superuser default —
    # this table is written only through post_ledger_entry(), never through the admin form.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class InvoiceLineItemInline(UnfoldTabularInline):
    model = InvoiceLineItem
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Invoice)
class InvoiceAdmin(SuperuserOnlyActionsMixin, UnfoldModelAdmin):
    list_display = ['invoice_number', 'student', 'fee_structure', 'total', 'status', 'issued_at']
    list_filter = ['status', 'fee_structure']
    search_fields = ['invoice_number']
    autocomplete_fields = ['student']
    inlines = [InvoiceLineItemInline]
    actions = [hard_delete_selected]

    # Generated only through services_fees.generate_invoice_for_student() — no manual add.
    # Invoices are immutable financial records — they can only be voided, never edited or deleted.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(InvoiceCreditApplication)
class InvoiceCreditApplicationAdmin(UnfoldModelAdmin):
    list_display = ['invoice', 'student', 'amount', 'created_at']
    search_fields = ['invoice__invoice_number']
    autocomplete_fields = ['student']

    # Created only by generate_invoice_for_student() when carried-forward credit
    # is applied. Immutable financial records — never added, edited or deleted here.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Payment)
class PaymentAdmin(SuperuserOnlyActionsMixin, UnfoldModelAdmin):
    list_display = ['student', 'amount', 'method', 'status', 'date', 'recorded_by']
    list_filter = ['method', 'status']
    autocomplete_fields = ['student']
    actions = [hard_delete_selected]

    # Created only through services_fees.record_payment() — no manual add.
    # Payments are immutable financial records — they can only be voided, never edited or deleted.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Receipt)
class ReceiptAdmin(UnfoldModelAdmin):
    list_display = ['receipt_number', 'payment', 'generated_at']

    # Generated synchronously by record_payment() when a Payment is confirmed —
    # no manual add. Receipts are formal sequentially-numbered documents and must
    # never be edited or deleted.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(StudentFeeAdjustment)
class StudentFeeAdjustmentAdmin(UnfoldModelAdmin):
    list_display = ['student', 'adjustment_type', 'amount', 'status', 'requested_by', 'decided_by', 'decided_at', 'created_at']
    list_filter = ['adjustment_type', 'status']
    autocomplete_fields = ['student']
    # Created only via create_adjustment() so the ledger stays in sync — no direct add/edit here.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(FeeClearancePolicy)
class FeeClearancePolicyAdmin(UnfoldModelAdmin):
    """Singleton (always pk=1), following the same admin convention already
    established by GlobalAllocationPolicyAdmin (apps/allocations/admin.py):
    disable add once the row exists, and disable delete entirely -- matching
    the model's own save()-enforced singleton and delete() guard."""
    list_display = ['block_report_cards', 'block_promotion', 'grace_threshold', 'updated_at', 'updated_by']

    def has_add_permission(self, request):
        return not FeeClearancePolicy.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(FeeClearanceOverride)
class FeeClearanceOverrideAdmin(UnfoldModelAdmin):
    """Immutable financial record -- created only via
    services_fees.grant_clearance_override() and revoked only via
    revoke_clearance_override(), never through the admin form -- read-only
    here, consistent with the other immutable finance admins above
    (InvoiceAdmin, PaymentAdmin, etc.)."""
    list_display = ['student', 'gate', 'term', 'academic_year', 'granted_by', 'created_at', 'revoked_at']
    list_filter = ['gate']
    autocomplete_fields = ['student']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
