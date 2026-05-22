# your_chat_app/firebase_service.py
import os
import firebase_admin
from firebase_admin import credentials, firestore
from django.conf import settings

# 1. Build the exact path to your JSON key (assuming it is next to manage.py)
KEY_PATH = os.path.join(settings.BASE_DIR, 'serviceKey.json')

# 2. Initialize Firebase ONLY IF it hasn't been initialized yet
# (Django reloads files sometimes, this prevents a "Firebase App already exists" crash)
if not firebase_admin._apps:
    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# --- THE SYNC FUNCTION ---
def sync_thread_to_firestore(thread_id, participant_emails):
    """
    Creates a shadow document in Firestore so the Security Rules
    know who is allowed to read and write messages.
    """
    try:
        doc_ref = db.collection('chat_threads').document(str(thread_id))
        doc_ref.set({
            'participants': participant_emails,
            'created_at': firestore.SERVER_TIMESTAMP
        })
        print(f"✅ Successfully synced thread {thread_id} to Firestore.")
    except Exception as e:
        print(f"❌ Failed to sync thread to Firestore: {e}")