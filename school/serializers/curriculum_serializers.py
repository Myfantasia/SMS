from rest_framework import serializers

from school.models.classSubjects_models import Curriculum, CurriculumPreset, Pathway, Subject, SubjectPool, Tier


class CurriculumSerializer(serializers.ModelSerializer):
    class Meta:
        model = Curriculum
        fields = ['id', 'code', 'name', 'is_active_for_new_grades', 'is_archived']
        read_only_fields = ['is_archived']


class PathwaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Pathway
        fields = ['id', 'curriculum', 'name', 'description']

    def validate_curriculum(self, curriculum):
        if curriculum.code != 'CBC':
            raise serializers.ValidationError("Pathways are only meaningful for the CBC curriculum.")
        return curriculum


class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ['id', 'curriculum', 'name', 'code', 'display_order']


class SubjectPoolSerializer(serializers.ModelSerializer):
    subjects = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), many=True, required=False)

    class Meta:
        model = SubjectPool
        fields = ['id', 'preset', 'pool_type', 'min_subjects', 'max_subjects', 'subjects']
        extra_kwargs = {'preset': {'required': False}}


class CurriculumPresetSerializer(serializers.ModelSerializer):
    pools = SubjectPoolSerializer(many=True, required=False)

    class Meta:
        model = CurriculumPreset
        fields = [
            'id', 'name', 'min_subjects', 'max_subjects', 'display_order',
            'curriculum', 'tier', 'pathway', 'pools',
        ]

    def create(self, validated_data):
        pools_data = validated_data.pop('pools', [])
        preset = CurriculumPreset.objects.create(**validated_data)
        for pool_data in pools_data:
            subjects = pool_data.pop('subjects', [])
            pool = SubjectPool.objects.create(preset=preset, **pool_data)
            pool.subjects.set(subjects)
        return preset

    def update(self, instance, validated_data):
        pools_data = validated_data.pop('pools', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if pools_data is not None:
            instance.pools.all().delete()
            for pool_data in pools_data:
                subjects = pool_data.pop('subjects', [])
                pool = SubjectPool.objects.create(preset=instance, **pool_data)
                pool.subjects.set(subjects)
        return instance
