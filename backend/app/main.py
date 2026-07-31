from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.services.migrations import run_migrations
from app.routers import (
    activity,
    acts,
    analytics,
    auth,
    banquets,
    clients,
    health,
    restaurant_menu,
    rooms,
    settings as settings_router,
    setup,
    stays,
    timesheet,
    trash,
    users,
)

import app.models.activity_log  # noqa: F401
import app.models.app_settings  # noqa: F401
import app.models.banquet  # noqa: F401
import app.models.client  # noqa: F401
import app.models.employee  # noqa: F401
import app.models.room  # noqa: F401
import app.models.stay  # noqa: F401
import app.models.timesheet_shift  # noqa: F401
import app.models.user  # noqa: F401

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_migrations()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=API_PREFIX)
app.include_router(setup.router, prefix=API_PREFIX)
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(users.router, prefix=API_PREFIX)
app.include_router(activity.router, prefix=API_PREFIX)
app.include_router(clients.router, prefix=API_PREFIX)
app.include_router(stays.router, prefix=API_PREFIX)
app.include_router(rooms.router, prefix=API_PREFIX)
app.include_router(banquets.router, prefix=API_PREFIX)
app.include_router(trash.router, prefix=API_PREFIX)
app.include_router(acts.router, prefix=API_PREFIX)
app.include_router(analytics.router, prefix=API_PREFIX)
app.include_router(settings_router.router, prefix=API_PREFIX)
app.include_router(restaurant_menu.router, prefix=API_PREFIX)
app.include_router(timesheet.router, prefix=API_PREFIX)
