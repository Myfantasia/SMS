from django.urls import path

from school.consumers.chat_consumer import ChatConsumer
from school.consumers.inbox_consumer import InboxConsumer

websocket_urlpatterns = [
    path('ws/chat/<uuid:thread_id>/', ChatConsumer.as_asgi()),
    path('ws/inbox/', InboxConsumer.as_asgi()),
]
