from __future__ import annotations

from base64 import b64decode
from contextlib import closing
from functools import lru_cache
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from threading import Lock
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener, urlopen

from agent.cognitive_json_store import ensure_json_schema, load_json, store_json


ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("WENSHENG_DATA_DIR") or
            Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Wensheng")
WIKI = "https://zh.wikipedia.org"
USER_AGENT = "WenshengDesktop/1.0 (interactive Wikipedia search)"
MAX_AUDIO = 2_000_000


class History:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with closing(self.connect()) as db, db:
            ensure_json_schema(db)
            db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def snapshot(self):
        with closing(self.connect()) as db:
            rows = db.execute("SELECT body FROM messages ORDER BY id DESC LIMIT 60").fetchall()
            facts = dict(db.execute("SELECT key, value FROM memory"))
            return {"messages": [load_json(db, row[0]) for row in reversed(rows)], "facts": facts}

    def append(self, question, reply, facts):
        with closing(self.connect()) as db, db:
            for message in ({"role": "user", "text": question}, reply):
                encoded = json.dumps(message, ensure_ascii=False)
                db.execute("INSERT INTO messages(body) VALUES (?)",
                           (store_json(db, message, encoded=encoded),))
            db.executemany("INSERT OR REPLACE INTO memory VALUES (?, ?)", facts.items())

    def clear(self):
        with closing(self.connect()) as db, db:
            db.execute("DELETE FROM messages")
            db.execute("DELETE FROM memory")
            db.execute("DELETE FROM cognitive_json_sections")


def keywords(text, topic):
    text = re.sub(r"[？?！!。]+$", "", text).strip()
    followup = re.match(r"^(?:那(?:麼)?[，、 ]*)?(?:它|他|她|這個|這種|上述|那個|那種)(.*)", text)
    if topic and followup:
        return f"{topic} {followup[1]}".strip()
    if topic and re.match(r"^(再說|多說|詳細|更多|繼續)", text):
        return topic
    if topic and re.match(r"^(那)?(為什麼|有多高|什麼時候|在哪裡|怎麼形成)", text):
        return f"{topic} {text.removeprefix('那')}"
    text = re.sub(r"^(請問|請告訴我|幫我查(?:一下)?|什麼是)\s*", "", text)
    return re.sub(r"(?:是什麼(?:意思)?|有多高|是誰|是在哪裡)$", "", text).strip()


def wiki_search(query):
    if not query:
        return []
    params = urlencode({
        "action": "query", "generator": "search", "gsrsearch": query,
        "gsrnamespace": 0, "gsrlimit": 4, "prop": "extracts|pageprops",
        "ppprop": "disambiguation", "exintro": 1, "explaintext": 1,
        "exlimit": "max", "exchars": 850, "variant": "zh-tw",
        "converttitles": 1, "format": "json", "formatversion": 2,
    })
    request = Request(WIKI + "/w/api.php?" + params, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=12) as response:
        result = json.load(response)
    if result.get("error"):
        raise OSError("Wikipedia search failed")
    pages = [page for page in result.get("query", {}).get("pages", [])
             if page.get("extract", "").strip()]
    return sorted(pages, key=lambda page: ("disambiguation" in page.get("pageprops", {}),
                                           page.get("index", 99)))


def decode_recording(audio):
    import av
    import numpy as np

    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    count = 0
    with av.open(audio, mode="r") as container:
        if not container.streams.audio:
            raise ValueError("Missing audio stream")
        for frame in container.decode(audio=0):
            frame.pts = None
            for chunk in resampler.resample(frame):
                chunks.append(chunk.to_ndarray().reshape(-1))
                count += chunk.samples
            if count > 320000:
                raise ValueError("Audio exceeds 20 seconds")
    for chunk in resampler.resample(None):
        chunks.append(chunk.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("No audio samples")
    return np.concatenate(chunks).astype(np.float32) / 32768


class Assistant:
    def __init__(self, history):
        self.history = history
        self.turn_lock = Lock()
        self.speech_lock = Lock()
        from opencc import OpenCC

        self.recognizer = None
        self.to_traditional = OpenCC("s2twp")

    def ask(self, question, use_search):
        question = str(question).strip()[:300]
        if not question:
            return {"error": "請輸入問題。"}
        with self.turn_lock:
            snapshot = self.history.snapshot()
            previous = snapshot["facts"]
            updates = {}
            pages = []
            warning = ""
            text = ""
            remember = re.match(r"^(?:請\s*)?(?:幫我\s*)?記住[：:，,\s]*(.+)", question)
            if remember:
                note = remember[1].strip()
                updates["note"] = note
                text = f"我記住了：{note}"
            elif re.search(r"記得什麼|記住什麼|我的備註|我叫什麼|我之前說", question):
                note = previous.get("note")
                topic = previous.get("topic")
                if note:
                    text = f"你上次請我記住：{note}"
                elif topic:
                    text = f"我們上次查了「{topic}」。"
                else:
                    text = "目前還沒有備註。你可以說「記住：我喜歡看科幻小說」。"
            elif question.rstrip("！!?？。") in {"你好", "嗨", "哈囉", "早安", "晚安", "謝謝", "謝謝你"}:
                text = "你好，想聊聊或查點什麼？" if "謝謝" not in question else "不客氣！"
            else:
                if use_search:
                    topic = previous.get("topic", "")
                    query = keywords(question, topic)
                    try:
                        pages = wiki_search(query)
                        if not pages and topic and query.startswith(topic + " "):
                            pages = wiki_search(topic)
                    except (OSError, ValueError):
                        warning = "目前無法連線到維基百科。"
                    if pages:
                        updates["topic"] = pages[0]["title"]
                if not text:
                    if pages:
                        first = pages[0]
                        text = f'《{first["title"]}》\n{first["extract"].strip()}'
                    elif warning:
                        text, warning = warning, ""
                    elif use_search:
                        text = "找不到相關的維基百科條目。可以用簡短的人名、地名或關鍵字試試。"
                    else:
                        text = "你可以打開「查維基百科」繼續找資料，或設定 Ollama 來進行一般對話。"
            reply = {"role": "assistant", "text": text,
                     "sources": [{"title": p["title"], "pageid": p["pageid"]} for p in pages]}
            self.history.append(question, reply, updates)
            return {"reply": reply, "warning": warning}

    def transcribe(self, encoded):
        if not isinstance(encoded, str) or len(encoded) > MAX_AUDIO:
            return {"error": "錄音過長，請用較短的句子再試。"}
        try:
            audio = decode_recording(BytesIO(b64decode(encoded, validate=True)))
            with self.speech_lock:
                if self.recognizer is None:
                    from faster_whisper import WhisperModel
                    self.recognizer = WhisperModel(str(ROOT / ".runtime-assets" / "whisper-tiny"), device="cpu",
                                                   compute_type="int8", local_files_only=True)
                segments, _ = self.recognizer.transcribe(audio, language="zh", beam_size=1,
                                                         vad_filter=True,
                                                         initial_prompt="請輸出繁體中文。")
                text = self.to_traditional.convert("".join(segment.text for segment in segments)).strip()[:300]
            return {"text": text} if text else {"error": "沒有聽到清楚的語音，請再試一次。"}
        except Exception:
            return {"error": "本機語音辨識啟動失敗，請再試一次或改用文字。"}



@lru_cache(maxsize=1)
def local_assistant():
    return Assistant(History(DATA / "history.sqlite3"))


def local_reply(question, allow_search):
    text = str(question).strip()
    if not text:
        return None
    wants_lookup = bool(re.search(
        r'查|搜尋|搜索|[?？]|什麼|什么|怎麼|怎么|如何|為什麼|为什么|哪裡|哪里|有多|是誰|是谁',
        text
    ))
    wants_memory = bool(re.search(r'記住|记住|記得|记得|我之前說|我的備註', text))
    if not wants_memory and not (allow_search and wants_lookup):
        return None
    translated = text.replace("记住", "記住").replace("记得", "記得")
    response = local_assistant().ask(translated, bool(allow_search))
    message = response.get("reply")
    if not message:
        return None
    result = {"reply": message["text"], "source": "local",
              "emotion": "focused", "gesture": "explain"}
    if message.get("sources"):
        top = message["sources"][0]
        result["reply"] += f"\n\n來源：{WIKI}/?curid={top['pageid']}"
        result["spokenTextJa"] = "調べた資料を表示するわ。出典も確認してね。"
    elif wants_memory:
        result["spokenTextJa"] = "分かったわ。記憶を確認してね。"
    return result


def transcribe(body):
    return local_assistant().transcribe(body.get("audio"))
