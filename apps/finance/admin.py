from django.contrib import admin

from apps.finance.models_fees import FeeCategory
from apps.finance.models_shared import CashAccount


@admin.register(CashAccount)
class CashAccountAdmin(admin.ModelAdmin):
    list_display = ['name', 'account_type', 'is_active']
    list_filter = ['account_type', 'is_active']


@admin.register(FeeCategory)
class FeeCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'description']
    search_fields = ['name']
