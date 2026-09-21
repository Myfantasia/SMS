from rest_framework import serializers

from apps.finance.models_fees import FeeCategory, FeeStructure, FeeStructureItem


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
