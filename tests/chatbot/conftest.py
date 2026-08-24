import pytest
from fastapi.testclient import TestClient

from chatbot import create_chatbot_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_chatbot_app())
