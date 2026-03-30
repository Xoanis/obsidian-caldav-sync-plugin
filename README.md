# Obsidian CalDAV Event Sync

Плагин для синхронизации заметок-событий между Obsidian и CalDAV-календарем.
Он работает в standalone-режиме и умеет мягко встраиваться в экосистему [`PARA Core`](https://github.com/Xoanis/obsidian-para-core).

## Описание

Этот плагин позволяет синхронизировать события, хранящиеся в виде заметок в Obsidian, с вашим CalDAV-календарем. Он поддерживает двустороннюю синхронизацию:

- локальная заметка может обновить удалённое событие
- удалённые события могут быть импортированы в папку событий
- при наличии [`PARA Core`](https://github.com/Xoanis/obsidian-para-core) плагин регистрирует домен `Calendar` и хранит события в `Records/Calendar/Events`

## Установка

1. Скачайте последнюю версию плагина из [репозитория](https://github.com/your-repo/obsidian-caldav).
2. Распакуйте архив в папку `.obsidian/plugins` вашего хранилища Obsidian.
3. Перезапустите Obsidian или перезагрузите плагины.
4. Включите плагин в настройках Obsidian.

## Настройка

1. Откройте настройки плагина в Obsidian.
2. Укажите директорию, в которой будут храниться файлы событий. Для общей экосистемы рекомендуем `Inbox/Events`.
3. Введите логин вашего CalDAV-провайдера.
4. Введите пароль приложения или другой provider-specific secret.
5. Введите URL вашего CalDAV-календаря. Для Яндекс.Календаря он имеет вид `https://caldav.yandex.ru/calendars/user@yandex.ru/id-календаря/`.

## Использование

### Создание события в Obsidian

1. Создайте новую заметку в указанной директории.
2. Добавьте свойства:
   - `type: "calendar-event"`
   - `status: "active"`
   - `created: "YYYY-MM-DD"`
   - `date: "YYYY-MM-DD"`
   - Рекомендуется: `summary: "Заголовок события для календаря"`
   - Опционально: `start_time: "HH:mm"`, `end_time: "HH:mm"`, `location: "Место"`, `url: "Ссылка"`, `guid: "remote-id"`, `project: "[[Project]]"`, `area: "[[Area]]"`
   - Напоминания: `alarm: ["15m", "1h", "1d"]`
   - Служебный статус Telegram-напоминаний: `telegram_alarms_status: ["pending", "sent"]`
3. Напишите описание события в теле заметки.
4. Выполните команду `Create new calendar event`, если хотите создать событие через modal-форму.
5. Выполните команду `Sync event with calendar` для синхронизации текущего события или `Sync all events with calendar` для синхронизации всех событий.

Поле `summary` используется для CalDAV-синхронизации как заголовок события. Если `summary` не задано, плагин использует имя заметки как fallback.
Поле `telegram_alarms_status` поддерживается плагином автоматически только если доступен [`obsidian-telegram-bot`](https://github.com/Xoanis/obsidian-telegram-bot), и соответствует списку `alarm` по индексам. Для каждого alarm хранится либо `pending`, либо `sent`.
Если [`PARA Core`](https://github.com/Xoanis/obsidian-para-core) не установлен, поля `project` и `area` в модальном окне скрываются, а плагин продолжает работать в standalone-режиме.

Минимальный пример:

```yaml
---
type: "calendar-event"
status: "active"
created: "2026-03-29"
date: "2026-03-30"
summary: "Проверка синка"
start_time: "10:00"
end_time: "11:00"
location: "Online"
alarm: ["15m", "1h"]
telegram_alarms_status: ["pending", "pending"]
tags: []
---
```

### Синхронизация событий

- **Create new calendar event**: Открывает modal-окно для создания события. При создании заметка получает имя вида `YYYY-MM-DD HH-mm Summary`, а если в текущей заметке есть курсор, туда вставляется `![[...]]` ссылка на новое событие. После создания плагин остается в исходной заметке и не переключается на новую event-note.
- **Sync event with calendar**: Синхронизирует текущее активное событие с календарем.
- **Sync all events with calendar**: Синхронизирует все события из указанной директории с календарем и создает новые файлы для событий, которые есть в календаре, но отсутствуют в Obsidian. Нечитаемые, удаленные или невалидные заметки при этом пропускаются без падения плагина.

### Модальное окно создания

- Использует нативные поля выбора даты и времени, если они доступны в окружении Obsidian.
- Автоматически предлагает `end_time` на час позже `start_time`, если конец события еще не задан.
- Показывает подсказки по `project` и `area`, если установлен [`PARA Core`](https://github.com/Xoanis/obsidian-para-core).
- Проверяет ввод в реальном времени и подсвечивает ошибки прямо в форме.
- Блокирует кнопку подтверждения, пока обязательные поля или формат значений невалидны.
- Строго валидирует `alarm`: допустимы значения вроде `15m`, `1h`, `1d`, `1w`.

### Telegram

Если установлен [`obsidian-telegram-bot`](https://github.com/Xoanis/obsidian-telegram-bot), календарный плагин добавляет:

- `/event` - создать новое событие
- `/events` - показать ближайшие предстоящие события
- reminder-уведомления в Telegram на основе поля `alarm`

Быстрый формат для `/event`:

```text
YYYY-MM-DD HH:mm-HH:mm [sync|nosync] Summary | Description | Location | 15m,1h | https://...
```

Примеры:

```text
2026-04-05 10:00-11:00 sync Team sync | Release prep | Online | 15m,1h
2026-04-06 09:00 nosync Dentist | Bring documents | Clinic | 1d
```

## Примечания

- Плагин поддерживает только однодневные события. Многосуточные события не поддерживаются.
- При синхронизации события из Obsidian перезаписывают события в календаре. Будьте осторожны с изменениями, внесенными в календаре.
- Убедитесь, что имена файлов событий не содержат недопустимых символов для файловой системы.
- При отсутствии [`obsidian-telegram-bot`](https://github.com/Xoanis/obsidian-telegram-bot) Telegram-интеграция просто не активируется, а служебное поле `telegram_alarms_status` не создается.


## Лицензия

MIT License
