from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import Field, model_validator

from .base import ApiModel


class Verification(str, Enum):
    UNVERIFIED = "unverified"
    SELF_ATTESTED = "self_attested"
    VERIFIED = "verified"


class Visibility(str, Enum):
    PRIVATE = "private"
    CONNECTIONS = "connections"
    PUBLIC = "public"


class EducationLevel(str, Enum):
    PRIMARY = "primary"
    SECONDARY = "secondary"
    VOCATIONAL = "vocational"
    ASSOCIATE = "associate"
    BACHELOR = "bachelor"
    MASTER = "master"
    DOCTORATE = "doctorate"
    OTHER = "other"


class Seniority(str, Enum):
    INTERN = "intern"
    INDIVIDUAL = "individual"
    LEAD = "lead"
    MANAGER = "manager"
    EXECUTIVE = "executive"
    FOUNDER = "founder"
    OTHER = "other"


class PersonalityType(str, Enum):
    """Optional 16-personality profile signal.

    It is deliberately stored as a profile fact. Users never turn it into a
    relationship-strength slider, and a missing value never lowers affinity.
    """

    INTJ = "INTJ"
    INTP = "INTP"
    ENTJ = "ENTJ"
    ENTP = "ENTP"
    INFJ = "INFJ"
    INFP = "INFP"
    ENFJ = "ENFJ"
    ENFP = "ENFP"
    ISTJ = "ISTJ"
    ISFJ = "ISFJ"
    ESTJ = "ESTJ"
    ESFJ = "ESFJ"
    ISTP = "ISTP"
    ISFP = "ISFP"
    ESTP = "ESTP"
    ESFP = "ESFP"


class DateRange(ApiModel):
    start_date: date | None = None
    end_date: date | None = None
    is_current: bool = False

    @model_validator(mode="after")
    def validate_range(self) -> "DateRange":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must not be earlier than start_date")
        if self.is_current and self.end_date:
            raise ValueError("a current period cannot have end_date")
        return self


class PlaceInput(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class ResidenceInput(ApiModel):
    place: PlaceInput
    period: DateRange = Field(default_factory=DateRange)
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class EducationInput(ApiModel):
    institution: str = Field(min_length=1, max_length=200)
    level: EducationLevel
    field_of_study: str = Field(default="", max_length=160)
    period: DateRange = Field(default_factory=DateRange)
    place: PlaceInput | None = None
    completed: bool = True
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class WorkInput(ApiModel):
    organization: str = Field(min_length=1, max_length=200)
    role: str = Field(min_length=1, max_length=160)
    industry: str = Field(default="", max_length=120)
    seniority: Seniority = Seniority.INDIVIDUAL
    period: DateRange = Field(default_factory=DateRange)
    place: PlaceInput | None = None
    highlights: list[str] = Field(default_factory=list, max_length=12)
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class ProjectInput(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="project", max_length=80)
    domain: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    period: DateRange = Field(default_factory=DateRange)
    collaborator_count: int = Field(default=0, ge=0, le=10000)
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class SkillInput(ApiModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="", max_length=100)
    proficiency: int = Field(default=3, ge=1, le=5)
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class InterestInput(ApiModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="", max_length=100)
    visibility: Visibility = Visibility.CONNECTIONS


class AchievementInput(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="achievement", max_length=80)
    occurred_at: date | None = None
    description: str = Field(default="", max_length=1000)
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class ProfileAttributeInput(ApiModel):
    """Forward-compatible profile fact not yet promoted to a first-class field.

    The client supplies facts only. Similarity strategy and weight always come
    from the backend feature registry, never from user-controlled input.
    """

    key: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_.-]*$")
    label: str = Field(default="", max_length=160)
    category: str = Field(default="other", min_length=1, max_length=80)
    value: str | float | bool | list[str]
    period: DateRange | None = None
    place: PlaceInput | None = None
    verification: Verification = Verification.SELF_ATTESTED
    visibility: Visibility = Visibility.CONNECTIONS


class ProfileIntake(ApiModel):
    display_name: str = Field(min_length=2, max_length=80)
    bio: str = Field(default="", max_length=2000)
    birth_date: date | None = None
    birth_place: PlaceInput | None = None
    personality_type: PersonalityType | None = None
    residences: list[ResidenceInput] = Field(default_factory=list, max_length=30)
    education: list[EducationInput] = Field(default_factory=list, max_length=30)
    work: list[WorkInput] = Field(default_factory=list, max_length=60)
    projects: list[ProjectInput] = Field(default_factory=list, max_length=100)
    skills: list[SkillInput] = Field(default_factory=list, max_length=100)
    interests: list[InterestInput] = Field(default_factory=list, max_length=100)
    achievements: list[AchievementInput] = Field(default_factory=list, max_length=100)
    attributes: list[ProfileAttributeInput] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_timeline(self) -> "ProfileIntake":
        today = date.today()
        if self.birth_date and self.birth_date > today:
            raise ValueError("birth_date cannot be in the future")
        for item in [*self.residences, *self.education, *self.work, *self.projects]:
            period = item.period
            if period.start_date and period.start_date > today:
                raise ValueError("experience start_date cannot be in the future")
            if self.birth_date and period.start_date and period.start_date < self.birth_date:
                raise ValueError("experience cannot start before birth_date")
        return self
