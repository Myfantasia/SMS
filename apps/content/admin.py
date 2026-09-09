from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import AlumniReview, BlogPost


@admin.register(BlogPost)
class BlogPostAdmin(ModelAdmin):
    list_display = ('title', 'author', 'is_published', 'published_at')
    list_filter = ('is_published',)
    search_fields = ('title', 'excerpt', 'body')
    prepopulated_fields = {'slug': ('title',)}


@admin.register(AlumniReview)
class AlumniReviewAdmin(ModelAdmin):
    list_display = ('name', 'title', 'is_published', 'display_order')
    list_filter = ('is_published',)
    search_fields = ('name', 'title', 'quote')
