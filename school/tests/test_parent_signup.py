from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from apps.academics.models import GradeLevel, ClassStream
from apps.identity.models import StudentExtra, ParentExtra


def _parent_payload(**overrides):
    payload = {
        'first_name': 'Jane',
        'last_name': 'Otieno',
        'username': 'jane_parent',
        'email': 'jane@example.com',
        'password': 'pass12345',
        'password2': 'pass12345',
        'mobile': '0722000000',
        'relationship': 'Mother',
    }
    payload.update(overrides)
    return payload


class ParentSignupSearchTests(TestCase):
    """Covers the public search endpoint that backs the parent signup page's
    search-and-select child-linking UI."""

    @classmethod
    def setUpTestData(cls):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        cls.stream = ClassStream.objects.create(name='North', grade=grade)
        cls.student1 = StudentExtra.objects.create(
            user=User.objects.create_user(username='S-KID-1', first_name='Kamau', last_name='Otieno', password='x'),
            roll='S-KID-1', cl=cls.stream, status=True,
        )
        cls.student2 = StudentExtra.objects.create(
            user=User.objects.create_user(username='S-KID-2', first_name='Kamau', last_name='Mwangi', password='x'),
            roll='S-KID-2', cl=cls.stream, status=True,
        )

    def setUp(self):
        cache.clear()

    def test_search_matches_by_name(self):
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'Kamau'})
        self.assertEqual(response.status_code, 200)
        rolls = {row['roll'] for row in response.json()['data']}
        self.assertEqual(rolls, {'S-KID-1', 'S-KID-2'})

    def test_search_matches_by_admission_number(self):
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'S-KID-1'})
        rolls = {row['roll'] for row in response.json()['data']}
        self.assertEqual(rolls, {'S-KID-1'})

    def test_short_query_returns_no_results(self):
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'K'})
        self.assertEqual(response.json()['data'], [])

    def test_search_result_omits_sensitive_fields(self):
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'Kamau'})
        row = response.json()['data'][0]
        self.assertEqual(set(row.keys()), {
            'id', 'roll', 'first_name', 'last_name', 'class_name',
            'already_linked', 'linked_parent_count', 'parent_capacity',
        })

    def test_already_linked_flag_reflects_existing_parent_link(self):
        before = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'S-KID-1'}).json()['data'][0]
        self.assertFalse(before['already_linked'])

        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=str(self.student1.id)))

        cache.clear()
        after = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'S-KID-1'}).json()['data'][0]
        self.assertTrue(after['already_linked'])

    def test_search_is_rate_limited_per_ip(self):
        for _ in range(20):
            self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'Kamau'})
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'Kamau'})
        self.assertEqual(response.status_code, 429)


class ParentCapacityTests(TestCase):
    """A student whose family_structure is 'both' legitimately expects 2 linked parent
    accounts (mother + father) — the search endpoint should reflect that capacity instead
    of flagging the child as fully 'linked' the moment a single parent connects."""

    @classmethod
    def setUpTestData(cls):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        stream = ClassStream.objects.create(name='North', grade=grade)
        cls.student = StudentExtra.objects.create(
            user=User.objects.create_user(username='S-BOTH-1', first_name='Wafula', last_name='Simiyu', password='x'),
            roll='S-BOTH-1', cl=stream, status=True, family_structure='both',
        )

    def setUp(self):
        cache.clear()

    def _search(self):
        response = self.client.get(reverse('api_search_students_for_parent_signup'), {'q': 'Wafula'})
        return response.json()['data'][0]

    def test_both_parents_household_reports_capacity_two(self):
        row = self._search()
        self.assertEqual(row['parent_capacity'], 2)
        self.assertEqual(row['linked_parent_count'], 0)
        self.assertFalse(row['already_linked'])

    def test_first_parent_link_leaves_room_for_second(self):
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=str(self.student.id)))
        cache.clear()
        row = self._search()
        self.assertEqual(row['linked_parent_count'], 1)
        self.assertFalse(row['already_linked'])  # still room for the second parent

    def test_second_parent_link_reaches_capacity(self):
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=str(self.student.id)))
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(
            username='john_parent', email='john@example.com', selected_student_ids=str(self.student.id),
        ))
        cache.clear()
        row = self._search()
        self.assertEqual(row['linked_parent_count'], 2)
        self.assertTrue(row['already_linked'])


class ParentSignupLinkingTests(TestCase):
    """Covers linking one or more children via selected_student_ids, replacing the old
    free-text admission-number + name matching."""

    @classmethod
    def setUpTestData(cls):
        grade = GradeLevel.objects.create(name='Grade 8', numeric_order=8, curriculum_type='CBC')
        stream = ClassStream.objects.create(name='North', grade=grade)
        cls.student1 = StudentExtra.objects.create(
            user=User.objects.create_user(username='S-KID-1', first_name='Kamau', last_name='Otieno', password='x'),
            roll='S-KID-1', cl=stream, status=True,
        )
        cls.student2 = StudentExtra.objects.create(
            user=User.objects.create_user(username='S-KID-2', first_name='Wanjiru', last_name='Otieno', password='x'),
            roll='S-KID-2', cl=stream, status=True,
        )

    def test_signup_with_no_selection_rejected(self):
        response = self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=''))
        self.assertFalse(User.objects.filter(username='jane_parent').exists())
        self.assertIn('selected_student_ids', response.json()['field_errors'])

    def test_signup_with_nonexistent_student_id_rejected(self):
        response = self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids='999999'))
        self.assertFalse(User.objects.filter(username='jane_parent').exists())
        self.assertIn('selected_student_ids', response.json()['field_errors'])

    def test_signup_links_single_child(self):
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=str(self.student1.id)))
        parent = ParentExtra.objects.get(user__username='jane_parent')
        self.assertEqual(list(parent.students.values_list('roll', flat=True)), ['S-KID-1'])
        self.assertFalse(parent.status)  # still pending admin approval

    def test_signup_links_multiple_children(self):
        ids = f'{self.student1.id},{self.student2.id}'
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=ids))
        parent = ParentExtra.objects.get(user__username='jane_parent')
        self.assertEqual(
            set(parent.students.values_list('roll', flat=True)),
            {'S-KID-1', 'S-KID-2'},
        )

    def test_second_parent_can_link_same_child(self):
        # Multiple guardians per child is legitimate — linking is informational
        # (already_linked), never blocked.
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(selected_student_ids=str(self.student1.id)))
        self.client.post(reverse('api_public_signup_parent'), _parent_payload(
            username='john_parent', email='john@example.com', selected_student_ids=str(self.student1.id),
        ))
        linked_parents = ParentExtra.objects.filter(students=self.student1).count()
        self.assertEqual(linked_parents, 2)
