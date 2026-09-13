from sqlalchemy import select
from fastapi.testclient import TestClient

from app.db import DirectMessageRow, IntegrationOutboxRow
from app.main import create_app


def _login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post('/api/auth/signin', json={
        'email': email,
        'password': 'Cosmos2026!' if email.startswith('demo@') else 'Friend2026!',
    })
    assert response.status_code == 200, response.text
    return {'Authorization': f"Bearer {response.json()['session']['token']}"}


def test_direct_chat_is_real_user_to_user_and_durable(tmp_path) -> None:
    app = create_app(
        f"sqlite:///{(tmp_path / 'direct-chat.db').as_posix()}",
        seed_demo=True,
    )
    with TestClient(app) as client:
        zaosusu = _login(client, 'demo@socialcosmos.local')
        maya = _login(client, 'maya@socialcosmos.local')

        friends = client.get('/api/v1/chat/conversations', headers=zaosusu)
        assert friends.status_code == 200, friends.text
        maya_card = next(item for item in friends.json()['items'] if item['targetName'] == 'Maya Chen')
        assert maya_card['conversationId'] is None

        created = client.post('/api/v1/chat/conversations', headers=zaosusu, json={
            'targetUserId': maya_card['targetUserId'],
        })
        assert created.status_code == 201, created.text
        conversation_id = created.json()['conversationId']

        sent = client.post(
            f'/api/v1/chat/conversations/{conversation_id}/messages',
            headers=zaosusu,
            json={'clientMessageId': 'hello-1', 'content': '今晚一起看星星吗？'},
        )
        assert sent.status_code == 202, sent.text
        assert sent.json()['message']['mine'] is True
        assert sent.json()['message']['senderName'] == 'Zaosusu'
        assert sent.json()['analysis']['status'] == 'queued'

        duplicate = client.post(
            f'/api/v1/chat/conversations/{conversation_id}/messages',
            headers=zaosusu,
            json={'clientMessageId': 'hello-1', 'content': '今晚一起看星星吗？'},
        )
        assert duplicate.status_code == 202
        assert duplicate.json()['message']['id'] == sent.json()['message']['id']

        maya_friends = client.get('/api/v1/chat/conversations', headers=maya).json()['items']
        incoming = next(item for item in maya_friends if item['targetName'] == 'Zaosusu')
        assert incoming['unreadCount'] == 1

        received = client.get(
            f'/api/v1/chat/conversations/{conversation_id}/messages', headers=maya,
        )
        assert received.status_code == 200
        message = received.json()['items'][0]
        assert message['mine'] is False
        assert message['senderName'] == 'Zaosusu'
        assert message['content'] == '今晚一起看星星吗？'

        read = client.post(f'/api/v1/chat/conversations/{conversation_id}/read', headers=maya)
        assert read.status_code == 200
        refreshed = client.get('/api/v1/chat/conversations', headers=maya).json()['items']
        assert next(item for item in refreshed if item['targetName'] == 'Zaosusu')['unreadCount'] == 0

        with app.state.database.session() as db:
            row = db.scalar(select(DirectMessageRow).where(DirectMessageRow.id == sent.json()['message']['id']))
            assert row is not None
            outbox = db.scalar(select(IntegrationOutboxRow).where(
                IntegrationOutboxRow.aggregate_id == row.id,
                IntegrationOutboxRow.destination == 'chat_memory_analysis',
            ))
            assert outbox is not None
            assert outbox.status == 'pending'
