from django import forms
from django.contrib.auth.models import User
from school import models


#for admin
class AdminSigupForm(forms.ModelForm):
    # No username field — the template collects email instead, and the view
    # auto-generates a unique username from it (see admin_signup_view).
    email = forms.EmailField()
    mobile = forms.CharField(max_length=40)
    address = forms.CharField(max_length=200)
    password2 = forms.CharField(widget=forms.PasswordInput, label='Confirm password')

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'password']
        widgets = {'password': forms.PasswordInput}

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        if User.objects.filter(email=email).exists():
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def clean(self):
        cleaned = super().clean()
        password = cleaned.get('password')
        password2 = cleaned.get('password2')

        if password and len(password) < 6:
            self.add_error('password', 'Password must be at least 6 characters.')
        elif password and password2 and password != password2:
            self.add_error('password2', 'Passwords do not match.')

        return cleaned


#for student related form
class StudentUserForm(forms.ModelForm):
    # Capped at 20 chars (not User.username's default 150) because this value is copied
    # verbatim into StudentExtra.roll, which is varchar(20) — without this the form accepts
    # a value the DB then rejects with an uncaught DataError after the User row is already saved.
    username = forms.CharField(max_length=20)

    class Meta:
        model=User
        fields=['first_name','last_name','username','password']
class StudentExtraForm(forms.ModelForm):
    cl = forms.ModelChoiceField(
        queryset=models.ClassStream.objects.all().order_by('grade__numeric_order', 'name'),
        empty_label="--- Select Your Class / Stream ---",
        label="Class / Stream"
    )

    class Meta:
        model=models.StudentExtra
        fields = ['cl', 'mobile','address', 'profile_pic', 'parent_name','parent_mobile']



#for contact us page
class ContactusForm(forms.Form):
    Name = forms.CharField(max_length=30)
    Email = forms.EmailField()
    Message = forms.CharField(max_length=500,widget=forms.Textarea(attrs={'rows': 3, 'cols': 30}))


# --- PARENT FORMS ---
class ParentUserForm(forms.ModelForm):
    class Meta:
        model = User
        # ADDED 'email' HERE
        fields = ['first_name', 'last_name', 'username', 'email', 'password']
        widgets = {
            'password': forms.PasswordInput()
        }

class ParentExtraForm(forms.ModelForm):
    # These fields are used for verification, NOT saved directly to ParentExtra
    child_roll = forms.CharField(
        label="Child's Admission Number",
        max_length=100,
        required=True,
    )
    child_first_name = forms.CharField(
        label="Child's First Name",
        max_length=100,
        required=True,
    )
    child_last_name = forms.CharField(
        label="Child's Last Name",
        max_length=100,
        required=True,
    )

    class Meta:
        model = models.ParentExtra
        # Only 'mobile' is taken from the form directly.
        # 'student' and 'status' are handled in views.py
        fields = ['mobile', 'relationship']