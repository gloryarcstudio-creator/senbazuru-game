# Senbazuru — арт

## Стиль

- Японское оригами: фактурная бумага, сгибы, мягкие тени от складок, шнур мидзухики, бумажные фонари, облака в стиле укиё-э.
- Палитра: индиго `#17224d` (фон, текст), бумага `#f1ead8`, золото `#e9b63c`, киноварь `#d8402f`, небесный `#9fd0ff` (свечение линий в базе), бирюза `#74f2dc` (фриспины), сирень `#f0a6ff` (супербонус).
- Свет тёплый, сверху слева. Шрифты локальные, вшиты в `index.html` (`<style id="fonts">`), внешних хостов нет.
- В картинках нет текста, кроме впечатанного кодом WILD (`tools/wild_label.mjs`, шрифт игры) и табличек выигрыша.

## Ассеты в игре

| Папка | Файлы | Размер | Статус |
|---|---|---|---|
| `assets/symbols/` | H1–H4, L1–L4, W, S | 320×320 webp, прозрачный фон | финал (заказчик, v7) |
| `assets/anim/` | `<symbol>_win.webp` | лента 20 кадров 256×256 (5120×256) | временные: пульс и блик из статики (`import_art.py`) |
| `assets/anim/` | `S_land` (приземление скаттера), `anticipation` (подсветка колонны), `bigwin_bg` (лучи за табличкой) | ленты 24×256², 48×100×500, 36×256² | финал (заказчик, v13, из видео) |
| `assets/bg/` | `bg_land`, `bg_port` (+ `_s`), `decor_left/right` | 1920×1080, 1080×1920, 960×540, 540×960, 360×1080 | финал (v7) |
| `assets/bg/` | `bg_fs_*`, `bg_super_*`, `splash_bg_*` (land/port, + `_s`) | 1920×1080, 1080×1920, 960×540, 540×960 | финал (v13) |
| `assets/video/` | `bg_land/fs/super` (.webm + .mp4, петли фона, только десктоп) | 1280×720, ~250–480 КБ | финал (v13) |
| `assets/video/` | `trans_fs`, `trans_super`, `trans_end` (.webm VP9 с альфой; без поддержки — бумажная вспышка) | 1280×720, 2.6 МБ / 294 КБ / 17 КБ | финал (v13) |
| `assets/ui/` | `frame_base/fs/super` (рамка поля), `btn_spin`, `btn_round(_on)`, `btn_menu`, `btn_bonus`, `btn_ante_on`, `btn_close` (+ `_down`), `icons` (лист 4×4), `tag_value/win/fs` (бирки HUD, 9-slice), `hud_mult`, `plank`, `plank_body` (доски меню/правил, 9-slice), `splash_plank`, `toggle_on/off`, `logo`, `cloud_1..3`, `sun`, `sticky_cell`, `coin`, `coin_edge` | 256…1024 px webp | финал (v13) |
| `assets/ui/` | `mode_ante/bonus/super`, `paper` | 256×256, 512×512 (9-slice рамка) | финал (v7) |
| `assets/lines/` | `cord`, `knot`, `tip` | 1024×128, 256×256, 512×288 | финал (v13, мидзухики) |
| `assets/plaques/` | nice, big, mega, epic, max, total | ленты 30 кадров 512×192 (15360×192), 12 к/с | финал (v13, из видео) |
| `assets/intro/` | `studio.webm` + `studio.mp4` | 30 fps, без звука, 125 КБ / 73 КБ | финал (v10) |

Кнопки, бирки, рамки и доски — картинки заказчика (v13, `tools/import_part2.py`: зелёный фон → альфа, союз bbox для состояний, webp q84–88); состояния `_down` подменяют картинку целиком. Ленты из видео — `tools/chroma_strip.py` (кадр → хромакей → лента ≤ 16383 px). Живые фоны и переходы — `<video>`; на телефонах (LITE) и без VP9-альфы (Safari) не грузятся, вместо них статика и бумажная вспышка.

## Слои сцены

фон → гирлянды-декор → рамка поля (бумага, 9-slice) → барабаны (canvas) → линии и таблички → HUD → нижняя панель → полноэкранные оверлеи (Info, меню, ошибки, заставка).

## Осталось

- Видео `logo_loop` и `confetti` из поставки не используются: логотип качается CSS, конфетти рисует код.
- Импорт новой графики на `#00FF00`: `python3 tools/import_art.py <папка>` (символы) или `tools/import_part2.py <папка>` (UI), кадры — `tools/chroma_strip.py` (ленты ≤ 16383 px).

## Обложка Stake (Media Editor)

Редактор собирает обложку из 4 слоёв: **Background Image → Foreground Element → Gradient → Game Title** (+ подпись студии GLORYARC внизу, её ставит редактор). Форматы: **Tile 3:4** и **Wide 16:9**.

Правила редактора: фон показывает мир игры, без надписей и множителей, яркие насыщенные цвета. Главное — в Key Focus Area (верхние ~2/3 тайла); нижняя треть уходит под градиент и название, там спокойная зона.

Допущения:
- Размеры генерации: Tile **1536×2048**, Wide **2560×1440**; на загрузку уменьшать до требований редактора (точные пиксели редактор не показывает — сверить при загрузке).
- Прозрачность: генерировать на хромакее `#00FF00`, вырезать `tools/chroma_strip.py` (как остальная графика проекта) → PNG с альфой.
- Название «SENBAZURU» — единственный текст в картинках, только в слое логотипа.
- Главный герой обложки — красный журавль-оригами (символ H1 / суть названия: «тысяча журавликов»).

### 1. Background — Tile 3:4 (1536×2048)

```
Vertical 3:4 game cover background, origami paper world at night. Layered folded-paper mountains in rich cobalt and indigo blue with crisp crease lines and cream paper snow caps, deep indigo sky made of textured washi paper, a glowing pale-gold paper moon in the upper center. Strings of hundreds of tiny folded paper cranes in vermilion, gold and cream hanging from the top edge like garlands, softly out of focus. Golden seigaiha wave patterns folded into the lower hills, pink paper sakura blossoms drifting. Warm rim light from the upper left, visible paper fibers and folds, handcrafted papercraft diorama look, vibrant saturated colors, high contrast, clean center space for a hero character in the upper two thirds, calm darker lower third. No text, no letters, no numbers, no logos, no UI, no frames.
```

### 2. Background — Wide 16:9 (2560×1440)

```
Wide 16:9 game cover background, origami paper world at night. Panoramic range of folded-paper mountains in cobalt and indigo blue with sharp crease lines and cream paper snow caps on both sides, deep indigo washi-paper sky, a large glowing pale-gold paper moon slightly right of center. Long garlands of tiny folded paper cranes in vermilion, gold and cream hanging from the top edge, softly blurred. Golden seigaiha wave patterns folded into the foreground hills, pink paper sakura petals floating. Warm rim light from the upper left, papercraft diorama, visible paper texture, vibrant saturated colors, open space in the center for a hero character, calmer darker bottom band. No text, no letters, no numbers, no logos, no UI, no frames.
```

### 3. Foreground — герой, Tile 3:4 (1536×2048, хромакей)

```
A majestic vermilion red origami paper crane, hero character of a game cover, front three-quarter view, wings raised high in a dynamic upward flap, long neck and elegant head, folded from glossy red paper with subtle gold foil edges and cream paper inner wings, crisp visible creases and paper texture, warm key light from the upper left with soft golden rim light, a few small gold and cream paper cranes flying around it, three pink paper sakura blossoms near its feet. Composition fills the upper two thirds of a vertical frame, centered, nothing cropped. Isolated on a solid flat pure green #00FF00 background, no shadow on the background, no green reflections. No text, no letters, no numbers.
```

### 4. Foreground — герой, Wide 16:9 (2560×1440, хромакей)

```
A majestic vermilion red origami paper crane, hero character of a game cover, side three-quarter view in a wide gliding pose with wings spread fully horizontal, long neck stretched forward, folded from glossy red paper with subtle gold foil edges and cream paper inner wings, crisp visible creases and paper texture, warm key light from the upper left with soft golden rim light, a small flock of gold and cream paper cranes trailing behind. Composition centered in a wide frame, occupying the middle 60 percent, nothing cropped. Isolated on a solid flat pure green #00FF00 background, no shadow on the background, no green reflections. No text, no letters, no numbers.
```

### 5. Логотип «SENBAZURU» (2048×768, хромакей)

Если редактор позволяет загрузить слой Game Title картинкой — использовать этот логотип; иначе название набирается в редакторе, а логотип идёт в игру и на тайл/баннеры.

```
Game logo wordmark spelling exactly "SENBAZURU" in one line, bold rounded display letters made of folded cream washi paper with visible crease facets, thick vermilion red outline and a thin gold foil inner edge, slight 3D paper depth with soft drop shadow, a small red origami crane perched on top of the letter "Z" with wings spread, tiny pink sakura petal accents. Correct spelling S-E-N-B-A-Z-U-R-U, even letter spacing, highly legible at small size, front view, no perspective tilt. Isolated on a solid flat pure green #00FF00 background, no other text, no tagline, no subtitle.
```

Негатив (для моделей, где он есть): `text, watermark, signature, numbers, multiplier, UI, frame, border, blurry, extra letters, misspelled, green spill, cropped wings`.

### 6. Gradient (слой редактора)

Цвета не генерируются: в редакторе снизу вверх `#0E1640` (100 %) → `#1B2A6B` (60 %) → прозрачный. Запасной тёплый вариант: `#D8352A` → прозрачный.

### Порядок генерации

1. Один тест в минимальном качестве: Background Tile → проверить, нет ли текста и хватает ли пустой зоны.
2. Foreground Tile → вырезать хромакей, наложить на фон, проверить читаемость в маленьком тайле.
3. Wide-варианты и логотип; у логотипа проверить орфографию (до 3 попыток, потом — набрать название шрифтом и наложить журавля отдельно).

### Стиль и палитра для обложки (с экранов v13)

Стиль: бумажное оригами, японские мотивы. Индиго-ночь с горами из сложенной бумаги, золотые волны сэйгайха, сакура, красно-золотая рамка, кремовая васи-бумага, журавлики-гирлянды. Свет мягкий тёплый сверху-слева, бумага с видимыми сгибами и фактурой.

| Роль | Цвет |
|---|---|
| Индиго (фон, ночь) | `#1B2A6B`, тени `#0E1640` |
| Синий бумажных гор | `#2F4FA8` |
| Кремовая бумага | `#F4EAD5` |
| Вермильон (журавль, рамка) | `#D8352A` |
| Золото | `#E2B04A` |
| Сакура | `#F6C9D2` |
