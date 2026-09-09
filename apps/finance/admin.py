from django.contrib import admin

from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem, StudentFeeItemEnrollment
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
