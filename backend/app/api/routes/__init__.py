from .activity import router as activity_router
from .auth import router as auth_router
from .conversations import router as conversations_router
from .direct_chat import router as direct_chat_router
from .ingestion import router as ingestion_router
from .jobs import router as jobs_router
from .memories import router as memories_router
from .memory_signals import router as memory_signals_router
from .nebula import router as nebula_router
from .profile import router as profile_router
from .social import router as social_router
from .system import router as system_router
from .test_data import router as test_data_router
from .universe import router as universe_router

__all__ = [
    "activity_router",
    "auth_router",
    "conversations_router",
    "direct_chat_router",
    "ingestion_router",
    "jobs_router",
    "memories_router",
    "memory_signals_router",
    "nebula_router",
    "profile_router",
    "social_router",
    "system_router",
    "test_data_router",
    "universe_router",
]

