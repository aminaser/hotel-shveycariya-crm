from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
@router.head("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
