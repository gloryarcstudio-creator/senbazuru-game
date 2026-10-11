# Senbazuru — промпты для звуков и музыки

9 октября 2026

## Как пользоваться

Здесь 43 промпта: 4 музыкальные дорожки и 39 эффектов. Все в одном стиле и одной тональности, чтобы выигрыши звучали в лад с музыкой. Сейчас эффекты в игре синтезирует код, а музыка — одна временная дорожка на 27 секунд; эти файлы их заменят.

1. Музыку вставляйте в генератор музыки (Suno, Udio, Stable Audio) в режиме без вокала. Эффекты — в генератор звуковых эффектов (ElevenLabs Sound Effects, Stable Audio).
2. Промпты на английском: так генераторы понимают их точнее. К каждому промпту добавляйте общий хвост из раздела «Общий стиль» — отдельный для музыки и для эффектов.
3. Длительность ставьте из подписи к промпту. Делайте 3–4 варианта и берите самый короткий и «сухой».
4. Назовите файлы как в подписях и пришлите одним zip. Формат любой, лучше WAV. Обрезку тишины, выравнивание громкости, бесшовные петли и перевод в mp3 сделаю я.

Что отбраковывать при выборе: голос или слова, музыка под эффектом, длинный хвост реверберации, тишина в начале файла, звон монет.

Если времени мало, начните с файлов с пометкой «основной» в сводной таблице в конце — их 21. Остальные можно дослать позже: пока файла нет, игра оставит синтезированный звук.

## Общий стиль

Всё звучит как мир из бумаги: шорохи и сгибы листа плюс японские народные инструменты.

- **Палитра:** бумага (шорох, сгиб, хлопок листа), кото, сямисэн, флейта сякухати, малые барабаны тайко, стеклянный колокольчик фурин, бамбук, деревянная колодка, храмовая чаша рин, гонг.
- **Тональность:** ре мажорная пентатоника (D E G A B) — в ней же сейчас звучат выигрыши в игре.
- **Темп:** базовая игра 84 BPM, фриспины 112 BPM, супер-фриспины 126 BPM.
- **Без этого:** монеты и кассовые звуки, синтезаторы и 8-bit, голоса, электрогитары, типовые «казино»-джинглы.

Хвост для каждого промпта **музыки**:

```text
Instrumental only, no vocals, no spoken words. Traditional Japanese instruments: koto, shamisen, shakuhachi flute, small taiko drums, glass wind chimes, soft paper-rustle percussion. Key of D major pentatonic (D E G A B). Seamless loop: steady tempo, no intro, no fade-out, the ending flows straight back into the beginning. Clean, warm, modern game-soundtrack mix. No synthesizers, no electric guitar, no drum machine.
```

Хвост для каждого промпта **эффекта**:

```text
Single isolated sound effect for a game. No music bed, no voice, no ambience, no coins. Handmade origami paper world with Japanese folk instruments. Warm, organic, close and dry recording, very short natural decay. Starts instantly with no silence before the sound. Any pitched notes are in D major pentatonic (D E G A B).
```

## Музыка

Четыре петли на одной мелодической теме: чем важнее момент, тем быстрее темп и плотнее барабаны. Если генератор умеет продолжать или переделывать готовый трек, сделайте сначала `music_base`, а остальные три — как его вариации.

**`music_base`** — базовая игра, играет постоянно · петля 60–90 с

```text
Calm, meditative Japanese folk instrumental, 84 BPM. A gentle koto plays a simple, memorable pentatonic melody; a breathy shakuhachi flute answers with long soft phrases; sparse shamisen plucks; light percussion made of paper rustles and a soft woodblock; occasional glass wind chime. Peaceful paper-craft workshop at dawn, cranes folded from paper hanging on strings. Unobtrusive background music for a slot game that can loop for a long time without becoming tiring. Low dynamics, no big climaxes, no heavy drums.
```

**`music_fs`** — фриспины · петля 45–60 с

```text
Energetic Japanese festival instrumental, 112 BPM. The same simple pentatonic koto melody as a calm theme, now played faster and brighter with driving shamisen strumming, a steady small taiko groove with rim clicks, lively shakuhachi flourishes and bright glass chimes on the accents. Excited, hopeful, forward-moving bonus-round music for a slot game. Paper lanterns glowing at a night festival. Medium-high energy that stays constant so it loops cleanly.
```

**`music_super`** — супер-фриспины · петля 45–60 с

```text
Intense, triumphant Japanese festival instrumental, 126 BPM. Powerful taiko ensemble with big low drums and fast shime-daiko patterns, aggressive shamisen riff, soaring shakuhachi lead, koto arpeggios racing upward, small hand cymbals on the off-beats. Golden paper cranes in flight, the peak moment of the game. High energy from the first bar, heroic and bright rather than dark, constant intensity so it loops cleanly.
```

**`music_bigwin`** — под плашкой Big / Mega / Epic win, пока считается сумма · петля 20–30 с

```text
Joyful celebration loop, Japanese festival style, 126 BPM. Fast rising koto arpeggios, bright glass chimes and small bells ringing continuously, rolling taiko drums building excitement, cheerful shamisen strumming, short shakuhachi trills. Sounds like a shower of paper confetti and a counter racing upward. Pure celebration, bright and sparkling, constant high energy, no melody that needs to resolve, so it can be cut at any moment.
```

## Барабаны и символы

Одиннадцать звуков вращения: они звучат чаще всех, поэтому должны быть короткими и ненавязчивыми. Остановка барабана — один файл: игра сама слегка повышает его тон от первого барабана к пятому.

**`spin_start`** — нажатие спина, барабаны трогаются · 0.4 с

```text
A quick soft whoosh of a large sheet of paper being swept through the air, rising in pitch, ending abruptly. Light and airy, like a paper fan opening fast.
```

**`reel_spin_loop`** — пока барабаны крутятся · петля 2 с

```text
A steady, even fluttering of many paper pages flipping very fast, like a thick stack of paper cards riffling continuously. Constant speed and volume from start to end, no accents, soft and quiet, seamless loop.
```

**`reel_stop`** — остановка одного барабана · 0.2 с

```text
A short, soft thud of a folded paper block landing on a wooden table, with a tiny hollow bamboo knock on top. Tight and muted, one single hit, no ring.
```

**`scatter_land_1`** — выпал первый скаттер (бумажный фонарь) · 0.6 с

```text
A paper lantern lights up: a soft paper pop followed by one clear glass wind-chime note on D, gentle and short. Curious, inviting.
```

**`scatter_land_2`** — второй скаттер · 0.7 с

```text
A paper lantern lights up: a soft paper pop followed by two rising glass wind-chime notes, D then G, a little brighter and louder than a single chime. Growing anticipation.
```

**`scatter_land_3`** — третий скаттер, бонус обеспечен · 0.9 с

```text
A paper lantern bursts into light: a firm paper pop followed by three fast rising glass wind-chime notes, D, G, high D, the last one ringing with a small bright bell. Excited, a clear signal that something big is about to start.
```

**`wild_land`** — выпал вайлд · 0.6 с

```text
A crisp snap of stiff golden paper being folded sharply, immediately followed by a quick upward koto glissando of five notes. Bright, proud, a little magical.
```

**`mult_x2`** — на вайлде показан множитель ×2 · 0.4 с

```text
A rubber ink stamp pressed onto paper, then one short bright koto pluck on D. Small and neat.
```

**`mult_x3`** — множитель ×3 · 0.45 с

```text
A rubber ink stamp pressed onto paper, then two quick rising koto plucks, D and G. Slightly stronger than a single pluck.
```

**`mult_x5`** — множитель ×5 · 0.55 с

```text
A firm ink stamp pressed onto paper, then three quick rising koto plucks, D, G, B, with a small bell on the last note. Confident and bright.
```

**`mult_x10`** — множитель ×10, только во фриспинах · 0.8 с

```text
A heavy ink stamp slammed onto paper with a low taiko hit, then a fast koto run up a full octave ending on a ringing temple bell. Powerful, rare, impressive.
```

## Выигрыши

Десять звуков, выстроенных лесенкой: чем больше выигрыш, тем длиннее фраза и тем больше инструментов. Пороги взяты из игры и указаны в ставках.

**`win_small`** — выигрыш меньше 3× · 0.6 с

```text
Three quick rising koto plucks, D, E, G, soft and pleasant, with a faint paper rustle underneath. A small, modest reward.
```

**`win_medium`** — выигрыш от 3× до 10× · 0.9 с

```text
Five quick rising koto plucks, D, E, G, A, B, brighter and fuller, ending with one glass wind-chime note. A satisfying reward.
```

**`win_large`** — выигрыш от 10× · 1.3 с

```text
A fast koto run rising over a full octave from D to high D, doubled by shamisen, ending with a small taiko hit and a bright bell. Strong, happy, clearly a good win.
```

**`count_loop`** — счётчик выигрыша набирает сумму · петля 1 с

```text
A very fast, even stream of tiny wooden ticks and light koto harmonics, like an abacus counting quickly, about sixteen ticks per second. Constant speed and volume, bright but quiet, seamless loop.
```

**`count_end`** — счётчик досчитал · 0.5 с

```text
One bright glass chime on high D together with a short, tight small-taiko hit. A clean full stop.
```

**`bigwin_big`** — плашка BIG WIN, выигрыш от 15× · 2.5 с

```text
A short triumphant fanfare: a taiko hit, then koto and shamisen play a bold rising five-note pentatonic phrase ending on a held bright chord with ringing glass chimes. Proud and joyful.
```

**`bigwin_mega`** — плашка MEGA WIN, от 50× · 3 с

```text
A bigger triumphant fanfare: two strong taiko hits, then koto, shamisen and shakuhachi play a bold rising pentatonic phrase that climbs higher, ending on a bright held chord with bells and a shimmering chime cascade. Very excited, festive.
```

**`bigwin_epic`** — плашка EPIC WIN, от 200× · 3.5 с

```text
A grand festival fanfare: a rolling taiko crescendo into a huge hit, the full ensemble of koto, shamisen and shakuhachi plays a soaring rising pentatonic phrase, ending on a wide bright chord with a gong and a long cascade of glass chimes. Overwhelming joy.
```

**`bigwin_max`** — плашка MAX WIN, потолок 15 000× · 5 с

```text
The most majestic fanfare of all: a deep gong strike, a thunderous taiko ensemble roll, then the full ensemble plays a slow, heroic rising pentatonic theme in octaves, ending on a huge final chord with gong, temple bells and glass chimes ringing out. Legendary, once-in-a-lifetime moment.
```

**`confetti`** — взрыв бумажного конфетти на плашках · 1.2 с

```text
A burst of hundreds of small paper pieces thrown into the air: a soft pop, then a light fluttering shower of paper confetti falling. Airy and festive, no pitched notes.
```

## Бонус и фриспины

Семь звуков ведут игрока через бонус: вход, плашка с числом вращений, липкие вайлды, ретриггер и итог. Звуки входа должны заканчиваться «открыто» — сразу после них вступает музыка фриспинов.

**`bonus_trigger`** — три скаттера на поле, фонари загораются · 2 с

```text
Paper lanterns ignite one after another: three quick soft whooshes of flame catching paper, then a warm gong strike and a fast rising koto glissando sweeping up two octaves. Magical, exciting, an announcement.
```

**`fs_intro`** — плашка «8 FREE SPINS» · 2.5 с

```text
A festive call to start: a short accelerating taiko drum roll, a bright shakuhachi flute call of three rising notes, and a final taiko hit with a glass chime. Ends on an open, unresolved note, as if the music is about to begin.
```

**`super_intro`** — плашка «SUPER SPINS» · 3 с

```text
A grand festive call to start: a deep gong, a long accelerating roll of big taiko drums, a powerful shakuhachi flute call of four rising notes doubled by shamisen, and a huge final taiko hit with ringing bells. Ends on an open, unresolved note. Bigger and more heroic than a normal bonus start.
```

**`super_wilds`** — три стартовых вайлда встают на поле в супербонусе · 1.2 с

```text
Three golden paper emblems slapped onto a board one after another, evenly spaced: each is a crisp paper slap with a rising koto pluck, D, G, high D, the last one with a small bell. Decisive and rhythmic.
```

**`wild_sticky`** — вайлд во фриспинах прилипает к полю · 0.5 с

```text
A wooden seal stamped firmly onto thick paper, a solid muted thump, followed by a short metallic temple-bowl ping. Feels like something being locked in place.
```

**`retrigger`** — плашка «+5 FREE SPINS» · 1.5 с

```text
A happy surprise: a quick upward koto glissando, a bright shakuhachi trill and two cheerful glass chime notes, G then high D. Light, sparkling, a welcome bonus on top of a bonus.
```

**`bonus_end`** — итог бонуса, плашка «BONUS WIN» · 3 с

```text
A warm closing phrase: koto and shakuhachi play a calm descending pentatonic melody of five notes that resolves on a low D, with a soft gong and a slow glass chime ringing out. Satisfied, complete, the festival is over.
```

## Интерфейс

Одиннадцать коротких звуков кнопок и окон. Они тише и короче всего остального: бумага и одна нота, без барабанов.

**`ui_click`** — любая кнопка · 0.08 с

```text
A single tiny tap of a fingertip on a thick paper card. Very short, soft, dry, almost a click.
```

**`ui_bet_up`** — ставка «+» · 0.12 с

```text
One very short, soft koto pluck on the note G, slightly bright. Tiny and clean.
```

**`ui_bet_down`** — ставка «−» · 0.12 с

```text
One very short, soft koto pluck on the note D, lower and slightly darker. Tiny and clean.
```

**`ui_open`** — открывается меню или окно · 0.25 с

```text
A sheet of paper being quickly unfolded: a short light rustle that opens upward in pitch. Soft, quick, friendly.
```

**`ui_close`** — закрывается меню или окно · 0.2 с

```text
A sheet of paper being quickly folded shut: a short light rustle that closes downward in pitch, ending with a tiny soft crease. Soft and quick.
```

**`ui_toggle_on`** — включён переключатель: звук, музыка, турбо, автоигра · 0.15 с

```text
A small wooden switch clicking, followed instantly by one tiny high glass chime note. Light and positive.
```

**`ui_toggle_off`** — переключатель выключен · 0.15 с

```text
A small wooden switch clicking, followed instantly by one tiny muted low woodblock tap. Light and neutral.
```

**`ante_on`** — включён режим анте · 0.6 с

```text
A paper fan snapping open, followed by two bright rising koto plucks, A then high D, with a small bell. Energised, a boost has been switched on.
```

**`ante_off`** — анте выключен · 0.5 с

```text
A paper fan snapping shut, followed by two soft falling koto plucks, A then D. Calm, a boost has been switched off.
```

**`buy_confirm`** — покупка бонуса подтверждена · 0.8 с

```text
A heavy wooden seal stamped onto paper with authority, followed by a short warm gong hit that fades quickly. A decision has been sealed.
```

**`ui_error`** — не хватает баланса или ошибка · 0.3 с

```text
Two quick, soft, low hollow bamboo knocks, the second slightly lower than the first. Gentle and polite, not alarming, clearly meaning "not possible".
```

## Сводная таблица

Все 43 файла в порядке разделов; 21 «основной» закрывает всё, что игрок слышит постоянно. Имя файла — как в первой колонке, расширение любое.

| Файл | Длительность, с | Петля | Где звучит | Очередь |
| --- | --- | --- | --- | --- |
| `music_base` | 60–90 | да | Базовая игра | основной |
| `music_fs` | 45–60 | да | Фриспины | основной |
| `music_super` | 45–60 | да | Супер-фриспины | позже |
| `music_bigwin` | 20–30 | да | Под плашкой крупного выигрыша | позже |
| `spin_start` | 0.4 | нет | Нажатие спина | основной |
| `reel_spin_loop` | 2 | да | Барабаны крутятся | основной |
| `reel_stop` | 0.2 | нет | Остановка каждого барабана | основной |
| `scatter_land_1` | 0.6 | нет | Первый скаттер | основной |
| `scatter_land_2` | 0.7 | нет | Второй скаттер | основной |
| `scatter_land_3` | 0.9 | нет | Третий скаттер и дальше | основной |
| `wild_land` | 0.6 | нет | Выпал вайлд | основной |
| `mult_x2` | 0.4 | нет | Множитель ×2 на вайлде | позже |
| `mult_x3` | 0.45 | нет | Множитель ×3 | позже |
| `mult_x5` | 0.55 | нет | Множитель ×5 | позже |
| `mult_x10` | 0.8 | нет | Множитель ×10, фриспины | позже |
| `win_small` | 0.6 | нет | Выигрыш меньше 3× | основной |
| `win_medium` | 0.9 | нет | Выигрыш 3×–10× | основной |
| `win_large` | 1.3 | нет | Выигрыш от 10× | основной |
| `count_loop` | 1 | да | Счётчик набирает сумму | основной |
| `count_end` | 0.5 | нет | Счётчик досчитал | основной |
| `bigwin_big` | 2.5 | нет | Плашка BIG WIN, от 15× | основной |
| `bigwin_mega` | 3 | нет | Плашка MEGA WIN, от 50× | позже |
| `bigwin_epic` | 3.5 | нет | Плашка EPIC WIN, от 200× | позже |
| `bigwin_max` | 5 | нет | Плашка MAX WIN, 15 000× | основной |
| `confetti` | 1.2 | нет | Конфетти на плашках | позже |
| `bonus_trigger` | 2 | нет | Три скаттера, вход в бонус | основной |
| `fs_intro` | 2.5 | нет | Плашка «8 FREE SPINS» | основной |
| `super_intro` | 3 | нет | Плашка «SUPER SPINS» | позже |
| `super_wilds` | 1.2 | нет | Стартовые вайлды супербонуса | позже |
| `wild_sticky` | 0.5 | нет | Вайлд прилипает во фриспинах | основной |
| `retrigger` | 1.5 | нет | Плашка «+5 FREE SPINS» | позже |
| `bonus_end` | 3 | нет | Итог бонуса | основной |
| `ui_click` | 0.08 | нет | Любая кнопка | основной |
| `ui_bet_up` | 0.12 | нет | Ставка «+» | позже |
| `ui_bet_down` | 0.12 | нет | Ставка «−» | позже |
| `ui_open` | 0.25 | нет | Открытие меню и окон | позже |
| `ui_close` | 0.2 | нет | Закрытие меню и окон | позже |
| `ui_toggle_on` | 0.15 | нет | Переключатель включён | позже |
| `ui_toggle_off` | 0.15 | нет | Переключатель выключен | позже |
| `ante_on` | 0.6 | нет | Анте включён | позже |
| `ante_off` | 0.5 | нет | Анте выключен | позже |
| `buy_confirm` | 0.8 | нет | Покупка бонуса подтверждена | позже |
| `ui_error` | 0.3 | нет | Не хватает баланса, ошибка | позже |
