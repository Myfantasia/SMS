from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from school import models


def _validate_signup_password(form, cleaned, password_field='password', password2_field='password2'):
    """Shared strength + confirmation check for signup forms, run against a throwaway
    (unsaved) User built from the same cleaned data so UserAttributeSimilarityValidator
    can compare the password against the username/name being registered — matches the
    validators self-service password change already runs (AUTH_PASSWORD_VALIDATORS)."""
    password = cleaned.get(password_field)
    password2 = cleaned.get(password2_field)

    if password:
        temp_user = User(
            username=cleaned.get('username') or '',
            email=cleaned.get('email') or '',
            first_name=cleaned.get('first_name') or '',
            last_name=cleaned.get('last_name') or '',
        )
        try:
            validate_password(password, user=temp_user)
        except DjangoValidationError as e:
            for message in e.messages:
                form.add_error(password_field, message)

    if password and password2 and password != password2:
        form.add_error(password2_field, 'Passwords do not match.')


#for admin
class AdminSigupForm(forms.ModelForm):
    # Capped at 20 chars for the same reason as StudentUserForm.username: kept short and
    # consistent with the other roles' login-identifier fields.
    username = forms.CharField(max_length=20)
    email = forms.EmailField()
    mobile = forms.CharField(max_length=40)
    address = forms.CharField(max_length=200)
    password2 = forms.CharField(widget=forms.PasswordInput, label='Confirm password')

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'username', 'password']
        widgets = {'password': forms.PasswordInput}

    def clean_username(self):
        username = self.cleaned_data['username'].strip()
        if User.objects.filter(username=username).exists():
            raise forms.ValidationError('This username is already taken.')
        return username

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        if User.objects.filter(email=email).exists():
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def clean(self):
        cleaned = super().clean()
        _validate_signup_password(self, cleaned)
        return cleaned


#for student related form
class StudentUserForm(forms.ModelForm):
    # Capped at 20 chars (not User.username's default 150) because this value is copied
    # verbatim into StudentExtra.roll, which is varchar(20) — without this the form accepts
    # a value the DB then rejects with an uncaught DataError after the User row is already saved.
    username = forms.CharField(max_length=20)
    password2 = forms.CharField(widget=forms.PasswordInput, label='Confirm password')

    class Meta:
        model=User
        fields=['first_name','last_name','username','password']

    def clean_username(self):
        # Doubles as the admission number (StudentExtra.roll, also unique) — Django's
        # automatic ModelForm uniqueness check on User.username would already catch a
        # collision, but its default message ("A user with that username already exists.")
        # doesn't make sense for a field the applicant sees labeled "Admission Number".
        username = self.cleaned_data['username'].strip()
        if User.objects.filter(username=username).exists():
            raise forms.ValidationError('This admission number is already registered. Please double-check it, or use a different one.')
        return username

    def clean(self):
        cleaned = super().clean()
        _validate_signup_password(self, cleaned)
        return cleaned


class StudentExtraForm(forms.ModelForm):
    cl = forms.ModelChoiceField(
        queryset=models.ClassStream.objects.all().order_by('grade__numeric_order', 'name'),
        empty_label="--- Select Your Class / Stream ---",
        label="Class / Stream"
    )

    # --- FAMILY STRUCTURE ---
    # Drives which of the fields below are actually required — see clean() — and which
    # inputs the signup page shows/hides. Not saved directly: father_name/mother_name/
    # guardian_name below are, and StudentExtra.refresh_parent_summary() derives the
    # legacy parent_name/parent_mobile summary from whichever of them got filled in.
    family_structure = forms.ChoiceField(
        choices=models.StudentExtra.FAMILY_STRUCTURE_CHOICES,
        label="Family Structure",
    )
    single_parent_type = forms.ChoiceField(
        choices=models.StudentExtra.SINGLE_PARENT_CHOICES,
        required=False,
        label="This parent is the child's",
    )
    father_name = forms.CharField(max_length=100, required=False, label="Father's Name")
    father_mobile = forms.CharField(max_length=40, required=False, label="Father's Mobile")
    mother_name = forms.CharField(max_length=100, required=False, label="Mother's Name")
    mother_mobile = forms.CharField(max_length=40, required=False, label="Mother's Mobile")
    guardian_name = forms.CharField(max_length=100, required=False, label="Guardian's Name")
    guardian_mobile = forms.CharField(max_length=40, required=False, label="Guardian's Mobile")
    guardian_relationship = forms.CharField(max_length=50, required=False, label="Guardian's Relationship to Child",
                                             help_text="e.g. Aunt, Grandfather, Family Friend")

    class Meta:
        model = models.StudentExtra
        fields = [
            'cl', 'mobile', 'address', 'profile_pic',
            'family_structure', 'single_parent_type',
            'father_name', 'father_mobile', 'mother_name', 'mother_mobile',
            'guardian_name', 'guardian_mobile', 'guardian_relationship',
        ]

    def clean(self):
        cleaned = super().clean()
        structure = cleaned.get('family_structure')

        if structure == 'both':
            for field, label in (('father_name', "Father's name"), ('father_mobile', "Father's mobile"),
                                  ('mother_name', "Mother's name"), ('mother_mobile', "Mother's mobile")):
                if not cleaned.get(field):
                    self.add_error(field, f"{label} is required when both parents are selected.")

        elif structure == 'single':
            parent_type = cleaned.get('single_parent_type')
            if not parent_type:
                self.add_error('single_parent_type', "Select whether this is the child's mother or father.")
            else:
                name_field = 'mother_name' if parent_type == 'Mother' else 'father_name'
                mobile_field = 'mother_mobile' if parent_type == 'Mother' else 'father_mobile'
                if not cleaned.get(name_field):
                    self.add_error(name_field, "Parent's name is required.")
                if not cleaned.get(mobile_field):
                    self.add_error(mobile_field, "Parent's mobile is required.")

        elif structure == 'guardian':
            if not cleaned.get('guardian_name'):
                self.add_error('guardian_name', "Guardian's name is required.")
            if not cleaned.get('guardian_mobile'):
                self.add_error('guardian_mobile', "Guardian's mobile is required.")

        return cleaned



#for contact us page
class ContactusForm(forms.Form):
    Name = forms.CharField(max_length=30)
    Email = forms.EmailField()
    Message = forms.CharField(max_length=500,widget=forms.Textarea(attrs={'rows': 3, 'cols': 30}))


# --- PARENT FORMS ---
class ParentUserForm(forms.ModelForm):
    password2 = forms.CharField(widget=forms.PasswordInput, label='Confirm password')

    class Meta:
        model = User
        # ADDED 'email' HERE
        fields = ['first_name', 'last_name', 'username', 'email', 'password']
        widgets = {
            'password': forms.PasswordInput()
        }

    def clean_username(self):
        username = self.cleaned_data['username'].strip()
        if User.objects.filter(username=username).exists():
            raise forms.ValidationError('This username is already taken. Please choose another.')
        return username

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        if User.objects.filter(email=email).exists():
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def clean(self):
        cleaned = super().clean()
        _validate_signup_password(self, cleaned)
        return cleaned

class ParentExtraForm(forms.ModelForm):
    # Populated by the search-and-select UI (static/js/parent_signup.js) as a
    # comma-separated list of StudentExtra IDs picked from api_search_students_for_parent_signup
    # results. Selecting a real search result is inherently exact, which replaces the old
    # free-text admission-number + name matching — that was only typo protection, never
    # real identity verification (the actual verification gate is admin approval, which
    # every new ParentExtra still requires regardless of how the child was selected).
    selected_student_ids = forms.CharField(widget=forms.HiddenInput(), required=True)

    class Meta:
        model = models.ParentExtra
        # Only 'mobile' and 'relationship' are taken from the form directly.
        # 'user' and 'status' are set in views.py; 'students' comes from selected_student_ids.
        fields = ['mobile', 'relationship']

    def clean_selected_student_ids(self):
        raw = self.cleaned_data['selected_student_ids'].strip()
        if not raw:
            raise forms.ValidationError("Search for your child above and select them from the results.")

        try:
            ids = [int(x) for x in raw.split(',') if x.strip()]
        except ValueError:
            raise forms.ValidationError("Invalid student selection — please search and select again.")

        if not ids:
            raise forms.ValidationError("Search for your child above and select them from the results.")

        students = list(models.StudentExtra.objects.filter(id__in=ids))
        if len(students) != len(set(ids)):
            raise forms.ValidationError("One or more selected students could not be found — please search and select again.")

        return students