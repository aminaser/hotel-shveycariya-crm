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
    alumni_prices,
    analytics,
    auth,
    banquets,
    clients,
    guest_requests,
    guest_services,
    health,
    restaurant_menu,
    rooms,
    settings as settings_router,
    setup,
    spa_bookings,
    spa_payments,
    spa_prices,
    stays,
    sync as sync_router,
    takeaway_menu,
    takeaway_orders,
    timesheet,
    trash,
    users,
)

import app.models.activity_log  # noqa: F401
import app.models.app_settings  # noqa: F401
import app.models.banquet  # noqa: F401
import app.models.client  # noqa: F401
import app.models.employee  # noqa: F401
import app.models.guest_request_local  # noqa: F401
import app.models.guest_service  # noqa: F401
import app.models.room  # noqa: F401
import app.models.spa_booking_local  # noqa: F401
import app.models.spa_booking_payment  # noqa: F401
import app.models.stay  # noqa: F401
import app.models.sync_meta  # noqa: F401
import app.models.takeaway_order  # noqa: F401
import app.models.timesheet_shift  # noqa: F401
import app.models.user  # noqa: F401

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_migrations()

    import threading
    import time

    from app.core.database import SessionLocal
    from app.services.supabase_crm_sync import run_full_sync

    stop = threading.Event()

    def _sync_loop() -> None:
        # Initial pull/push shortly after boot.
        time.sleep(2)
        while not stop.is_set():
            db = SessionLocal()
            try:
                run_full_sync(db)
            except Exception:
                pass
            finally:
                db.close()
            stop.wait(60)

    worker = threading.Thread(target=_sync_loop, name="crm-sync", daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()


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
app.include_router(takeaway_menu.router, prefix=API_PREFIX)
app.include_router(spa_prices.router, prefix=API_PREFIX)
app.include_router(spa_payments.router, prefix=API_PREFIX)
app.include_router(spa_bookings.router, prefix=API_PREFIX)
app.include_router(guest_requests.router, prefix=API_PREFIX)
app.include_router(sync_router.router, prefix=API_PREFIX)
app.include_router(alumni_prices.router, prefix=API_PREFIX)
app.include_router(takeaway_orders.router, prefix=API_PREFIX)
app.include_router(guest_services.router, prefix=API_PREFIX)
app.include_router(timesheet.router, prefix=API_PREFIX)
