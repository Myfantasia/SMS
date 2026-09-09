from django.contrib import admin

from apps.finance.models_fees import (
    FeeCategory,
    FeeStructure,
    FeeStructureItem,
    StudentFeeItemEnrollment,
    StudentFeeLedgerEntry,
)
from apps.finance.models_shared import CashAccount


@admin.register(CashAccount)
class CashAccountAdmin(admin.ModelAdmin):
    list_display = ['name', 'account_type', 'is_active']
    list_filter = ['account_type', 'is_active']


@admin.register(FeeCategory)
class FeeCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'description']
    search_fields = ['name']


class FeeStructureItemInline(admin.TabularInline):
    model = FeeStructureItem
    extra = 1


@admin.register(FeeStructure)
class FeeStructureAdmin(admin.ModelAdmin):
    list_display = ['name', 'grade_level', 'term', 'status']
    list_filter = ['status', 'grade_level', 'term']
    inlines = [FeeStructureItemInline]


@admin.register(StudentFeeItemEnrollment)
class StudentFeeItemEnrollmentAdmin(admin.ModelAdmin):
    list_display = ['student', 'fee_structure_item', 'enrolled_at']
    list_filter = ['fee_structure_item__fee_structure']
    autocomplete_fields = ['student']


@admin.register(StudentFeeLedgerEntry)
class StudentFeeLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['student', 'entry_type', 'amount', 'running_balance', 'date']
    list_filter = ['entry_type', 'date']
    autocomplete_fields = ['student']
    # Deliberately no add/edit/delete permissions beyond Django superuser default —
    # this table is written only through post_ledger_entry(), never through the admin form.
    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
