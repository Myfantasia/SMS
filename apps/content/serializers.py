from rest_framework import serializers

from .models import AlumniReview, BlogPost


class BlogPostSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = BlogPost
        fields = [
            'id', 'title', 'slug', 'excerpt', 'body', 'cover_image', 'author_name',
            'is_published', 'published_at', 'created_at', 'updated_at',
        ]
        read_only_fields = ['slug', 'created_at', 'updated_at']

    def get_author_name(self, obj):
        if not obj.author:
            return 'MyFantasia Team'
        full_name = obj.author.get_full_name()
        return full_name or obj.author.username


class AlumniReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlumniReview
        fields = [
            'id', 'name', 'title', 'quote', 'photo', 'is_published', 'display_order',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
