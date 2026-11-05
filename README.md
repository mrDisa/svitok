# Свиток

Бесплатное веб-приложение: стихи Библии (Синодальный перевод) в формате ленты.
Ставится на iPhone через Safari → «Поделиться» → «На экран „Домой“» и работает без интернета.

- `index.html`, `styles.css`, `app.js` — лендинг и приложение
- `sw.js` — офлайн-кэш (при обновлении сайта увеличить `VERSION`)
- `data/` — текст Библии и подборка стихов для ленты
- `tools/build_data.py` — сборка `data/` из RusSynodal.json (scrollmapper/bible_databases); стихи ленты в `tools/feed.txt`

Локально: `python3 -m http.server 8321`
