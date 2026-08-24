from chatbot import create_chatbot_app


def test_chat_route_registered():
    app = create_chatbot_app()
    paths = {route.path for route in app.routes}
    assert "/chat" in paths


def test_client_fixture_boots(client):
    paths = {route.path for route in client.app.routes}
    assert "/chat" in paths
