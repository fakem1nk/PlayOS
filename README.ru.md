<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-ascii-dark.png">
    <img src="docs/assets/logo-ascii-light.png" alt="PlayOS" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/fakem1nk/PlayOS/ci.yml?branch=main&style=for-the-badge&label=%D1%81%D0%B1%D0%BE%D1%80%D0%BA%D0%B0&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNSAxMi41bDQuNSA0LjVMMTkgNy41Ii8%2BPC9zdmc%2B" alt="Build"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/github/v/release/fakem1nk/PlayOS?style=for-the-badge&label=%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNCA5bDgtNSA4IDV2NmwtOCA1LTgtNXoiLz48cGF0aCBkPSJNNCA5bDggNSA4LTVNMTIgMTR2NiIvPjwvc3ZnPg%3D%3D" alt="Release"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases"><img src="https://img.shields.io/github/downloads/fakem1nk/PlayOS/total?style=for-the-badge&label=%D0%B7%D0%B0%D0%B3%D1%80%D1%83%D0%B7%D0%BA%D0%B8&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgNHYxMU03LjUgMTAuNUwxMiAxNWw0LjUtNC41TTUgMjBoMTQiLz48L3N2Zz4%3D" alt="Downloads"></a>
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><img src="https://img.shields.io/badge/Windows-10%20%7C%2011-5EA1FF?style=for-the-badge&label=Windows&labelColor=1B2030&color=5EA1FF&logo=data:image%2Fsvg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSI0IiB5PSI1IiB3aWR0aD0iMTYiIGhlaWdodD0iMTIiIHJ4PSIyIi8%2BPHBhdGggZD0iTTkgMjBoNiIvPjxwYXRoIGQ9Ik0xMC41IDguOHY0LjRsMy44LTIuMnoiIGZpbGw9IiNmZmYiIHN0cm9rZT0ibm9uZSIvPjwvc3ZnPg%3D%3D" alt="Windows 10 | 11"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>Русский</b></p>

**PlayOS** — игровой лаунчер с открытым исходным кодом, который превращает компьютер на Windows в приставку: одно место для всех ваших игр — PC, Steam, PlayStation&nbsp;2, PlayStation&nbsp;3 и VR — с полным управлением геймпадом, меню поверх игры, облачными сохранениями и настоящими трофеями. Интерфейс на русском и английском.

PlayOS написан на TypeScript (Electron, React, Node.js). Он общается с Windows через koffi и с DualSense по HID, игры PlayStation&nbsp;2 и PlayStation&nbsp;3 запускает через PCSX2 и RPCS3, а VR-игры для PC — на Meta&nbsp;Quest через OpenComposite.

<p align="center">
  <a href="https://github.com/fakem1nk/PlayOS/releases/latest"><b>Скачать для Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#возможности">Возможности</a>
  &nbsp;·&nbsp;
  <a href="#с-чего-начать">С чего начать</a>
  &nbsp;·&nbsp;
  <a href="docs/FAQ.md">F.A.Q</a>
  &nbsp;·&nbsp;
  <a href="docs/BUG_REPORT.ru.md">Сообщить об ошибке</a>
  &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT.ru.md">Для разработчиков</a>
</p>

<p align="center">
  <img src="docs/assets/preview.jpg" alt="Главный экран PlayOS" width="100%">
</p>

## Возможности

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/library.svg" width="48" height="48" alt=""><br>
      <b>Одна библиотека для всего</b><br>
      Игры PC и Steam, PlayStation&nbsp;2 через PCSX2, PlayStation&nbsp;3 через RPCS3 и VR-игры. Игры Steam, образы PS2 и список игр RPCS3 импортируются разом; для любой другой игры достаточно выбрать папку — PlayOS сам найдёт EXE. Поиск с геймпада, свои подборки, сортировка и удаление игр с компьютера прямо из PlayOS.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/controller.svg" width="48" height="48" alt=""><br>
      <b>Создан под геймпад</b><br>
      DualSense, DualShock&nbsp;4, Xbox, 8BitDo, Nintendo и старые геймпады DirectInput — для необычных есть настройка кнопок. Подсказки подстраиваются под геймпад в руках и под то, что выбрано. Экранная клавиатура, вибрация в меню и прокрутка правым стиком на месте, а мышь и клавиатура делят один фокус с геймпадом.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/overlay.svg" width="48" height="48" alt=""><br>
      <b>Меню поверх любой игры</b><br>
      Кнопка PS или Guide, Select&nbsp;+&nbsp;Start или Ctrl&nbsp;+&nbsp;Alt&nbsp;+&nbsp;H ставят игру на паузу и открывают быстрые сохранения со скриншотами, время сессии, громкость, вывод звука, яркость и заряд геймпада. В PCSX2 сохранения попадают точно в нужный слот через PINE. Для отдельной игры меню можно выключить.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/vr.svg" width="48" height="48" alt=""><br>
      <b>VR-игры</b><br>
      Отметьте любую игру для PC как VR-игру и играйте на Meta&nbsp;Quest по Link или Air&nbsp;Link. PlayOS сам скачает VR-компонент и подготовит его перед каждым запуском, хранит чёткость, руки, вибрацию и режим совместимости для каждой игры, а заряд шлема и контроллеров показывает в верхней панели.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/cloud.svg" width="48" height="48" alt=""><br>
      <b>Облачные сохранения</b><br>
      Сохранения, библиотека, время в играх и профиль на Яндекс Диске, Google Drive или в папке синхронизации. Сохранения игр PC находятся по базе Ludusavi, хранится до 30 версий каждого, а на новом компьютере всё возвращается. Удобнее файлом? Всё переносит одна копия <code>.playos</code>.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/trophy.svg" width="48" height="48" alt=""><br>
      <b>Настоящие трофеи</b><br>
      RetroAchievements для PS2 и достижения Steam для PC, в том числе в играх через эмуляторы Steam. Уведомление появляется в момент получения, а в списке трофеев остаётся скриншот этого момента. Каждый ключ PlayOS помогает получить по шагам.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/playtime.svg" width="48" height="48" alt=""><br>
      <b>Время и история</b><br>
      Каждая сессия на счету, даже через сторонние лаунчеры. На странице игры — история сессий, активность за две недели и HowLongToBeat; в профиле — игры, в которые вы играли больше всего, последние трофеи и собственные трофеи PlayOS.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/art.svg" width="48" height="48" alt=""><br>
      <b>Живой главный экран</b><br>
      Обложки, фоны и логотипы сами загружаются из Steam, SteamGridDB и Википедии. Меню и подсветка DualSense берут цвет игры, фон оживает беззвучным трейлером, а заставка с часами бережёт OLED-экраны.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/tv.svg" width="48" height="48" alt=""><br>
      <b>Готов к телевизору</b><br>
      Выбор экрана для PlayOS и эмуляторов, масштаб интерфейса для дивана, тёмная, светлая или системная тема. PlayOS запускается вместе с Windows, дружит с Moonlight и ждёт в трее — вернуть его можно кнопкой PS.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/bell.svg" width="48" height="48" alt=""><br>
      <b>Не мешает играть</b><br>
      Пока идёт игра, PlayOS выгружает свой интерфейс и работает в режиме эффективности Windows. Ошибки, трофеи и обновления ждут в центре уведомлений. Обновления скачиваются в фоне и приходят с коротким списком изменений на вашем языке, бета-версии — по желанию.
    </td>
  </tr>
</table>

## С чего начать

1. Скачайте `PlayOS-Setup-<версия>.exe` из [последнего релиза](https://github.com/fakem1nk/PlayOS/releases/latest) и запустите. Если SmartScreen остановит установку, нажмите «Подробнее» → «Выполнить в любом случае» ([почему так](docs/FAQ.md#windows-пишет-система-windows-защитила-ваш-компьютер)).
2. Короткая первая настройка спросит имя и язык, подключит облако, найдёт игры, подскажет путь к эмуляторам и поможет выбрать экран и громкость. Любой шаг можно пропустить и поменять потом в настройках.
3. Готово: дальше PlayOS обновляется сам.

| Чтобы играть | Что нужно |
| --- | --- |
| В игры PC и Steam | Windows 10 или 11, 64-бит |
| В игры PlayStation&nbsp;2 | [PCSX2](https://pcsx2.net), свой BIOS и образы дисков |
| В игры PlayStation&nbsp;3 | [RPCS3](https://rpcs3.net) и прошивка PS3 |
| В VR-игры | Meta&nbsp;Quest и приложение Meta Horizon Link |
| С подсветкой DualSense | [DSX](https://store.steampowered.com/app/1812620/DSX/) |
| С трофеями и обложками почти для всех игр | Бесплатные ключи RetroAchievements, Steam Web API и SteamGridDB (необязательно) |

Управление, настройка эмуляторов и частые проблемы — в [F.A.Q](docs/FAQ.md).

## Участники

<a href="https://github.com/fakem1nk/PlayOS/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=fakem1nk/PlayOS" alt="Участники">
</a>

Хотите помочь? Начните с [руководства для разработчиков](docs/DEVELOPMENT.ru.md). Идеи и сообщения об ошибках ждём в [Issues](https://github.com/fakem1nk/PlayOS/issues/new/choose).

## Лицензия

PlayOS распространяется по лицензии [GPL-3.0](LICENSE).

<sub>PlayOS — независимый проект, не связанный с Sony Interactive Entertainment, Valve, Microsoft и Meta. PlayStation, DualSense, Steam, Xbox и Meta&nbsp;Quest — товарные знаки их владельцев. Обложки на скриншоте принадлежат правообладателям игр. Эмуляторы, BIOS и игры в комплект не входят.</sub>
