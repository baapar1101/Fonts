
#!/usr/bin/env python3
"""
FontiranIR bot -> download every archive on every page.

The bot uses a REPLY keyboard, so each "button" is just a text message you
send back. Page navigation works the same way ("صفحه 3 ➡").

Setup
-----
    pip install telethon
    export TG_API_ID=1234567
    export TG_API_HASH=abcdef...

Run
---
    python fontiran_downloader.py            # start from page 1
    python fontiran_downloader.py 5          # resume from page 5

State is kept in state.json, so re-running skips whatever is already done.
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from telethon.tl.custom import Message
from telethon.tl.types import ReplyKeyboardMarkup

API_ID = int(28823082)
API_HASH = "01fa1642c93d74c9d1e9a367b8bcc827"

BOT = "@Fontpolybot"
OUT_DIR = Path("fonts")
STATE_FILE = Path("state.json")
SESSION = "font_session"

ARCHIVE_EXT = {".rar", ".zip", ".7z", ".tar", ".gz"}

REPLY_WAIT = 6.0        # max seconds to wait for the bot's answer
QUIET_TIME = 1.5        # stop waiting after this long with no new message
PAUSE_BETWEEN = 2.0     # pause after each font (keep the bot happy)
MAX_PAGES = 200

PAGE_RE = re.compile(r"صفحه\s*([۰-۹0-9]+)")
FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")

client = TelegramClient(SESSION, API_ID, API_HASH)
inbox: "asyncio.Queue[Message]" = asyncio.Queue()


# --------------------------------------------------------------------------- #
# state
# --------------------------------------------------------------------------- #
def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"done_fonts": [], "done_pages": []}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8"
    )


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def page_number(text: str):
    m = PAGE_RE.search(text)
    return int(m.group(1).translate(FA_DIGITS)) if m else None


def file_name(msg: Message):
    if not msg.document:
        return None
    for attr in msg.document.attributes:
        name = getattr(attr, "file_name", None)
        if name:
            return name
    return None


def is_archive(msg: Message) -> bool:
    name = file_name(msg)
    return bool(name) and Path(name).suffix.lower() in ARCHIVE_EXT


async def keyboard() -> list[str]:
    """Flat list of the current reply-keyboard button labels."""
    async for m in client.iter_messages(BOT, limit=30):
        if isinstance(m.reply_markup, ReplyKeyboardMarkup):
            return [b.text for row in m.reply_markup.rows for b in row.buttons]
    return []


async def send(text: str) -> list[Message]:
    """Send a button label and collect everything the bot sends back."""
    while True:
        try:
            await client.send_message(BOT, text)
            break
        except FloodWaitError as e:
            print(f"    flood wait {e.seconds}s")
            await asyncio.sleep(e.seconds + 1)

    got: list[Message] = []
    deadline = asyncio.get_event_loop().time() + REPLY_WAIT
    while asyncio.get_event_loop().time() < deadline:
        try:
            msg = await asyncio.wait_for(inbox.get(), timeout=QUIET_TIME)
        except asyncio.TimeoutError:
            if got:
                break
            continue
        got.append(msg)
    return got


async def download(msg: Message) -> bool:
    name = file_name(msg) or f"{msg.id}.bin"
    safe = re.sub(r"[^\w\-. ()\u0600-\u06FF]", "_", name).strip()
    path = OUT_DIR / safe
    if path.exists() and path.stat().st_size > 0:
        print(f"    skip (exists) {safe}")
        return False
    while True:
        try:
            await client.download_media(msg, file=str(path))
            size = path.stat().st_size / 1024 / 1024
            print(f"    ✓ {safe}  ({size:.1f} MB)")
            return True
        except FloodWaitError as e:
            print(f"    flood wait {e.seconds}s")
            await asyncio.sleep(e.seconds + 1)


# --------------------------------------------------------------------------- #
# main crawl
# --------------------------------------------------------------------------- #
async def crawl(start_page: int) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    state = load_state()
    done_fonts = set(state["done_fonts"])
    total = 0

    @client.on(events.NewMessage(from_users=BOT))
    async def _(event):
        await inbox.put(event.message)

    await send("/start")

    if start_page > 1:
        print(f"jumping to page {start_page}")
        await send(f"صفحه {start_page}")

    page = start_page
    seen_pages: set[int] = set()

    while page not in seen_pages and len(seen_pages) < MAX_PAGES:
        seen_pages.add(page)
        buttons = await keyboard()
        if not buttons:
            print("no keyboard found — stopping")
            break

        fonts = [b for b in buttons if page_number(b) is None]
        nav = {page_number(b): b for b in buttons if page_number(b) is not None}

        print(f"\n=== page {page} — {len(fonts)} font(s) ===")

        for label in fonts:
            key = f"{page}|{label}"
            if key in done_fonts:
                continue
            print(f"  → {label}")
            for msg in await send(label):
                if is_archive(msg):
                    if await download(msg):
                        total += 1
            done_fonts.add(key)
            state["done_fonts"] = sorted(done_fonts)
            save_state(state)
            await asyncio.sleep(PAUSE_BETWEEN)

        state["done_pages"] = sorted(set(state["done_pages"]) | {page})
        save_state(state)

        # move forward: the nav button whose number is higher than current page
        nxt = min((n for n in nav if n > page), default=None)
        if nxt is None:
            print("\nno next page — reached the end")
            break
        print(f"  ... going to page {nxt}")
        await send(nav[nxt])
        page = nxt

    print(f"\nfinished. {total} new archive(s) in {OUT_DIR.resolve()}")


async def main() -> None:
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    async with client:
        await crawl(start)


if __name__ == "__main__":
    asyncio.run(main())