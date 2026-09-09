from rest_framework import viewsets
from rest_framework.permissions import BasePermission, IsAuthenticated

from school.decorators import is_admin

from .models import AlumniReview, BlogPost
from .serializers import AlumniReviewSerializer, BlogPostSerializer


class IsAdminGroup(BasePermission):
    """Gates the admin Content management screens -- read and write both require the
    ADMIN group, unlike EventViewSet/NoticeViewSet where reads stay open to every
    authenticated user. Blog drafts and unpublished alumni quotes are staging content,
    not something a teacher/parent/student account should see early.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and is_admin(request.user))


class BlogPostAdminViewSet(viewsets.ModelViewSet):
    queryset = BlogPost.objects.all()
    serializer_class = BlogPostSerializer
    permission_classes = [IsAuthenticated, IsAdminGroup]

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)


class AlumniReviewAdminViewSet(viewsets.ModelViewSet):
    queryset = AlumniReview.objects.all()
    serializer_class = AlumniReviewSerializer
    permission_classes = [IsAuthenticated, IsAdminGroup]
