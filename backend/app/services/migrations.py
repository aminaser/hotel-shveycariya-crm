from sqlalchemy import inspect, text

from app.core.database import SessionLocal, engine
from app.services.room_service import apply_due_checkins, today_local
from app.services.seed_room_rates import seed_room_rates
from app.services.seed_users import seed_users

SETTINGS_COLUMNS = {
    "hotel_legal_name": "VARCHAR(255)",
    "hotel_bin": "VARCHAR(12)",
    "hotel_address": "VARCHAR(512)",
    "hotel_director": "VARCHAR(255)",
    "act_next_number": "INTEGER DEFAULT 1",
}

CLIENT_COLUMNS = {
    "bin": "VARCHAR(12)",
    "client_type": "VARCHAR(16) DEFAULT 'individual'",
    "created_by_user_id": "INTEGER",
    "created_by_name": "VARCHAR(255)",
    "updated_by_user_id": "INTEGER",
    "updated_by_name": "VARCHAR(255)",
    "cloud_id": "VARCHAR(64)",
}

ROOM_COLUMNS = {
    "status_updated_at": "DATETIME",
    "price_per_night": "NUMERIC(12, 2)",
    "cloud_id": "VARCHAR(64)",
    "updated_at": "DATETIME",
}

BANQUET_COLUMNS = {
    "deleted_at": "DATETIME",
    "created_by_user_id": "INTEGER",
    "created_by_name": "VARCHAR(255)",
    "updated_by_user_id": "INTEGER",
    "updated_by_name": "VARCHAR(255)",
    "payment_method": "VARCHAR(64)",
    "payment_date": "DATE",
    "cloud_id": "VARCHAR(64)",
    "payment_amount": "NUMERIC(12, 2) DEFAULT 0",
    "payment_status": "VARCHAR(32) DEFAULT 'unpaid'",
}

TAKEAWAY_COLUMNS = {
    "payment_method": "VARCHAR(64)",
    "payment_date": "DATE",
    "cloud_id": "VARCHAR(64)",
}

STAY_COLUMNS = {
    "created_by_user_id": "INTEGER",
    "created_by_name": "VARCHAR(255)",
    "updated_by_user_id": "INTEGER",
    "updated_by_name": "VARCHAR(255)",
    "planned_check_out": "DATE",
    "payment_date": "DATE",
    "people_count": "INTEGER DEFAULT 1",
    "prepayment": "NUMERIC(12, 2) DEFAULT 0",
    "group_id": "VARCHAR(36)",
    "checked_in_at": "DATETIME",
    "cloud_id": "VARCHAR(64)",
    "extra_bedding": "BOOLEAN DEFAULT 0",
}

GUEST_SERVICE_COLUMNS = {
    "cloud_id": "VARCHAR(64)",
}

EMPLOYEE_COLUMNS = {
    "cloud_id": "VARCHAR(64)",
}

TIMESHEET_SHIFT_COLUMNS = {
    "cloud_id": "VARCHAR(64)",
    "deleted_at": "DATETIME",
}

USER_COLUMNS = {
    "full_name": "VARCHAR(255) DEFAULT ''",
    "role": "VARCHAR(32) DEFAULT 'admin'",
}


def _add_column_if_missing(conn, table: str, column: str, col_type: str) -> None:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns(table)}
    if column not in columns:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        conn.commit()


def _migrate_planned_check_out(conn) -> None:
    inspector = inspect(engine)
    if "stays" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("stays")}
    if "planned_check_out" not in columns:
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text("SELECT 1 FROM _crm_migrations WHERE name = 'planned_check_out_split'")
    ).fetchone()
    if done:
        return

    today = today_local().isoformat()
    # Old schema stored the planned departure in check_out. Copy it, then clear
    # check_out when the date is still today/future (guest has not left yet).
    conn.execute(
        text(
            """
            UPDATE stays
            SET planned_check_out = check_out,
                check_out = CASE
                    WHEN check_out >= :today THEN NULL
                    ELSE check_out
                END
            WHERE check_out IS NOT NULL
              AND planned_check_out IS NULL
            """
        ),
        {"today": today},
    )
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) "
            "VALUES ('planned_check_out_split', :applied_at)"
        ),
        {"applied_at": today},
    )
    conn.commit()


def _backfill_banquet_payment_status(conn) -> None:
    """Derive payment_status / payment_amount from legacy prepayment-only rows."""
    inspector = inspect(engine)
    if "banquets" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("banquets")}
    if "payment_status" not in columns or "payment_amount" not in columns:
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text("SELECT 1 FROM _crm_migrations WHERE name = 'banquet_payment_status_v1'")
    ).fetchone()
    if done:
        return

    # Legacy: prepayment > 0 meant money received → mark paid, total = prepayment.
    conn.execute(
        text(
            """
            UPDATE banquets
            SET payment_status = 'paid',
                payment_amount = CASE
                    WHEN COALESCE(payment_amount, 0) > 0 THEN payment_amount
                    ELSE prepayment
                END
            WHERE COALESCE(prepayment, 0) > 0
              AND (payment_status IS NULL OR payment_status = '' OR payment_status = 'unpaid')
            """
        )
    )
    conn.execute(
        text(
            """
            UPDATE banquets
            SET payment_status = 'unpaid',
                payment_amount = COALESCE(payment_amount, 0)
            WHERE payment_status IS NULL OR payment_status = ''
            """
        )
    )
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) "
            "VALUES ('banquet_payment_status_v1', :applied_at)"
        ),
        {"applied_at": today_local().isoformat()},
    )
    conn.commit()


def run_migrations() -> None:
    """Lightweight SQLite migrations for existing databases."""
    with engine.connect() as conn:
        inspector = inspect(engine)
        if "stays" in inspector.get_table_names():
            columns = {col["name"] for col in inspector.get_columns("stays")}
            if "payment_method" not in columns:
                conn.execute(
                    text("ALTER TABLE stays ADD COLUMN payment_method VARCHAR(64)")
                )
                conn.commit()

        for column, col_type in SETTINGS_COLUMNS.items():
            _add_column_if_missing(conn, "app_settings", column, col_type)

        for column, col_type in CLIENT_COLUMNS.items():
            _add_column_if_missing(conn, "clients", column, col_type)

        for column, col_type in ROOM_COLUMNS.items():
            _add_column_if_missing(conn, "rooms", column, col_type)

        for column, col_type in BANQUET_COLUMNS.items():
            _add_column_if_missing(conn, "banquets", column, col_type)

        _backfill_banquet_payment_status(conn)

        for column, col_type in TAKEAWAY_COLUMNS.items():
            _add_column_if_missing(conn, "takeaway_orders", column, col_type)

        conn.commit()

        for column, col_type in STAY_COLUMNS.items():
            _add_column_if_missing(conn, "stays", column, col_type)

        for column, col_type in GUEST_SERVICE_COLUMNS.items():
            _add_column_if_missing(conn, "guest_services", column, col_type)

        for column, col_type in EMPLOYEE_COLUMNS.items():
            _add_column_if_missing(conn, "employees", column, col_type)

        for column, col_type in TIMESHEET_SHIFT_COLUMNS.items():
            _add_column_if_missing(conn, "timesheet_shifts", column, col_type)

        for column, col_type in USER_COLUMNS.items():
            _add_column_if_missing(conn, "users", column, col_type)

        # Stable UUID keys used for Supabase multi-PC sync.
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        for table in (
            "banquets",
            "takeaway_orders",
            "clients",
            "rooms",
            "stays",
            "guest_services",
            "employees",
            "timesheet_shifts",
            "spa_bookings_local",
            "guest_requests_local",
        ):
            if table not in existing_tables:
                continue
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_cloud_id "
                    f"ON {table} (cloud_id)"
                )
            )
        conn.commit()

        # Split planned vs actual checkout: previously check_out held the planned
        # departure date, which blocked the «Выезд» action whenever a date was set.
        _migrate_planned_check_out(conn)
        _migrate_client_iin_bin_unique(conn)
        _migrate_payment_date_backfill(conn)
        _migrate_checked_in_at_backfill(conn)
        _migrate_clear_premature_checked_in_at(conn)

    db = SessionLocal()
    try:
        seed_users(db)
        seed_room_rates(db)
        apply_due_checkins(db)
        db.commit()
    finally:
        db.close()


def _migrate_clear_premature_checked_in_at(conn) -> None:
    """Undo backfill arrival marks for bookings that never went «в номере».

    Synthetic checked_in_at on free/booked rooms hid today's guests from
    «Номера» before 13:00 and would auto-occupy at 13:00 without confirm.
    """
    inspector = inspect(engine)
    if "stays" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("stays")}
    if "checked_in_at" not in columns:
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text(
            "SELECT 1 FROM _crm_migrations WHERE name = 'clear_premature_checked_in_at_v1'"
        )
    ).fetchone()
    if done:
        return

    today = today_local().isoformat()
    conn.execute(
        text(
            """
            UPDATE stays
            SET checked_in_at = NULL
            WHERE deleted_at IS NULL
              AND check_out IS NULL
              AND checked_in_at IS NOT NULL
              AND stay_type IN ('booking', 'alumni')
              AND COALESCE(check_in, record_date) >= :today
              AND room_id IN (
                SELECT id FROM rooms
                WHERE status IN ('free', 'booked', 'cleaning')
              )
            """
        ),
        {"today": today},
    )
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) VALUES "
            "('clear_premature_checked_in_at_v1', :at)"
        ),
        {"at": today},
    )
    conn.commit()


def _migrate_checked_in_at_backfill(conn) -> None:
    """Backfill arrival only for stays whose room is already marked occupied."""
    inspector = inspect(engine)
    if "stays" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("stays")}
    if "checked_in_at" not in columns:
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text("SELECT 1 FROM _crm_migrations WHERE name = 'checked_in_at_occupied_backfill'")
    ).fetchone()
    if done:
        return

    today = today_local().isoformat()
    conn.execute(
        text(
            """
            UPDATE stays
            SET checked_in_at = COALESCE(
              datetime(COALESCE(check_in, record_date) || ' 13:00:00'),
              created_at,
              CURRENT_TIMESTAMP
            )
            WHERE id IN (
              SELECT s.id
              FROM stays s
              JOIN rooms r ON r.id = s.room_id
              WHERE s.deleted_at IS NULL
                AND s.check_out IS NULL
                AND s.checked_in_at IS NULL
                AND s.stay_type IN ('booking', 'alumni')
                AND r.status = 'occupied'
            )
            """
        )
    )
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) VALUES "
            "('checked_in_at_occupied_backfill', :at)"
        ),
        {"at": today},
    )
    conn.commit()


def _migrate_client_iin_bin_unique(conn) -> None:
    """Drop DB-level UNIQUE on iin/bin so soft-deleted clients don't block reuse."""
    inspector = inspect(engine)
    if "clients" not in inspector.get_table_names():
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text("SELECT 1 FROM _crm_migrations WHERE name = 'client_iin_bin_soft_unique'")
    ).fetchone()
    if done:
        return

    # Drop known unique / index names SQLAlchemy may have created.
    for index_name in (
        "ix_clients_iin",
        "ix_clients_bin",
        "uq_clients_iin",
        "uq_clients_bin",
    ):
        conn.execute(text(f"DROP INDEX IF EXISTS {index_name}"))

    # Recreate as non-unique indexes for lookup performance.
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clients_iin ON clients (iin)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clients_bin ON clients (bin)"))
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) "
            "VALUES ('client_iin_bin_soft_unique', :applied_at)"
        ),
        {"applied_at": today_local().isoformat()},
    )
    conn.commit()


def _migrate_payment_date_backfill(conn) -> None:
    """For already-paid stays without payment_date, use record_date."""
    inspector = inspect(engine)
    if "stays" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("stays")}
    if "payment_date" not in columns:
        return

    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _crm_migrations ("
            "name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
    )
    conn.commit()
    done = conn.execute(
        text("SELECT 1 FROM _crm_migrations WHERE name = 'payment_date_backfill'")
    ).fetchone()
    if done:
        return

    conn.execute(
        text(
            """
            UPDATE stays
            SET payment_date = record_date
            WHERE payment_date IS NULL
              AND payment_status IN ('paid', 'partial')
            """
        )
    )
    conn.execute(
        text(
            "INSERT INTO _crm_migrations (name, applied_at) "
            "VALUES ('payment_date_backfill', :applied_at)"
        ),
        {"applied_at": today_local().isoformat()},
    )
    conn.commit()
