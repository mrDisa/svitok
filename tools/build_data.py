"""Готовит данные приложения из RusSynodal.json (scrollmapper/bible_databases).

Запуск:  python3 tools/build_data.py путь/к/RusSynodal.json
Создаёт: data/books.json, data/bible/NN.json (по книге), data/feed.json
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from books import BOOKS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def clean(text: str) -> str:
    text = re.sub(r"<note>.*?</note>", "", text, flags=re.S)
    text = re.sub(r"<title[^>]*>.*?</title>", "", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace(" - ", " — ")
    text = re.sub(r'"([^"]*)"', r"«\1»", text)
    return re.sub(r"\s+", " ", text).strip()


def main(src: str) -> None:
    raw = json.load(open(src, encoding="utf-8"))
    by_key = {b["name"]: b for b in raw["books"]}

    books_meta = []
    bible = {}  # key -> list of chapters -> list of verse texts
    (DATA / "bible").mkdir(parents=True, exist_ok=True)

    for i, (key, name, short, ref) in enumerate(BOOKS):
        chapters = []
        for n, ch in enumerate(by_key[key]["chapters"], start=1):
            assert ch["chapter"] == n, (key, n)
            nums = [v["verse"] for v in ch["verses"]]
            assert nums == list(range(1, len(nums) + 1)), (key, n, nums[:5])
            chapters.append([clean(v["text"]) for v in ch["verses"]])
        bible[key] = chapters
        books_meta.append({"n": name, "s": short, "r": ref, "c": len(chapters),
                           "nt": i >= 39})
        out = DATA / "bible" / f"{i + 1:02d}.json"
        out.write_text(json.dumps({"n": name, "c": chapters}, ensure_ascii=False,
                                  separators=(",", ":")), encoding="utf-8")

    (DATA / "books.json").write_text(
        json.dumps(books_meta, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    index = {key: i for i, (key, *_r) in enumerate(BOOKS)}
    feed = []
    line_re = re.compile(r"^(\w+)\s*\|\s*(.+?)\s+(\d+):(\d+)(?:-(\d+))?$")
    for line in (ROOT / "tools" / "feed.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = line_re.match(line)
        assert m, line
        topic, key, c, v1, v2 = m.groups()
        c, v1 = int(c), int(v1)
        v2 = int(v2) if v2 else v1
        bi = index[key]
        verses = bible[key][c - 1][v1 - 1:v2]
        assert len(verses) == v2 - v1 + 1, line
        text = " ".join(verses)
        text = re.sub(r"^[Пп]салом Давида\.\s*", "", text)
        text = re.sub(r"\s*\[Начальнику хора\.\]$", "", text)
        text = re.sub(r"\s+Псалом Давида\.[^.!?]*\.?$", "", text)
        text = re.sub(r"[\s,;:—-]+$", "…", text)
        text = text[0].upper() + text[1:]
        ref = BOOKS[bi][3] + f" {c}:{v1}" + (f"–{v2}" if v2 != v1 else "")
        feed.append({"id": f"{bi + 1}.{c}.{v1}", "t": topic, "r": ref,
                     "b": bi, "c": c, "v": [v1, v2], "x": text})

    (DATA / "feed.json").write_text(
        json.dumps(feed, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"books: {len(books_meta)}, feed verses: {len(feed)}")


if __name__ == "__main__":
    main(sys.argv[1])
