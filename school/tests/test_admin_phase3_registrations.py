from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse


class Phase3ModelRegistrationTests(TestCase):
    """
    Phase 3 of the Django admin overhaul: registers the ~30 models that had no admin
    presence at all. Each assertion just needs the changelist URL to resolve and return
    200 -- proving the model is actually registered with a working ModelAdmin, not just
    that a class with that name exists somewhere.
    """

    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username='phase3_admin', password='x', email='phase3_admin@test.com')
        self.client.force_login(self.superuser)

    def _assert_registered(self, url_name):
        response = self.client.get(reverse(url_name))
        self.assertEqual(response.status_code, 200, f"{url_name} did not return 200")

    def test_identity_models_registered(self):
        for url_name in [
            'admin:identity_school_changelist',
            'admin:identity_forcedpasswordchange_changelist',
            'admin:identity_admininvitecode_changelist',
        ]:
            self._assert_registered(url_name)

    def test_academics_models_registered(self):
        for url_name in [
            'admin:academics_curriculum_changelist',
            'admin:academics_pathway_changelist',
            'admin:academics_track_changelist',
            'admin:academics_subjectcategorylimit_changelist',
            'admin:academics_subjectpool_changelist',
        ]:
            self._assert_registered(url_name)

    def test_allocations_models_registered(self):
        for url_name in [
            'admin:allocations_allocationpublishstate_changelist',
            'admin:allocations_subjectsplittingrule_changelist',
            'admin:allocations_globalallocationpolicy_changelist',
        ]:
            self._assert_registered(url_name)

    def test_assignments_models_registered(self):
        for url_name in [
            'admin:assignments_assignmentgroup_changelist',
            'admin:assignments_assignmentattachment_changelist',
            'admin:assignments_rubriccriterion_changelist',
            'admin:assignments_criterionscore_changelist',
        ]:
            self._assert_registered(url_name)

    def test_staff_model_registered(self):
        self._assert_registered('admin:staff_teacherstructuralavailability_changelist')

    def test_students_models_registered(self):
        for url_name in [
            'admin:students_studenttask_changelist',
            'admin:students_nationalexamrecord_changelist',
        ]:
            self._assert_registered(url_name)

    def test_messaging_models_registered(self):
        for url_name in [
            'admin:messaging_chatuserprofile_changelist',
            'admin:messaging_chatthread_changelist',
            'admin:messaging_threadparticipant_changelist',
            'admin:messaging_messageaudit_changelist',
            'admin:messaging_chatactionresponse_changelist',
        ]:
            self._assert_registered(url_name)

    def test_timetable_models_registered(self):
        for url_name in [
            'admin:timetable_timetablepedagogypolicy_changelist',
            'admin:timetable_dailycover_changelist',
        ]:
            self._assert_registered(url_name)

    def test_results_models_registered(self):
        for url_name in [
            'admin:results_subjecttermresult_changelist',
            'admin:results_studenttermresult_changelist',
            'admin:results_classperformanceanalytics_changelist',
        ]:
            self._assert_registered(url_name)

    def test_core_models_registered(self):
        for url_name in [
            'admin:core_backgroundjob_changelist',
            'admin:core_systemauditlog_changelist',
        ]:
            self._assert_registered(url_name)

    def test_system_audit_log_is_read_only(self):
        response = self.client.get(reverse('admin:core_systemauditlog_add'))
        # Django admin's add_view raises PermissionDenied (403) when has_add_permission
        # is False, rather than serving the add form.
        self.assertEqual(response.status_code, 403)

    def test_content_admin_uses_unfold_theme(self):
        # Both content models should now render inside Unfold's theme, not stock Django
        # admin -- the presence of Unfold's own CSS bundle on the changelist page is a
        # simple, real signal that the ModelAdmin base class was actually swapped.
        response = self.client.get(reverse('admin:content_blogpost_changelist'))
        self.assertContains(response, 'unfold/css/styles.css')
