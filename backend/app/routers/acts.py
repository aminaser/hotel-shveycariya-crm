from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.client import Client
from app.models.stay import PaymentStatus, Stay
from app.models.user import User
from app.schemas.act import (
    ActDocument,
    ActJournalLinesRequest,
    ActJournalLinesResponse,
    ActLineItem,
    ActLineItemInput,
    ActLookupResponse,
    ActNextNumberResponse,
    ActParty,
    ActPreviewRequest,
)
from app.services.act_excel import (
    EXECUTOR_BIN_DEFAULT,
    EXECUTOR_FULL,
    build_act_template_workbook,
    build_act_workbook,
)
from app.services.invoice_excel import (
    build_invoice_workbook,
    build_payment_invoice_workbook,
)
from app.services.room_service import today_local
from app.services.settings_service import get_or_create_settings

router = APIRouter(prefix="/acts", tags=["acts"])

EXECUTOR_NAME = 'ИП Торгово-развлекательный комплекс "Швейцария" Бектурова Ж.К.'
EXECUTOR_ADDRESS = EXECUTOR_FULL


def _amount_to_words(amount: Decimal) -> str:
    n = int(amount)
    if n == 0:
        return "ноль тенге"

    ones = [
        "",
        "один",
        "два",
        "три",
        "четыре",
        "пять",
        "шесть",
        "семь",
        "восемь",
        "девять",
        "десять",
        "одиннадцать",
        "двенадцать",
        "тринадцать",
        "четырнадцать",
        "пятнадцать",
        "шестнадцать",
        "семнадцать",
        "восемнадцать",
        "девятнадцать",
    ]
    tens = [
        "",
        "",
        "двадцать",
        "тридцать",
        "сорок",
        "пятьдесят",
        "шестьдесят",
        "семьдесят",
        "восемьдесят",
        "девяносто",
    ]
    hundreds = [
        "",
        "сто",
        "двести",
        "триста",
        "четыреста",
        "пятьсот",
        "шестьсот",
        "семьсот",
        "восемьсот",
        "девятьсот",
    ]

    def chunk_to_words(num: int) -> str:
        parts: list[str] = []
        if num >= 100:
            parts.append(hundreds[num // 100])
            num %= 100
        if num >= 20:
            parts.append(tens[num // 10])
            num %= 10
        if num > 0:
            parts.append(ones[num])
        return " ".join(p for p in parts if p)

    millions = n // 1_000_000
    thousands = (n % 1_000_000) // 1000
    remainder = n % 1000

    words: list[str] = []
    if millions:
        words.append(chunk_to_words(millions))
        words.append("миллион" if millions == 1 else "миллионов" if millions > 4 else "миллиона")
    if thousands:
        words.append(chunk_to_words(thousands))
        words.append("тысяча" if thousands == 1 else "тысяч" if thousands > 4 else "тысячи")
    if remainder or not words:
        words.append(chunk_to_words(remainder))

    return f"{' '.join(words).strip()} тенге 00 тиын"


def _format_period(stay: Stay) -> str:
    start = stay.check_in or stay.record_date
    end = stay.check_out or stay.planned_check_out or stay.record_date
    if start == end:
        return start.strftime("%d.%m.%Y")
    return f"с {start.strftime('%d.%m.%Y')} по {end.strftime('%d.%m.%Y')}"


def _stay_nights(stay: Stay) -> int:
    start = stay.check_in or stay.record_date
    end = stay.check_out or stay.planned_check_out or stay.record_date
    return max((end - start).days, 1)


def _find_client(
    db: Session,
    *,
    client_id: int | None,
    iin: str | None,
    bin_value: str | None,
) -> Client | None:
    if client_id:
        return (
            db.query(Client)
            .filter(Client.id == client_id, Client.deleted_at.is_(None))
            .first()
        )
    if iin:
        return (
            db.query(Client)
            .filter(Client.iin == iin, Client.deleted_at.is_(None))
            .first()
        )
    if bin_value:
        return (
            db.query(Client)
            .filter(Client.bin == bin_value, Client.deleted_at.is_(None))
            .first()
        )
    return None


def _build_manual_line_items(items: list[ActLineItemInput]) -> list[ActLineItem]:
    line_items: list[ActLineItem] = []
    for idx, item in enumerate(items, start=1):
        amount = item.amount or (item.quantity * item.unit_price).quantize(Decimal("1"))
        line_items.append(
            ActLineItem(
                line_no=idx,
                description=item.description,
                service_date=item.service_date,
                unit=item.unit,
                quantity=item.quantity,
                unit_price=item.unit_price,
                amount=amount,
                vat_amount=item.vat_amount,
            )
        )
    return line_items


def _build_journal_line_items(stays: list[Stay]) -> list[ActLineItem]:
    line_items: list[ActLineItem] = []
    for idx, stay in enumerate(stays, start=1):
        nights = _stay_nights(stay)
        # Per-night price so the form reads like the official sample:
        # «Проживание в гостинице <ФИО>» · 5 сут. × 15 000 = 75 000.
        unit_price = (stay.payment_amount / nights).quantize(Decimal("0.01"))
        line_items.append(
            ActLineItem(
                line_no=idx,
                description=f"Проживание в гостинице {stay.client.full_name}",
                service_date=_format_period(stay),
                unit="сут.",
                quantity=Decimal(nights),
                unit_price=unit_price,
                amount=stay.payment_amount,
                vat_amount=Decimal("0"),
                stay_id=stay.id,
            )
        )
    return line_items


def _merge_line_items(
    manual_items: list[ActLineItemInput] | None,
    journal_items: list[ActLineItem],
) -> list[ActLineItem]:
    if manual_items and journal_items:
        manual = _build_manual_line_items(manual_items)
        offset = len(manual)
        for item in journal_items:
            item.line_no += offset
        return manual + journal_items
    if journal_items:
        return journal_items
    if manual_items:
        return _build_manual_line_items(manual_items)
    return []


@router.get("/next-number", response_model=ActNextNumberResponse)
def get_next_act_number(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ActNextNumberResponse:
    app_settings = get_or_create_settings(db)
    return ActNextNumberResponse(next_number=app_settings.act_next_number or 1)


@router.get("/lookup", response_model=ActLookupResponse)
def lookup_recipient(
    iin: str | None = Query(default=None),
    bin: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ActLookupResponse:
    if not iin and not bin:
        raise HTTPException(status_code=400, detail="Укажите ИИН или БИН")

    client = _find_client(db, client_id=None, iin=iin, bin_value=bin)
    if not client:
        return ActLookupResponse(found=False)

    return ActLookupResponse(
        found=True,
        client_id=client.id,
        full_name=client.full_name,
        iin=client.iin,
        bin=client.bin,
        client_type=client.client_type,
        phone=client.phone,
    )


@router.post("/journal-lines", response_model=ActJournalLinesResponse)
def journal_lines(
    payload: ActJournalLinesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ActJournalLinesResponse:
    client = _find_client(
        db,
        client_id=payload.client_id,
        iin=payload.iin,
        bin_value=payload.bin,
    )
    if not client:
        raise HTTPException(
            status_code=404,
            detail="Заказчик не найден. Добавьте клиента с ИИН/БИН в разделе «Клиенты»",
        )

    query = (
        db.query(Stay)
        .options(joinedload(Stay.room), joinedload(Stay.client))
        .filter(
            Stay.client_id == client.id,
            Stay.deleted_at.is_(None),
            Stay.record_date >= payload.date_from,
            Stay.record_date <= payload.date_to,
            Stay.payment_status.in_([PaymentStatus.paid, PaymentStatus.partial]),
        )
        .order_by(Stay.record_date.asc())
    )

    if payload.stay_ids:
        query = query.filter(Stay.id.in_(payload.stay_ids))

    stays = query.all()
    if not stays:
        raise HTTPException(
            status_code=404,
            detail="Нет оплаченных записей за выбранный период",
        )

    return ActJournalLinesResponse(line_items=_build_journal_line_items(stays))


@router.post("/preview", response_model=ActDocument)
def preview_act(
    payload: ActPreviewRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ActDocument:
    app_settings = get_or_create_settings(db)

    client = _find_client(
        db,
        client_id=payload.client_id,
        iin=payload.iin,
        bin_value=payload.bin,
    )

    journal_items: list[ActLineItem] = []
    if payload.use_journal:
        if not client:
            raise HTTPException(
                status_code=404,
                detail="Для заполнения из журнала найдите заказчика по ИИН/БИН или добавьте в «Клиенты»",
            )

        query = (
            db.query(Stay)
            .options(joinedload(Stay.room), joinedload(Stay.client))
            .filter(
                Stay.client_id == client.id,
                Stay.deleted_at.is_(None),
                Stay.record_date >= payload.date_from,
                Stay.record_date <= payload.date_to,
                Stay.payment_status.in_([PaymentStatus.paid, PaymentStatus.partial]),
            )
            .order_by(Stay.record_date.asc())
        )

        if payload.stay_ids:
            query = query.filter(Stay.id.in_(payload.stay_ids))

        stays = query.all()
        if not stays:
            raise HTTPException(
                status_code=404,
                detail="Нет оплаченных записей за выбранный период",
            )
        journal_items = _build_journal_line_items(stays)

    line_items = _merge_line_items(payload.line_items, journal_items)
    if not line_items:
        raise HTTPException(status_code=400, detail="Добавьте хотя бы одну строку услуги")

    total_quantity = sum((item.quantity for item in line_items), Decimal("0"))
    total = sum((item.amount for item in line_items), Decimal("0"))
    total_vat = sum((item.vat_amount for item in line_items), Decimal("0"))

    act_date = payload.act_date or today_local()

    if payload.act_number:
        act_number = payload.act_number
    else:
        next_no = app_settings.act_next_number or 1
        act_number = str(next_no)
        app_settings.act_next_number = next_no + 1
        db.commit()

    if payload.recipient_type == "individual":
        id_label = "ИИН"
        customer_id = (payload.iin or (client.iin if client else None) or "").strip()
    else:
        id_label = "БИН"
        customer_id = (payload.bin or (client.bin if client else None) or "").strip()

    customer_name = (payload.customer_name or (client.full_name if client else None) or "").strip()
    if not customer_name:
        raise HTTPException(status_code=400, detail="Укажите наименование заказчика")

    executor_bin = (app_settings.hotel_bin or EXECUTOR_BIN_DEFAULT).strip()
    executor = ActParty(
        name=EXECUTOR_NAME,
        identifier_label="БИН",
        identifier=executor_bin,
        address=EXECUTOR_ADDRESS,
    )
    customer_iban = (payload.customer_iban or "").strip() or None
    customer = ActParty(
        name=customer_name,
        identifier_label=id_label,
        identifier=customer_id,
        address=payload.customer_address,
        iban=customer_iban,
    )

    return ActDocument(
        act_number=act_number,
        act_date=act_date,
        executor=executor,
        customer=customer,
        contract_number=payload.contract_number,
        line_items=line_items,
        total_quantity=total_quantity,
        total_amount=total,
        total_vat=total_vat,
        total_amount_words=_amount_to_words(total),
    )


@router.get("/template.xlsx")
def download_act_template(
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    buffer = build_act_template_workbook()
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="akt-shveitsariya-shablon.xlsx"'},
    )


@router.post("/export")
def export_act_excel(
    document: ActDocument,
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    buffer = build_act_workbook(document)
    filename = f"akt-{document.act_number}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/invoice")
def export_invoice_excel(
    document: ActDocument,
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    buffer = build_invoice_workbook(document)
    filename = f"schet-faktura-{document.act_number}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/payment-invoice")
def export_payment_invoice_excel(
    document: ActDocument,
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    buffer = build_payment_invoice_workbook(document)
    filename = f"schet-na-oplatu-{document.act_number}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
