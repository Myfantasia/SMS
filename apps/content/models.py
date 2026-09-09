from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from school.validators import profile_pic_validator


class BlogPost(models.Model):
    """A public-facing article, shown on the /blog list + detail pages and in the
    About Us "Latest from the Blog" teaser. Only is_published=True posts are ever
    returned by the public read endpoints -- drafts stay visible to admins only.
    """
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    excerpt = models.CharField(max_length=280, blank=True)
    body = models.TextField()
    cover_image = models.ImageField(
        upload_to='content/blog/', null=True, blank=True, validators=[profile_pic_validator]
    )
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='blog_posts')
    is_published = models.BooleanField(default=True, db_index=True)
    published_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-published_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        # Slug is derived once from the title, not re-derived on every save -- so an
        # already-published post keeps a stable URL even if the title is edited later.
        if not self.slug:
            base_slug = slugify(self.title)[:200] or 'post'
            slug = base_slug
            suffix = 2
            while BlogPost.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base_slug}-{suffix}"
                suffix += 1
            self.slug = slug
        super().save(*args, **kwargs)


class AlumniReview(models.Model):
    """A "Where Are They Now?" testimonial quote on the About Us page. Mock/curated
    copy is used as the frontend's fallback until real reviews exist here -- the
    moment an admin publishes one via the admin dashboard, the public page switches
    to fetched data automatically (see AboutUs.tsx).
    """
    name = models.CharField(max_length=120)
    title = models.CharField(max_length=200, help_text="e.g. 'CEO, Pesaflow | Class of 2012'")
    quote = models.TextField()
    photo = models.ImageField(
        upload_to='content/alumni/', null=True, blank=True, validators=[profile_pic_validator]
    )
    is_published = models.BooleanField(default=True, db_index=True)
    display_order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['display_order', '-created_at']

    def __str__(self):
        return f"{self.name} ({self.title})"
