# Senbazuru — звук

Все файлы — mp3 (Safari, RGS) + webm/opus (артефакт) с одинаковыми именами. Импорт: `python3 tools/import_sound.py <папка с music/ и sfx/>` (обрезка тишины, −16 LUFS эффекты, −14 LUFS музыка, бесшовные петли). Промпты — `docs/senbazuru_sound_prompts.md`.

- Один выключатель: все вызовы идут через `Snd` и проверяют `G.sound` (плюс отдельные «музыка» и «эффекты» в настройках); видео без звука.
- Музыка по сценам с кроссфейдом (`Snd.setMode`): base → fs / super; от таблички MEGA основная приглушается и играет `music_bigwin`.
- Звук грузится после первого тапа, сначала нужное; пока файла нет — синтезированная замена.
- Anticipation (v12) — синтез (шорох бумаги + два тона), отдельного файла нет.

| Файл | Длительность, с | Петля |
|---|---|---|
| `assets/sfx/ante_off` | 0.55 |  |
| `assets/sfx/ante_on` | 0.63 |  |
| `assets/sfx/bigwin_big` | 2.30 |  |
| `assets/sfx/bigwin_epic` | 3.53 |  |
| `assets/sfx/bigwin_max` | 5.04 |  |
| `assets/sfx/bigwin_mega` | 2.61 |  |
| `assets/sfx/bonus_end` | 3.03 |  |
| `assets/sfx/bonus_trigger` | 2.04 |  |
| `assets/sfx/buy_confirm` | 0.84 |  |
| `assets/sfx/confetti` | 1.18 |  |
| `assets/sfx/count_end` | 0.55 |  |
| `assets/sfx/count_loop` | 1.04 | да |
| `assets/sfx/fs_intro` | 2.48 |  |
| `assets/sfx/mult_x10` | 0.84 |  |
| `assets/sfx/mult_x2` | 0.42 |  |
| `assets/sfx/mult_x3` | 0.50 |  |
| `assets/sfx/mult_x5` | 0.60 |  |
| `assets/sfx/reel_spin_loop` | 1.44 | да |
| `assets/sfx/reel_stop` | 0.24 |  |
| `assets/sfx/retrigger` | 1.54 |  |
| `assets/sfx/scatter_land_1` | 0.63 |  |
| `assets/sfx/scatter_land_2` | 0.73 |  |
| `assets/sfx/scatter_land_3` | 0.94 |  |
| `assets/sfx/spin_start` | 0.42 |  |
| `assets/sfx/super_intro` | 3.03 |  |
| `assets/sfx/super_wilds` | 1.23 |  |
| `assets/sfx/ui_bet_down` | 0.16 |  |
| `assets/sfx/ui_bet_up` | 0.16 |  |
| `assets/sfx/ui_click` | 0.08 |  |
| `assets/sfx/ui_close` | 0.24 |  |
| `assets/sfx/ui_error` | 0.31 |  |
| `assets/sfx/ui_open` | 0.29 |  |
| `assets/sfx/ui_toggle_off` | 0.13 |  |
| `assets/sfx/ui_toggle_on` | 0.18 |  |
| `assets/sfx/wild_land` | 0.63 |  |
| `assets/sfx/wild_sticky` | 0.52 |  |
| `assets/sfx/win_large` | 1.31 |  |
| `assets/sfx/win_medium` | 0.94 |  |
| `assets/sfx/win_small` | 0.63 |  |
| `assets/music/music_base` | 85.08 | да |
| `assets/music/music_bigwin` | 76.54 | да |
| `assets/music/music_fs` | 55.93 | да |
| `assets/music/music_super` | 55.59 | да |
