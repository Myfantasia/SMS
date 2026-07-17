from channels.generic.websocket import AsyncJsonWebsocketConsumer


class InboxConsumer(AsyncJsonWebsocketConsumer):
    """
    One persistent socket per logged-in user (not per thread), so the sidebar can
    react live to messages arriving in threads the user isn't currently viewing.
    ChatConsumer pings this consumer's group whenever a message is sent/edited/deleted
    in any thread the recipient participates in — see _broadcast_inbox_update.
    """

    async def connect(self):
        self.user = self.scope['user']

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        self.group_name = f"inbox_{self.user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if getattr(self, 'group_name', None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Receive-only from the client's perspective — no client-initiated actions.
        pass

    async def inbox_update(self, event):
        await self.send_json(event)
