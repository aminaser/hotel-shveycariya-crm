from sqlalchemy import inspect, text

from app.core.database import SessionLocal, engine
from app.services.room_service import today_local
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
}

ROOM_COLUMNS = {
    "status_updated_at": "DATETIME",
    "price_per_night": "NUMERIC(12, 2)",
}

BANQUET_COLUMNS = {
    "deleted_at": "DATETIME",
    "created_by_user_id": "INTEGER",
    "created_by_name": "VARCHAR(255)",
    "updated_by_user_id": "INTEGER",
    "updated_by_name": "VARCHAR(255)",
    "payment_method": "VARCHAR(64)",
}

STAY_COLUMNS = {
    "created_by_user_id": "INTEGER",
    "created_by_name": "VARCHAR(255)",
    "updated_by_user_id": "INTEGER",
    "updated_by_name": "VARCHAR(255)",
    "planned_check_out": "DATE",
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

        for column, col_type in STAY_COLUMNS.items():
            _add_column_if_missing(conn, "stays", column, col_type)

        for column, col_type in USER_COLUMNS.items():
            _add_column_if_missing(conn, "users", column, col_type)

        # Split planned vs actual checkout: previously check_out held the planned
        # departure date, which blocked the «Выезд» action whenever a date was set.
        _migrate_planned_check_out(conn)

    db = SessionLocal()
    try:
        seed_users(db)
        seed_room_rates(db)
    finally:
        db.close()
