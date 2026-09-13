"""Offline adapter fixtures; leave upstream provider configuration untouched."""
import pytest
from app.application.scoring import _default_semantic_similarity

@pytest.fixture(autouse=True)
def offline_orbit_environment(monkeypatch):
    monkeypatch.setenv('OPENVIKING_AI_EMB_API_KEY', '')
    monkeypatch.setenv('SOCIAL_COSMOS_SEMANTIC_PROVIDER', 'openviking')
    monkeypatch.setenv('OPENAI_API_KEY', 'fake-test-key')
    _default_semantic_similarity.cache_clear()
    yield
    _default_semantic_similarity.cache_clear()
