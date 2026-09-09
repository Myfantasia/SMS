from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse


class AdminSiteNavigationTests(TestCase):
    """
    Phase 2 of the Django admin overhaul: a hand-organized UNFOLD["SIDEBAR"]["navigation"]
    replacing the default alphabetical-by-app grouping, plus basic branding. Every entry's
    `link` is a reverse_lazy(...) against a real registered admin URL -- if any entry
    referenced an unregistered model, resolving it would raise NoReverseMatch and this
    request would 500 instead of 200. This test is therefore also the regression check for
    "every nav entry points at something that actually exists."
    """

    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username='nav_admin', password='x', email='nav_admin@test.com')
        self.client.force_login(self.superuser)

    def test_admin_index_renders_with_custom_navigation(self):
        response = self.client.get(reverse('admin:index'))
        self.assertEqual(response.status_code, 200)

    def test_navigation_groups_are_present(self):
        response = self.client.get(reverse('admin:index'))
        # Django's autoescape turns "&" into "&amp;" in the rendered HTML.
        self.assertContains(response, 'Governance &amp; RBAC')
        self.assertContains(response, 'People')
        self.assertContains(response, 'Rules &amp; Policies')
        self.assertContains(response, 'Curriculum Structure')
        self.assertContains(response, 'Classes &amp; Enrollment')
        self.assertContains(response, 'Allocations &amp; Timetable')
        self.assertContains(response, 'Attendance &amp; Leave')
        self.assertContains(response, 'Exams &amp; Results')
        self.assertContains(response, 'Assignments')
        self.assertContains(response, 'Communication')
        self.assertContains(response, 'Content')

    def test_role_changelist_reachable_from_navigation(self):
        # Spot-check one entry per app that moved during the modular-monolith migration,
        # to catch a wrong app_label before it reaches every other entry.
        response = self.client.get(reverse('admin:index'))
        content = response.content.decode()
        self.assertIn(reverse('admin:identity_role_changelist'), content)
        self.assertIn(reverse('admin:allocations_subjectquota_changelist'), content)
        self.assertIn(reverse('admin:timetable_timetable_changelist'), content)
        self.assertIn(reverse('admin:students_studentsubjectenrollment_changelist'), content)
        self.assertIn(reverse('admin:staff_teacherleave_changelist'), content)
        self.assertIn(reverse('admin:assignments_assignment_changelist'), content)
        self.assertIn(reverse('admin:messaging_notice_changelist'), content)
        self.assertIn(reverse('admin:content_blogpost_changelist'), content)

    def test_site_branding_is_customized(self):
        response = self.client.get(reverse('admin:index'))
        content = response.content.decode()
        self.assertIn('SMS Control Center', content)
