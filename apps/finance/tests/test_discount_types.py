from io import StringIO

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.models import SystemAuditLog
from apps.finance.models_fees import DiscountType, FeeCategory
from apps.finance.views import DiscountTypeDetailAPIView, DiscountTypeListCreateAPIView
from apps.identity.models import Permission, Role, UserRole


class DiscountTypeAPITests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        view_perm, _ = Permission.objects.get_or_create(code='finance.view', defaults={'label': 'View', 'module': 'Finance'})
        edit_perm, _ = Permission.objects.get_or_create(code='finance.edit', defaults={'label': 'Edit', 'module': 'Finance'})

        editor_role, _ = Role.objects.get_or_create(name='Discount Editor Test Role')
        editor_role.permissions.set([view_perm, edit_perm])
        self.editor = User.objects.create_user(username='discount_editor_test', password='x')
        UserRole.objects.create(user=self.editor, role=editor_role)

        viewer_role, _ = Role.objects.get_or_create(name='Discount Viewer Test Role')
        viewer_role.permissions.set([view_perm])
        self.viewer = User.objects.create_user(username='discount_viewer_test', password='x')
        UserRole.objects.create(user=self.viewer, role=viewer_role)

        self.tuition = FeeCategory.objects.create(name='Tuition')

    def call(self, view, method, path, user, data=None, **kwargs):
        request = getattr(self.factory, method)(path, data, format='json') if data is not None else getattr(self.factory, method)(path)
        force_authenticate(request, user=user)
        return view.as_view()(request, **kwargs)

    def list_url(self):
        return '/api/finance/discount-types/'

    def detail_url(self, pk):
        return f'/api/finance/discount-types/{pk}/'

    def create(self, user=None, **overrides):
        payload = {'name': 'Sibling discount', 'kind': 'percentage', 'value': 10}
        payload.update(overrides)
        return self.call(DiscountTypeListCreateAPIView, 'post', self.list_url(), user or self.editor, payload)

    def test_create_list_and_retrieve(self):
        response = self.create(name='Staff child', kind='fixed', value=5000, category=self.tuition.id)
        self.assertEqual(response.status_code, 201)
        pk = response.data['id']
        self.assertEqual(response.data['category'], self.tuition.id)
        self.assertTrue(response.data['active'])

        listed = self.call(DiscountTypeListCreateAPIView, 'get', self.list_url(), self.editor)
        self.assertEqual(listed.status_code, 200)
        self.assertIn('Staff child', [row['name'] for row in listed.data])

        detail = self.call(DiscountTypeDetailAPIView, 'get', self.detail_url(pk), self.editor, discount_type_id=pk)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['kind'], 'fixed')
        self.assertEqual(detail.data['value'], 5000)

    def test_create_writes_audit_row(self):
        self.create(name='Audited', kind='percentage', value=20)
        self.assertTrue(SystemAuditLog.objects.filter(module='finance', action_type='CREATE', description__contains="'Audited'").exists())

    def test_list_active_filter(self):
        DiscountType.objects.create(name='On', kind='fixed', value=1, active=True)
        DiscountType.objects.create(name='Off', kind='fixed', value=1, active=False)
        active = self.call(DiscountTypeListCreateAPIView, 'get', self.list_url() + '?active=true', self.editor)
        inactive = self.call(DiscountTypeListCreateAPIView, 'get', self.list_url() + '?active=false', self.editor)
        self.assertEqual([row['name'] for row in active.data], ['On'])
        self.assertEqual([row['name'] for row in inactive.data], ['Off'])

    def test_patch_updates_and_deactivates(self):
        pk = self.create(name='Patchable', kind='fixed', value=100).data['id']
        response = self.call(DiscountTypeDetailAPIView, 'patch', self.detail_url(pk), self.editor,
                             {'value': 250, 'kind': 'percentage'}, discount_type_id=pk)
        self.assertEqual(response.status_code, 400)  # 250 is not a valid percentage

        response = self.call(DiscountTypeDetailAPIView, 'patch', self.detail_url(pk), self.editor,
                             {'value': 25, 'kind': 'percentage'}, discount_type_id=pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['value'], 25)

        response = self.call(DiscountTypeDetailAPIView, 'patch', self.detail_url(pk), self.editor,
                             {'active': False}, discount_type_id=pk)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(DiscountType.objects.get(pk=pk).active)
        self.assertTrue(SystemAuditLog.objects.filter(module='finance', action_type='UPDATE').exists())

    def test_no_delete_route(self):
        pk = DiscountType.objects.create(name='Keep me', kind='fixed', value=0).pk
        response = self.call(DiscountTypeDetailAPIView, 'delete', self.detail_url(pk), self.editor, discount_type_id=pk)
        self.assertEqual(response.status_code, 405)
        self.assertTrue(DiscountType.objects.filter(pk=pk).exists())

    def test_percentage_over_100_rejected(self):
        self.assertEqual(self.create(name='Too much', kind='percentage', value=101).status_code, 400)

    def test_negative_fixed_rejected(self):
        self.assertEqual(self.create(name='Negative', kind='fixed', value=-1).status_code, 400)

    def test_duplicate_name_rejected_with_400(self):
        DiscountType.objects.create(name='Dup', kind='fixed', value=0)
        response = self.create(name='Dup', kind='fixed', value=0)
        self.assertEqual(response.status_code, 400)

    def test_blank_name_and_unknown_category_rejected(self):
        self.assertEqual(self.create(name='   ', kind='fixed', value=0).status_code, 400)
        self.assertEqual(self.create(name='Bad category', kind='fixed', value=0, category=999999).status_code, 400)

    def test_viewer_can_read_but_not_write(self):
        pk = DiscountType.objects.create(name='Readable', kind='fixed', value=0).pk
        self.assertEqual(self.call(DiscountTypeListCreateAPIView, 'get', self.list_url(), self.viewer).status_code, 200)
        self.assertEqual(self.call(DiscountTypeDetailAPIView, 'get', self.detail_url(pk), self.viewer, discount_type_id=pk).status_code, 200)
        self.assertEqual(self.create(user=self.viewer, name='Nope').status_code, 403)
        self.assertEqual(self.call(DiscountTypeDetailAPIView, 'patch', self.detail_url(pk), self.viewer,
                                   {'active': False}, discount_type_id=pk).status_code, 403)


class SeedDiscountTypesCommandTests(TestCase):
    def run_seed(self):
        call_command('seed_discount_types', stdout=StringIO())

    def test_seed_is_idempotent_and_creates_waiver_rows(self):
        self.run_seed()
        count_after_first = DiscountType.objects.count()
        self.run_seed()
        self.assertEqual(DiscountType.objects.count(), count_after_first)
        self.assertEqual(count_after_first, 3)
        for name in ('Discount', 'Scholarship', 'Bursary'):
            row = DiscountType.objects.get(name=name)
            self.assertEqual(row.kind, 'fixed')
            self.assertEqual(row.value, 0)
            self.assertTrue(row.active)
