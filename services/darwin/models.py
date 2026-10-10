# DRAFT: review with lanes A and B
# Pydantic mirrors of packages/shared/src/index.ts. Change both together.

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

ToolName = Literal[
    "plan",
    "route",
    "check_permission",
    "draft",
    "pay",
    "call",
    "match",
]


class OrgEdge(BaseModel):
    """One edge in the org map: who handles which kind of task."""

    from_: str = Field(alias="from")  # person or team id
    to: str  # person or team id
    task_type: str
    confidence: float = Field(ge=0, le=1)
    source: Literal["chart", "learned"]
    delegate_until: Optional[str] = None  # ISO 8601

    model_config = {"populate_by_name": True}


class Event(BaseModel):
    """One logged event. A writes, C stores, B renders."""

    id: str
    ts: str  # ISO 8601
    type: str
    actor: str
    request_id: Optional[str] = None
    tool: Optional[ToolName] = None
    payload: dict[str, Any] = Field(default_factory=dict)


class EventUpdate(BaseModel):
    kind: Literal["event"]
    ts: str
    data: Event


class EdgeUpdate(BaseModel):
    kind: Literal["edge"]
    ts: str
    data: OrgEdge


LiveUpdate = Union[EventUpdate, EdgeUpdate]
