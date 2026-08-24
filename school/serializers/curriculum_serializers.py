from rest_framework import serializers

from apps.academics.models import (
    Curriculum, CurriculumPreset, Pathway, PresetCombination, Subject, SubjectCurriculumProfile,
    SubjectPool, Tier, Track,
)


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


class TrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Track
        fields = ['id', 'pathway', 'name', 'description', 'display_order']


class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ['id', 'curriculum', 'name', 'code', 'display_order', 'exit_exam_code', 'exit_is_terminal']


class SubjectCurriculumProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubjectCurriculumProfile
        fields = [
            'id', 'subject', 'curriculum', 'tier', 'is_core', 'department', 'total_lessons',
            'double_lessons_required', 'remedial_lessons_required',
        ]

    def validate(self, data):
        tier = data.get('tier', getattr(self.instance, 'tier', None))
        curriculum = data.get('curriculum', getattr(self.instance, 'curriculum', None))
        if tier and curriculum and tier.curriculum_id != curriculum.id:
            raise serializers.ValidationError({'tier': "This tier doesn't belong to the selected curriculum."})
        return data


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
            'curriculum', 'tier', 'pathway', 'track', 'pools',
        ]

    def validate(self, data):
        pathway = data.get('pathway', getattr(self.instance, 'pathway', None))
        track = data.get('track', getattr(self.instance, 'track', None))
        if track and track.pathway_id != (pathway.id if pathway else None):
            raise serializers.ValidationError({'track': "This track doesn't belong to the selected pathway."})
        return data

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


class PresetCombinationSerializer(serializers.ModelSerializer):
    subjects = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), many=True)
    display_name = serializers.CharField(read_only=True)
    pathway = serializers.IntegerField(source='track.pathway_id', read_only=True)
    pathway_name = serializers.CharField(source='track.pathway.name', read_only=True)

    class Meta:
        model = PresetCombination
        fields = ['id', 'track', 'pathway', 'pathway_name', 'name', 'display_name', 'code', 'subjects', 'is_active']

    def validate_subjects(self, subjects):
        # The one hard rule from the official catalog: a combination is EXACTLY 3 subjects.
        # Deliberately not cross-checked against any SubjectPool — see PresetCombination's
        # docstring on why this stays decoupled from the school's own preset-building tool.
        if len(subjects) != 3:
            raise serializers.ValidationError("A preset combination must have exactly 3 subjects.")
        if len({s.id for s in subjects}) != 3:
            raise serializers.ValidationError("A preset combination's 3 subjects must be distinct.")
        return subjects
