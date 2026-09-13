"""Persistence for capability-based shared visits; original domain models stay intact."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base

class OrbitVisitRow(Base):
    __tablename__ = 'orbit_visits'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    planet_id: Mapped[str] = mapped_column(String(80))
    page: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class OrbitVisitorRow(Base):
    __tablename__ = 'orbit_visit_participants'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey('orbit_visits.id'), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class OrbitReadOnlySessionRow(Base):
    __tablename__ = 'orbit_readonly_sessions'
    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey('orbit_visits.id'), index=True)
