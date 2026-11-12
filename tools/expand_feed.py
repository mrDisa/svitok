"""Расширяет редакторскую ленту тематическими стихами из локального текста Библии.

Основная подборка из tools/feed.txt остаётся без изменений. Этот скрипт дополняет
data/feed.json короткими одиночными стихами, в которых тема выражена явно.

Запуск: python3 tools/expand_feed.py
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(Path(__file__).parent))
from books import BOOKS  # noqa: E402

TARGET_PER_TOPIC = 100
MIN_LENGTH = 35
MAX_LENGTH = 390

# Регулярные выражения намеренно узкие: это не богословский классификатор, а
# воспроизводимый первый отбор для последующей редакторской вычитки.
TOPIC_PATTERNS = {
    "hope": (r"\bнадежд", r"\bупова", r"ожида"),
    "anxiety": (r"не бойся", r"не страш", r"не ужас", r"не смущ", r"забот", r"тревог", r"страх"),
    "peace": (r"мир бож", r"мир мой", r"мир вам", r"оставляю вам мир", r"покой", r"спокойн", r"тишин", r"примир"),
    "love": (r"любов",),
    "strength": (r"\bсил[ауыеой]\b", r"укреп", r"крепост", r"мужай", r"поддерж"),
    "comfort": (r"утеш", r"исцеляет", r"отрет.*слез", r"плач.*радост"),
    "thanks": (r"благодар", r"слав.*господ", r"хвал.*господ", r"возраду.*господ", r"весели.*господ"),
    "wisdom": (r"мудр", r"настав", r"совет"),
    "forgiveness": (r"прощ", r"очист.*грех", r"грех.*не воспомян", r"покаян"),
    "faith": (r"\bверою\b", r"\bвере\b", r"\bверы\b", r"\bверу\b", r"веруй", r"верьте", r"верующ", r"уверовал"),
    "prayer": (r"молит", r"молите", r"просите", r"взыск", r"воззов", r"вопи", r"призыва"),
    "jesus": (r"иисус христос", r"христос иисус", r"господь иисус", r"сын человеческий"),
}

# Дидактические, поэтические и пророческие книги дают подходящий ленте
# контекст; исторические повествования не попадают в автоматическое расширение.
CURATED_BOOKS = {
    18, 19, 21, 22, 23, 24, 26, 31, 32, 34, 37, 38,
    *range(39, 66),
}

EXCLUDED_BY_TOPIC = {
    "hope": (r"надежд[а-яё]*.*(?:погиб|исчез|уничтож)", r"нет надежды"),
    "peace": (r"непримир", r"не войдут в покой", r"гнев.*покой"),
    "faith": (r"невер", r"не вер"),
}


def clean(text: str) -> str:
    text = re.sub(r"^[Пп]салом Давида\.\s*", "", text)
    text = re.sub(r"\s*\[Начальнику хора\.\]$", "", text)
    return text.strip()


def score(text: str, patterns: tuple[str, ...]) -> int:
    lowered = text.lower()
    return sum(bool(re.search(pattern, lowered)) for pattern in patterns)


def is_allowed(topic: str, text: str, book_index: int) -> bool:
    lowered = text.lower()
    if any(re.search(pattern, lowered) for pattern in EXCLUDED_BY_TOPIC.get(topic, ())):
        return False
    # «Иисус» в Ветхом Завете — это Иисус Навин, а не слова Христа.
    return topic != "jesus" or book_index >= 39


def editorial_feed(books: list[dict]) -> list[dict]:
    """Собирает исходные 178 редакторских карточек из их единственного источника."""
    by_key = {key: index for index, (key, *_rest) in enumerate(BOOKS)}
    verse_data = {}
    for book_index in range(len(books)):
        payload = json.loads((DATA / "bible" / f"{book_index + 1:02d}.json").read_text(encoding="utf-8"))
        verse_data[book_index] = payload["c"]

    items = []
    line_re = re.compile(r"^(\w+)\s*\|\s*(.+?)\s+(\d+):(\d+)(?:-(\d+))?$")
    for line in (ROOT / "tools" / "feed.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = line_re.match(line)
        assert match, line
        topic, key, chapter, first, last = match.groups()
        chapter, first = int(chapter), int(first)
        last = int(last) if last else first
        book_index = by_key[key]
        text = " ".join(verse_data[book_index][chapter - 1][first - 1:last])
        text = clean(text)
        text = re.sub(r"\s+Псалом Давида\.[^.!?]*\.?$", "", text)
        text = re.sub(r"[\s,;:—-]+$", "…", text)
        text = text[0].upper() + text[1:]
        reference = books[book_index]["r"] + f" {chapter}:{first}" + (f"–{last}" if last != first else "")
        items.append({"id": f"{book_index + 1}.{chapter}.{first}", "t": topic, "r": reference,
                      "b": book_index, "c": chapter, "v": [first, last], "x": text})
    return items


def main() -> None:
    feed_path = DATA / "feed.json"
    books = json.loads((DATA / "books.json").read_text(encoding="utf-8"))
    feed = editorial_feed(books)
    present = {item["id"] for item in feed}
    counts = Counter(item["t"] for item in feed)
    candidates = defaultdict(list)

    for book_index, book in enumerate(books):
        if book_index not in CURATED_BOOKS:
            continue
        payload = json.loads((DATA / "bible" / f"{book_index + 1:02d}.json").read_text(encoding="utf-8"))
        for chapter_index, chapter in enumerate(payload["c"], start=1):
            for verse_index, raw_text in enumerate(chapter, start=1):
                text = clean(raw_text)
                if not MIN_LENGTH <= len(text) <= MAX_LENGTH:
                    continue
                verse_id = f"{book_index + 1}.{chapter_index}.{verse_index}"
                if verse_id in present:
                    continue
                scores = {topic: score(text, patterns) for topic, patterns in TOPIC_PATTERNS.items()}
                for topic, topic_score in scores.items():
                    if topic_score and is_allowed(topic, text, book_index):
                        candidates[topic].append((topic_score, book_index, chapter_index, verse_index, text))

    added = []
    used = set(present)
    for topic in TOPIC_PATTERNS:
        entries = candidates[topic]
        needed = max(0, TARGET_PER_TOPIC - counts[topic])
        # Сначала сильные лексические совпадения, затем порядок канона — так
        # результат стабилен между запусками и легко проверяется в диффе.
        entries.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))
        for _, book_index, chapter, verse, text in entries:
            verse_id = f"{book_index + 1}.{chapter}.{verse}"
            if verse_id in used:
                continue
            ref = books[book_index]["r"] + f" {chapter}:{verse}"
            added.append({
                "id": verse_id,
                "t": topic,
                "r": ref,
                "b": book_index,
                "c": chapter,
                "v": [verse, verse],
                "x": text,
            })
            used.add(verse_id)
            if len([item for item in added if item["t"] == topic]) == needed:
                break

    # Группировка по теме сохраняет читаемый и стабильный порядок исходной базы.
    order = list(TOPIC_PATTERNS)
    combined = feed + added
    combined.sort(key=lambda item: (order.index(item["t"]), item["id"] not in present, item["id"]))
    feed_path.write_text(json.dumps(combined, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    result_counts = Counter(item["t"] for item in combined)
    print(f"feed verses: {len(combined)}")
    print(" ".join(f"{topic}={result_counts[topic]}" for topic in order))


if __name__ == "__main__":
    main()
