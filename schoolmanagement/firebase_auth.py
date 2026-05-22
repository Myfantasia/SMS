import hashlib
from rest_framework import authentication
from rest_framework import exceptions
from firebase_admin import auth
from django.contrib.auth.models import User
from django.core.cache import cache


class FirebaseAuthentication(authentication.BaseAuthentication):
    """
    Custom Authentication class that intercepts API requests, reads the Firebase
    token from React, and matches it to a Django user via their email address.
    """

    def authenticate(self, request):
        # 1. Grab the Authorization header from the incoming request
        auth_header = request.META.get('HTTP_AUTHORIZATION')

        if not auth_header:
            return None  # No token provided, proceed as Anonymous Guest

        # 2. Safely extract the token (It comes as "Bearer eyJhbGciOi...")
        parts = auth_header.split()
        if parts[0].lower() != 'bearer' or len(parts) != 2:
            return None

        id_token = parts[1]

        # FIX: Hash the token to keep the cache key under 250 characters.
        # The raw JWT is ~900 chars and breaks memcached-compatible cache backends.
        token_hash = hashlib.sha256(id_token.encode()).hexdigest()
        cache_key = f'firebase_auth_{token_hash}'

        email = cache.get(cache_key)
        if email:
            user = User.objects.filter(email=email).order_by('-is_superuser', '-is_staff').first()
            if not user:
                raise exceptions.AuthenticationFailed(f'No Django user found matching the email: {email}')
            return (user, None)

        try:
            # 3. Ask Google/Firebase if this token is real and hasn't expired
            decoded_token = auth.verify_id_token(id_token)
        except Exception:
            raise exceptions.AuthenticationFailed('Invalid or expired Firebase token.')

        # 4. Extract the user's email from the Firebase token
        email = decoded_token.get('email')
        if not email:
            raise exceptions.AuthenticationFailed('Firebase token does not contain an email address.')

        # 5. Look up the corresponding user in your Django database
        try:
            user = User.objects.filter(email=email).order_by('-is_superuser', '-is_staff').first()
            if not user:
                raise User.DoesNotExist
        except User.DoesNotExist:
            raise exceptions.AuthenticationFailed(f'No Django user found matching the email: {email}')

        # 6. Cache the result using the hashed key (tokens expire after 1 hour)
        cache.set(cache_key, email, timeout=3600)

        # 7. Success! Hand the user to Django
        return (user, None)