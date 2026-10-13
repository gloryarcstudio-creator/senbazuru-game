# Senbazuru — ART

Стиль: бумажное оригами, японские мотивы. Индиго-ночь с горами из сложенной бумаги, золотые волны сэйгайха, сакура, красно-золотая рамка, кремовая васи-бумага, журавлики-гирлянды. Свет мягкий тёплый сверху-слева, бумага с видимыми сгибами и фактурой.

Палитра (с экранов v13):

| Роль | Цвет |
|---|---|
| Индиго (фон, ночь) | `#1B2A6B`, тени `#0E1640` |
| Синий бумажных гор | `#2F4FA8` |
| Кремовая бумага | `#F4EAD5` |
| Вермильон (журавль, рамка) | `#D8352A` |
| Золото | `#E2B04A` |
| Сакура | `#F6C9D2` |

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

## Анимации символов на поле (v16)

Каждый символ, пока его барабан стоит, живёт своей короткой петлёй. Всё сделано кодом из статичных `assets/symbols/*.webp` (трансформации, деформация полосками, блик по альфе символа через canvas `source-in`, мелкие частицы), без новой графики, без CSS `filter`. Код — `IDLE_FX` в `index.html`.

| Символ | Постоянное движение | Акцент (раз в N с) |
|---|---|---|
| L1 кораблик | качка на волне вокруг днища, расходящиеся круги | — |
| L2 вертушка | дрожит на ветру ±3° | порыв: полный оборот, 6,2 с |
| L3 звезда | «дыхание» ±2,5 % | золотой блик + искры на кончиках лучей, 4,6 с |
| L4 веер | мягкое обмахивание вокруг ручки | двойной взмах, слетают два лепестка сакуры, 5,4 с |
| H4 бабочка | парит вверх-вниз | два взмаха крыльями, 3,2 с |
| H3 карп | тело изгибается волной (хвост сильнее), пузырьки изо рта | — |
| H2 лиса | дыхание, покачивание хвоста | взмах хвостом + золотые искры, 6 с |
| H1 журавль | парит, крылья поднимаются и опускаются | тёплый блик по бумаге, 5,2 с |
| W вайлд | пульс лучей, искры над лучами | блик по золоту, 3,6 с |
| S фонарь | тёплый свет пульсирует, качается на петле | вздрагивание свечи, 4,4 с |

Правила:

- одинаковые символы на поле двигаются синхронно, включая липкие вайлды (фаза зависит только от символа); у разных символов фазы разные, чтобы поле не двигалось одним целым;
- после остановки барабана амплитуда набирается за 0,45 с, перед стартом вращения гаснет за 0,15 с — без рывков; акценты включаются только на полной амплитуде;
- липкие вайлды во фриспинах анимируются после «пружины» появления;
- выигрышные клетки по-прежнему играют ленты `assets/anim/*_win.webp`, скаттер при приземлении — `S_land.webp`;
- поле перерисовывается 30 к/с, на скрытой вкладке не рисуется; `prefers-reduced-motion` или `?idle=0` отключают анимации;
- всё рисуется внутри canvas поля, поэтому ни на одном экране не перекрывает HUD и панель.

## Анимации рамки и фона (v18)

Всё кодом, без новой графики и без CSS `filter`. Код — `SCENE`, `updateBgFx`, `updateFrameFx` в `index.html`; гирлянды — CSS `@keyframes garland`.

| Где | Что происходит | Когда |
|---|---|---|
| Рамка | золотая искра пробегает по периметру за 2,6 с, в углах по очереди вспыхивают искры | раз в 8 с |
| Рамка | две золотые искры бегут по периметру без пауз | пока показывается выигрыш |
| Рамка | вся рамка мягко пульсирует золотом | пока барабан крутится в ожидании скаттера |
| Фон, базовый режим | бумажные лепестки сакуры (сложены пополам: две половины разного тона, кувыркаются) | всегда |
| Фон, базовый режим | белые бумажные журавлики пролетают по небу, иногда парой | раз в 9–16 с, только когда не играет фон-видео (в нём свои журавли): портрет, телефоны |
| Фон, фриспины | тёплые светлячки поднимаются от фонарей и мерцают | всегда |
| Фон, супербонус | падают кусочки золотой фольги с бликом | всегда |
| Гирлянды по краям | качаются вокруг верхнего края ±0,6°, правая — в своём ритме | всегда (только десктоп, где они есть) |

Правила:

- свет на рамке маскируется плотной частью картинки рамки (альфа > 180), поэтому не заходит на поле;
- слой фона (`#bgFx`) лежит под гирляндами, логотипом, полем и панелью, интерфейс не перекрывает;
- 30 к/с, на скрытой вкладке не рисуется; на телефонах частиц на 40 % меньше и разрешение холста ниже;
- `prefers-reduced-motion` или `?idle=0` отключают и анимации символов, и рамку с фоном.
