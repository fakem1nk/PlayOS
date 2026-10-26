# Security policy

**English** · [Русский](#политика-безопасности)

## Supported versions

Only the latest release gets security fixes. PlayOS updates itself, so the fix reaches installed copies on its own.

## Reporting a vulnerability

Please don't open a public issue. Report it privately instead:

1. Open the [Security tab](https://github.com/fakem1nk/PlayOS/security) and click **Report a vulnerability**.
2. Describe what is affected, how to reproduce it and what an attacker could do with it.

If GitHub isn't an option, write to the maintainer in Telegram: [t.me/indiehellper](https://t.me/indiehellper).

PlayOS is maintained by one person in their free time. I'll try to reply within a week, and I'll let you know when a fix is released. Credit in the release notes is yours if you want it.

## What counts

- Leaks of cloud tokens or other data PlayOS stores in `%APPDATA%\PlayOS`.
- Anything that lets a downloaded file, a backup (`.playos`), cloud data or a web response run code or write outside its folder.
- Problems with how updates are downloaded and checked.

Bugs in emulators, Steam or games themselves aren't PlayOS issues; please report them to their authors.

---

# Политика безопасности

## Поддерживаемые версии

Исправления безопасности выходят только для последней версии. PlayOS обновляется сам, так что исправление дойдёт до установленных копий без вашего участия.

## Как сообщить об уязвимости

Пожалуйста, не создавайте публичную задачу. Сообщите приватно:

1. Откройте [вкладку Security](https://github.com/fakem1nk/PlayOS/security) и нажмите **Report a vulnerability**.
2. Опишите, что затронуто, как воспроизвести и что может сделать злоумышленник.

Если GitHub не подходит, напишите сопровождающему в Telegram: [t.me/indiehellper](https://t.me/indiehellper).

PlayOS поддерживает один человек в свободное время. Я постараюсь ответить в течение недели и сообщу, когда выйдет исправление. Если хотите, вас упомянут в описании релиза.

## Что считается уязвимостью

- Утечка облачных токенов или других данных, которые PlayOS хранит в `%APPDATA%\PlayOS`.
- Всё, что позволяет скачанному файлу, бэкапу (`.playos`), данным из облака или ответу сайта выполнить код или записать файлы за пределами своей папки.
- Проблемы с загрузкой и проверкой обновлений.

Ошибки в самих эмуляторах, Steam или играх к PlayOS не относятся — о них лучше сообщить их авторам.
