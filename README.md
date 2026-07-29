# Hotel CRM «Швейцария»

Офлайн desktop CRM для отеля **Швейцария** (г. Текели, Казахстан).

## Стек

- **Backend:** Python, FastAPI, SQLite
- **Frontend:** React, Vite, TypeScript, Tailwind CSS
- **Desktop (позже):** Electron

## Быстрый старт (dev)

> **Важно:** команды запускайте из папки `crm`, не из `azure-concierge-ai`.
>
> Если `npm: command not found`, сначала загрузите Node:
> ```bash
> export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
> ```
> Или используйте скрипт: `./scripts/run.sh npm run electron:dev`

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте http://localhost:5173

При первом запуске пройдите **мастер настройки**: пароль, название отеля, номера.

## Данные

SQLite файл: `data/hotel_crm.db`  
Бэкапы: `data/backups/`

## Функции MVP

- Журнал заселений (главный экран)
- Клиентская база с ИИН, телефоном, возрастом
- Клик по ФИО → карточка клиента
- Номера и статусы
- Автоблокировка, бэкап/восстановление
- Офлайн, все данные локально

## Electron

```bash
cd /Users/amina/Desktop/project/crm

# Загрузить Node (nvm) — один раз в терминале
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"

# Установить зависимости (если ещё не делали)
npm run install:all

# Desktop: backend + frontend + окно Electron
npm run electron:dev
```

Сборка `.dmg` (macOS):

```bash
npm run electron:build
```

Альтернатива без ручного nvm:

```bash
./scripts/run.sh npm run electron:dev
```

## Отель

| Параметр | Значение |
|----------|----------|
| Название | Швейцария |
| Город | Текели, KZ |
| Валюта | KZT (₸) |
| Timezone | Asia/Almaty |
