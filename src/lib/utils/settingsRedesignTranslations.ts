import type { LanguageCode } from './i18n';

export const settingsRedesignTranslationKeys = [
	'settings.appearanceDescription',
	'settings.searchPlaceholder',
	'settings.noSearchResults',
	'settings.resetSection',
	'settings.interfaceSection',
	'settings.markpadWindowSection',
	'settings.behaviorSection',
	'settings.toolbarsSettings',
	'settings.previewTextFont',
	'settings.previewCodeFont',
	'settings.fontPreview',
	'settings.fontPreviewText',
	'settings.editorFontPreview',
	'settings.windowSurface',
	'settings.windowSurfaceDescription',
	'settings.surfaceSolid',
	'settings.surfaceTranslucent',
	'settings.surfaceOpacity',
	'settings.surfaceBlur',
	'settings.surfaceControlRequiresTranslucent',
	'settings.surfaceBlurRequiresTransparency',
	'settings.surfaceBlurUnavailableLinux',
	'settings.backdropDimming',
	'settings.languageDescription',
	'settings.themeDescription',
	'settings.themeLight',
	'settings.themeSystem',
	'settings.themeDark',
	'settings.editorToolbar',
	'settings.applicationToolbar',
	'settings.toolbarToolInlineCode',
	'settings.toolbarToolCodeBlock',
	'settings.toolbarToolQuote',
	'settings.toolbarToolHeading1',
	'settings.toolbarToolHeading2',
	'settings.toolbarToolHeading3',
	'settings.toolbarToolBulletList',
	'settings.toolbarToolNumberedList',
	'settings.toolbarToolChecklist',
	'settings.toolbarToolLink',
	'settings.toolbars',
	'menu.checkForUpdates',
	'menu.back',
	'menu.forward',
	'tooltip.reloadFromDisk',
	'settings.surfaceOpacityDescription',
	'settings.surfaceBlurDescription',
	'settings.backdropDimmingDescription'
] as const;

type RedesignLanguage = Exclude<LanguageCode, 'en' | 'it'>;

// Values follow settingsRedesignTranslationKeys. Keeping the keys in one place makes
// missing redesign strings detectable without duplicating 45 property names per locale.
export const settingsRedesignTranslationValues: Record<RedesignLanguage, readonly string[]> = {
	ja: [
		'言語、テーマ、アプリの表示をカスタマイズ', '設定を検索...', '設定が見つかりません', 'セクションをリセット', 'インターフェース', 'Markpad ウィンドウ', '動作', 'ツールバー設定',
		'プレビューテキストのフォント', 'コードフォント', 'フォントのライブプレビュー', 'Markpad テキストプレビュー', 'エディターのライブフォントプレビュー',
		'表示スタイル', 'アプリ全体の表示スタイル', '不透明', '半透明', '表示の不透明度', '背景のぼかし', '半透明の表示スタイルで利用できます', '表示の不透明度が 100% 未満のとき利用できます', 'Tauri がネイティブウィンドウ効果をサポートしていないため Linux では利用できません', '背景を暗くする',
		'アプリケーションの言語', 'インターフェースの外観', 'ライト', 'システム', 'ダーク',
		'エディターツールバー', 'アプリケーションツールバー', 'インラインコード', 'コードブロック', '引用', '見出し 1', '見出し 2', '見出し 3', '箇条書き', '番号付きリスト', 'チェックリスト', 'リンク', 'ツールバー',
		'更新を確認…', '戻る', '進む', 'ディスクから再読み込み', '設定画面とエディターの透明度', 'Markpad ウィンドウの背後を柔らかくぼかします', 'ウィンドウ背後の気を散らす要素を抑えます'
	],
	'zh-CN': [
		'自定义语言、主题和应用表面', '搜索设置...', '未找到设置', '重置此部分', '界面', 'Markpad 窗口', '行为', '工具栏设置',
		'预览文本字体', '代码字体', '实时字体预览', 'Markpad 文本预览', '实时编辑器字体预览',
		'表面', '整个应用的视觉样式', '实色', '半透明', '表面不透明度', '背景模糊', '使用半透明表面时可用', '表面不透明度低于 100% 时可用', 'Tauri 不支持原生窗口效果，因此在 Linux 上不可用', '背景变暗',
		'应用语言', '界面外观', '浅色', '系统', '深色',
		'编辑器工具栏', '应用工具栏', '行内代码', '代码块', '引用', '标题 1', '标题 2', '标题 3', '项目符号列表', '编号列表', '任务列表', '链接', '工具栏',
		'检查更新…', '后退', '前进', '从磁盘重新加载', '设置和编辑器的透明度', '柔化 Markpad 窗口后面的内容', '减少窗口后面的干扰'
	],
	'zh-TW': [
		'自訂語言、主題與應用程式表面', '搜尋設定...', '找不到設定', '重設此區段', '介面', 'Markpad 視窗', '行為', '工具列設定',
		'預覽文字字型', '程式碼字型', '即時字型預覽', 'Markpad 文字預覽', '即時編輯器字型預覽',
		'表面', '整個應用程式的視覺樣式', '實色', '半透明', '表面不透明度', '背景模糊', '使用半透明表面時可用', '表面不透明度低於 100% 時可用', 'Tauri 不支援原生視窗效果，因此在 Linux 上無法使用', '背景變暗',
		'應用程式語言', '介面外觀', '淺色', '系統', '深色',
		'編輯器工具列', '應用程式工具列', '行內程式碼', '程式碼區塊', '引用', '標題 1', '標題 2', '標題 3', '項目符號清單', '編號清單', '核取清單', '連結', '工具列',
		'檢查更新…', '上一頁', '下一頁', '從磁碟重新載入', '設定與編輯器的透明度', '柔化 Markpad 視窗後方的內容', '減少視窗後方的干擾'
	],
	ko: [
		'언어, 테마 및 앱 표면을 맞춤 설정', '설정 검색...', '설정을 찾을 수 없음', '섹션 초기화', '인터페이스', 'Markpad 창', '동작', '도구 모음 설정',
		'미리보기 텍스트 글꼴', '코드 글꼴', '실시간 글꼴 미리보기', 'Markpad 텍스트 미리보기', '실시간 편집기 글꼴 미리보기',
		'표면', '앱 전체의 시각적 스타일', '불투명', '반투명', '표면 불투명도', '배경 흐림', '반투명 표면에서 사용할 수 있습니다', '표면 불투명도가 100% 미만일 때 사용할 수 있습니다', 'Tauri가 네이티브 창 효과를 지원하지 않아 Linux에서는 사용할 수 없습니다', '배경 어둡게',
		'애플리케이션 언어', '인터페이스 모양', '밝게', '시스템', '어둡게',
		'편집기 도구 모음', '애플리케이션 도구 모음', '인라인 코드', '코드 블록', '인용문', '제목 1', '제목 2', '제목 3', '글머리 기호 목록', '번호 매기기 목록', '체크리스트', '링크', '도구 모음',
		'업데이트 확인…', '뒤로', '앞으로', '디스크에서 다시 로드', '설정 및 편집기의 투명도', 'Markpad 창 뒤의 콘텐츠를 부드럽게 흐립니다', '창 뒤의 방해 요소를 줄입니다'
	],
	ru: [
		'Настройте язык, тему и оформление приложения', 'Поиск настроек...', 'Настройки не найдены', 'Сбросить раздел', 'Интерфейс', 'Окно Markpad', 'Поведение', 'Настройки панелей инструментов',
		'Шрифт текста предпросмотра', 'Шрифт кода', 'Предпросмотр шрифта', 'Предпросмотр текста Markpad', 'Предпросмотр шрифта редактора',
		'Оформление', 'Визуальный стиль всего приложения', 'Сплошное', 'Полупрозрачное', 'Непрозрачность поверхности', 'Размытие фона', 'Доступно с полупрозрачным оформлением', 'Доступно при непрозрачности ниже 100%', 'Недоступно в Linux: Tauri не поддерживает системные эффекты окна', 'Затемнение фона',
		'Язык приложения', 'Внешний вид интерфейса', 'Светлая', 'Системная', 'Тёмная',
		'Панель редактора', 'Панель приложения', 'Встроенный код', 'Блок кода', 'Цитата', 'Заголовок 1', 'Заголовок 2', 'Заголовок 3', 'Маркированный список', 'Нумерованный список', 'Список задач', 'Ссылка', 'Панели инструментов',
		'Проверить обновления…', 'Назад', 'Вперёд', 'Перезагрузить с диска', 'Прозрачность настроек и редактора', 'Смягчает содержимое за окном Markpad', 'Уменьшает отвлекающие элементы за окном'
	],
	es: [
		'Personaliza el idioma, el tema y las superficies de la aplicación', 'Buscar ajustes...', 'No se encontraron ajustes', 'Restablecer sección', 'Interfaz', 'Ventana de Markpad', 'Comportamiento', 'Ajustes de las barras de herramientas',
		'Fuente del texto de vista previa', 'Fuente del código', 'Vista previa de fuente en directo', 'Vista previa de texto de Markpad', 'Vista previa de fuente del editor',
		'Superficie', 'Estilo visual de toda la aplicación', 'Sólida', 'Translúcida', 'Opacidad de la superficie', 'Desenfoque del fondo', 'Disponible con la superficie translúcida', 'Disponible cuando la opacidad es inferior al 100 %', 'No disponible en Linux porque Tauri no admite efectos de ventana nativos', 'Oscurecimiento del fondo',
		'Idioma de la aplicación', 'Aspecto de la interfaz', 'Claro', 'Sistema', 'Oscuro',
		'Barra del editor', 'Barra de la aplicación', 'Código en línea', 'Bloque de código', 'Cita', 'Encabezado 1', 'Encabezado 2', 'Encabezado 3', 'Lista con viñetas', 'Lista numerada', 'Lista de tareas', 'Enlace', 'Barras de herramientas',
		'Buscar actualizaciones…', 'Atrás', 'Adelante', 'Recargar desde el disco', 'Transparencia de los ajustes y el editor', 'Suaviza el contenido detrás de la ventana de Markpad', 'Reduce las distracciones detrás de la ventana'
	],
	fr: [
		'Personnalisez la langue, le thème et les surfaces de l’application', 'Rechercher dans les paramètres...', 'Aucun paramètre trouvé', 'Réinitialiser la section', 'Interface', 'Fenêtre Markpad', 'Comportement', 'Paramètres des barres d’outils',
		'Police du texte d’aperçu', 'Police du code', 'Aperçu de la police en direct', 'Aperçu du texte Markpad', 'Aperçu de la police de l’éditeur',
		'Surface', 'Style visuel de toute l’application', 'Opaque', 'Translucide', 'Opacité de la surface', 'Flou d’arrière-plan', 'Disponible avec la surface translucide', 'Disponible lorsque l’opacité est inférieure à 100 %', 'Indisponible sous Linux car Tauri ne prend pas en charge les effets de fenêtre natifs', 'Assombrissement de l’arrière-plan',
		'Langue de l’application', 'Apparence de l’interface', 'Clair', 'Système', 'Sombre',
		'Barre d’outils de l’éditeur', 'Barre d’outils de l’application', 'Code en ligne', 'Bloc de code', 'Citation', 'Titre 1', 'Titre 2', 'Titre 3', 'Liste à puces', 'Liste numérotée', 'Liste de tâches', 'Lien', 'Barres d’outils',
		'Rechercher des mises à jour…', 'Retour', 'Suivant', 'Recharger depuis le disque', 'Transparence des paramètres et de l’éditeur', 'Adoucit le contenu derrière la fenêtre Markpad', 'Réduit les distractions derrière la fenêtre'
	],
	de: [
		'Sprache, Design und App-Oberflächen anpassen', 'Einstellungen durchsuchen...', 'Keine Einstellungen gefunden', 'Abschnitt zurücksetzen', 'Benutzeroberfläche', 'Markpad-Fenster', 'Verhalten', 'Symbolleisteneinstellungen',
		'Schrift für Vorschautext', 'Codeschrift', 'Live-Schriftvorschau', 'Markpad-Textvorschau', 'Live-Schriftvorschau des Editors',
		'Oberfläche', 'Visueller Stil der gesamten App', 'Deckend', 'Durchscheinend', 'Deckkraft der Oberfläche', 'Hintergrundunschärfe', 'Mit durchscheinender Oberfläche verfügbar', 'Bei einer Deckkraft unter 100 % verfügbar', 'Unter Linux nicht verfügbar, da Tauri keine nativen Fenstereffekte unterstützt', 'Hintergrundabdunklung',
		'Anwendungssprache', 'Erscheinungsbild der Oberfläche', 'Hell', 'System', 'Dunkel',
		'Editor-Symbolleiste', 'Anwendungs-Symbolleiste', 'Inlinecode', 'Codeblock', 'Zitat', 'Überschrift 1', 'Überschrift 2', 'Überschrift 3', 'Aufzählung', 'Nummerierte Liste', 'Aufgabenliste', 'Link', 'Symbolleisten',
		'Nach Updates suchen…', 'Zurück', 'Vorwärts', 'Von Festplatte neu laden', 'Transparenz von Einstellungen und Editor', 'Macht Inhalte hinter dem Markpad-Fenster weicher', 'Reduziert Ablenkungen hinter dem Fenster'
	],
	'pt-BR': [
		'Personalize o idioma, o tema e as superfícies do aplicativo', 'Pesquisar configurações...', 'Nenhuma configuração encontrada', 'Redefinir seção', 'Interface', 'Janela do Markpad', 'Comportamento', 'Configurações das barras de ferramentas',
		'Fonte do texto de visualização', 'Fonte do código', 'Visualização da fonte em tempo real', 'Visualização de texto do Markpad', 'Visualização da fonte do editor',
		'Superfície', 'Estilo visual de todo o aplicativo', 'Sólida', 'Translúcida', 'Opacidade da superfície', 'Desfoque do fundo', 'Disponível com a superfície translúcida', 'Disponível quando a opacidade está abaixo de 100%', 'Indisponível no Linux porque o Tauri não oferece suporte a efeitos nativos de janela', 'Escurecimento do fundo',
		'Idioma do aplicativo', 'Aparência da interface', 'Claro', 'Sistema', 'Escuro',
		'Barra do editor', 'Barra do aplicativo', 'Código embutido', 'Bloco de código', 'Citação', 'Título 1', 'Título 2', 'Título 3', 'Lista com marcadores', 'Lista numerada', 'Lista de tarefas', 'Link', 'Barras de ferramentas',
		'Procurar atualizações…', 'Voltar', 'Avançar', 'Recarregar do disco', 'Transparência nas configurações e no editor', 'Suaviza o conteúdo atrás da janela do Markpad', 'Reduz as distrações atrás da janela'
	],
	pl: [
		'Dostosuj język, motyw i powierzchnie aplikacji', 'Szukaj ustawień...', 'Nie znaleziono ustawień', 'Zresetuj sekcję', 'Interfejs', 'Okno Markpad', 'Zachowanie', 'Ustawienia pasków narzędzi',
		'Czcionka tekstu podglądu', 'Czcionka kodu', 'Podgląd czcionki na żywo', 'Podgląd tekstu Markpad', 'Podgląd czcionki edytora na żywo',
		'Powierzchnia', 'Styl wizualny całej aplikacji', 'Pełna', 'Półprzezroczysta', 'Krycie powierzchni', 'Rozmycie tła', 'Dostępne z półprzezroczystą powierzchnią', 'Dostępne, gdy krycie jest mniejsze niż 100%', 'Niedostępne w systemie Linux, ponieważ Tauri nie obsługuje natywnych efektów okna', 'Przyciemnienie tła',
		'Język aplikacji', 'Wygląd interfejsu', 'Jasny', 'System', 'Ciemny',
		'Pasek edytora', 'Pasek aplikacji', 'Kod w tekście', 'Blok kodu', 'Cytat', 'Nagłówek 1', 'Nagłówek 2', 'Nagłówek 3', 'Lista punktowana', 'Lista numerowana', 'Lista zadań', 'Łącze', 'Paski narzędzi',
		'Sprawdź aktualizacje…', 'Wstecz', 'Dalej', 'Wczytaj ponownie z dysku', 'Przezroczystość ustawień i edytora', 'Zmiękcza zawartość za oknem Markpad', 'Ogranicza elementy rozpraszające za oknem'
	],
	nl: [
		'Pas taal, thema en app-oppervlakken aan', 'Instellingen zoeken...', 'Geen instellingen gevonden', 'Sectie resetten', 'Interface', 'Markpad-venster', 'Gedrag', 'Werkbalkinstellingen',
		'Lettertype voor voorbeeldtekst', 'Lettertype voor code', 'Live lettertypevoorbeeld', 'Markpad-tekstvoorbeeld', 'Live lettertypevoorbeeld van editor',
		'Oppervlak', 'Visuele stijl voor de hele app', 'Effen', 'Doorschijnend', 'Dekking van oppervlak', 'Achtergrondvervaging', 'Beschikbaar met het doorschijnende oppervlak', 'Beschikbaar wanneer de dekking lager is dan 100%', 'Niet beschikbaar op Linux omdat Tauri geen systeemeigen venstereffecten ondersteunt', 'Achtergrond dimmen',
		'Applicatietaal', 'Uiterlijk van de interface', 'Licht', 'Systeem', 'Donker',
		'Editorwerkbalk', 'Applicatiewerkbalk', 'Inlinecode', 'Codeblok', 'Citaat', 'Kop 1', 'Kop 2', 'Kop 3', 'Opsomming', 'Genummerde lijst', 'Takenlijst', 'Koppeling', 'Werkbalken',
		'Controleren op updates…', 'Terug', 'Vooruit', 'Opnieuw laden vanaf schijf', 'Transparantie van instellingen en editor', 'Verzacht inhoud achter het Markpad-venster', 'Vermindert afleiding achter het venster'
	],
	sv: [
		'Anpassa språk, tema och appytor', 'Sök inställningar...', 'Inga inställningar hittades', 'Återställ avsnitt', 'Gränssnitt', 'Markpad-fönster', 'Beteende', 'Inställningar för verktygsfält',
		'Teckensnitt för förhandsgranskning', 'Kodteckensnitt', 'Direkt förhandsgranskning av teckensnitt', 'Förhandsgranskning av Markpad-text', 'Direkt förhandsgranskning av redigerarens teckensnitt',
		'Yta', 'Visuell stil för hela appen', 'Solid', 'Genomskinlig', 'Ytans opacitet', 'Bakgrundsoskärpa', 'Tillgängligt med genomskinlig yta', 'Tillgängligt när opaciteten är under 100 %', 'Inte tillgängligt på Linux eftersom Tauri inte stöder inbyggda fönstereffekter', 'Bakgrundsdämpning',
		'Appens språk', 'Gränssnittets utseende', 'Ljust', 'System', 'Mörkt',
		'Redigerarens verktygsfält', 'Appens verktygsfält', 'Infogad kod', 'Kodblock', 'Citat', 'Rubrik 1', 'Rubrik 2', 'Rubrik 3', 'Punktlista', 'Numrerad lista', 'Checklista', 'Länk', 'Verktygsfält',
		'Sök efter uppdateringar…', 'Bakåt', 'Framåt', 'Läs in från disk igen', 'Genomskinlighet för inställningar och editor', 'Mjukar upp innehåll bakom Markpad-fönstret', 'Minskar distraktioner bakom fönstret'
	],
	vi: [
		'Tùy chỉnh ngôn ngữ, chủ đề và bề mặt ứng dụng', 'Tìm kiếm cài đặt...', 'Không tìm thấy cài đặt', 'Đặt lại mục', 'Giao diện', 'Cửa sổ Markpad', 'Hành vi', 'Cài đặt thanh công cụ',
		'Phông chữ văn bản xem trước', 'Phông chữ mã', 'Xem trước phông chữ trực tiếp', 'Xem trước văn bản Markpad', 'Xem trước phông chữ trình soạn thảo',
		'Bề mặt', 'Kiểu hiển thị cho toàn bộ ứng dụng', 'Đặc', 'Trong mờ', 'Độ mờ bề mặt', 'Làm mờ nền', 'Khả dụng với bề mặt trong mờ', 'Khả dụng khi độ mờ dưới 100%', 'Không khả dụng trên Linux vì Tauri không hỗ trợ hiệu ứng cửa sổ gốc', 'Làm tối nền',
		'Ngôn ngữ ứng dụng', 'Giao diện hiển thị', 'Sáng', 'Hệ thống', 'Tối',
		'Thanh công cụ trình soạn thảo', 'Thanh công cụ ứng dụng', 'Mã nội dòng', 'Khối mã', 'Trích dẫn', 'Tiêu đề 1', 'Tiêu đề 2', 'Tiêu đề 3', 'Danh sách dấu đầu dòng', 'Danh sách đánh số', 'Danh sách kiểm tra', 'Liên kết', 'Thanh công cụ',
		'Kiểm tra bản cập nhật…', 'Quay lại', 'Tiến', 'Tải lại từ đĩa', 'Độ trong suốt của cài đặt và trình soạn thảo', 'Làm dịu nội dung phía sau cửa sổ Markpad', 'Giảm sự phân tâm phía sau cửa sổ'
	],
	pt: [
		'Personalize o idioma, o tema e as superfícies da aplicação', 'Pesquisar definições...', 'Nenhuma definição encontrada', 'Repor secção', 'Interface', 'Janela do Markpad', 'Comportamento', 'Definições das barras de ferramentas',
		'Tipo de letra do texto de pré-visualização', 'Tipo de letra do código', 'Pré-visualização do tipo de letra em tempo real', 'Pré-visualização de texto do Markpad', 'Pré-visualização do tipo de letra do editor',
		'Superfície', 'Estilo visual de toda a aplicação', 'Sólida', 'Translúcida', 'Opacidade da superfície', 'Desfocagem do fundo', 'Disponível com a superfície translúcida', 'Disponível quando a opacidade é inferior a 100%', 'Indisponível no Linux porque o Tauri não suporta efeitos nativos de janela', 'Escurecimento do fundo',
		'Idioma da aplicação', 'Aspeto da interface', 'Claro', 'Sistema', 'Escuro',
		'Barra do editor', 'Barra da aplicação', 'Código em linha', 'Bloco de código', 'Citação', 'Título 1', 'Título 2', 'Título 3', 'Lista com marcas', 'Lista numerada', 'Lista de tarefas', 'Ligação', 'Barras de ferramentas',
		'Procurar atualizações…', 'Voltar', 'Avançar', 'Recarregar do disco', 'Transparência nas definições e no editor', 'Suaviza o conteúdo atrás da janela do Markpad', 'Reduz as distrações atrás da janela'
	],
	ro: [
		'Personalizează limba, tema și suprafețele aplicației', 'Caută setări...', 'Nu s-au găsit setări', 'Resetează secțiunea', 'Interfață', 'Fereastra Markpad', 'Comportament', 'Setări bare de instrumente',
		'Font pentru textul previzualizării', 'Font pentru cod', 'Previzualizare live a fontului', 'Previzualizare text Markpad', 'Previzualizare live a fontului editorului',
		'Suprafață', 'Stil vizual pentru întreaga aplicație', 'Solidă', 'Translucidă', 'Opacitatea suprafeței', 'Estomparea fundalului', 'Disponibil cu suprafața translucidă', 'Disponibil când opacitatea este sub 100%', 'Indisponibil în Linux deoarece Tauri nu acceptă efecte native pentru ferestre', 'Întunecarea fundalului',
		'Limba aplicației', 'Aspectul interfeței', 'Luminos', 'Sistem', 'Întunecat',
		'Bara editorului', 'Bara aplicației', 'Cod în linie', 'Bloc de cod', 'Citat', 'Titlu 1', 'Titlu 2', 'Titlu 3', 'Listă cu marcatori', 'Listă numerotată', 'Listă de verificare', 'Legătură', 'Bare de instrumente',
		'Caută actualizări…', 'Înapoi', 'Înainte', 'Reîncarcă de pe disc', 'Transparența setărilor și a editorului', 'Estompează conținutul din spatele ferestrei Markpad', 'Reduce distragerile din spatele ferestrei'
	],
	hu: [
		'A nyelv, a téma és az alkalmazásfelületek testreszabása', 'Beállítások keresése...', 'Nem található beállítás', 'Szakasz visszaállítása', 'Felület', 'Markpad ablak', 'Működés', 'Eszköztár-beállítások',
		'Előnézeti szöveg betűtípusa', 'Kód betűtípusa', 'Élő betűtípus-előnézet', 'Markpad szövegelőnézet', 'A szerkesztő betűtípusának élő előnézete',
		'Felületstílus', 'Az egész alkalmazás vizuális stílusa', 'Tömör', 'Áttetsző', 'Felület átlátszatlansága', 'Háttér elmosása', 'Az áttetsző felülettel érhető el', '100% alatti átlátszatlanságnál érhető el', 'Linuxon nem érhető el, mert a Tauri nem támogatja a natív ablakeffektusokat', 'Háttér sötétítése',
		'Alkalmazás nyelve', 'A felület megjelenése', 'Világos', 'Rendszer', 'Sötét',
		'Szerkesztő eszköztára', 'Alkalmazás eszköztára', 'Sorközi kód', 'Kódblokk', 'Idézet', 'Címsor 1', 'Címsor 2', 'Címsor 3', 'Felsorolás', 'Számozott lista', 'Ellenőrzőlista', 'Hivatkozás', 'Eszköztárak',
		'Frissítések keresése…', 'Vissza', 'Előre', 'Újratöltés lemezről', 'A beállítások és a szerkesztő átlátszósága', 'Lágyítja a Markpad ablak mögötti tartalmat', 'Csökkenti az ablak mögötti zavaró elemeket'
	],
	cs: [
		'Přizpůsobte jazyk, motiv a povrchy aplikace', 'Hledat v nastavení...', 'Nebyla nalezena žádná nastavení', 'Obnovit sekci', 'Rozhraní', 'Okno Markpad', 'Chování', 'Nastavení panelů nástrojů',
		'Písmo textu náhledu', 'Písmo kódu', 'Živý náhled písma', 'Náhled textu Markpad', 'Živý náhled písma editoru',
		'Povrch', 'Vizuální styl celé aplikace', 'Plný', 'Průsvitný', 'Krytí povrchu', 'Rozostření pozadí', 'Dostupné s průsvitným povrchem', 'Dostupné při krytí pod 100 %', 'V Linuxu není dostupné, protože Tauri nepodporuje nativní efekty oken', 'Ztmavení pozadí',
		'Jazyk aplikace', 'Vzhled rozhraní', 'Světlý', 'Systém', 'Tmavý',
		'Panel editoru', 'Panel aplikace', 'Vložený kód', 'Blok kódu', 'Citace', 'Nadpis 1', 'Nadpis 2', 'Nadpis 3', 'Seznam s odrážkami', 'Číslovaný seznam', 'Kontrolní seznam', 'Odkaz', 'Panely nástrojů',
		'Zkontrolovat aktualizace…', 'Zpět', 'Vpřed', 'Znovu načíst z disku', 'Průhlednost nastavení a editoru', 'Zjemní obsah za oknem Markpad', 'Omezuje rušivé prvky za oknem'
	],
	sk: [
		'Prispôsobte jazyk, tému a povrchy aplikácie', 'Hľadať v nastaveniach...', 'Nenašli sa žiadne nastavenia', 'Obnoviť sekciu', 'Rozhranie', 'Okno Markpad', 'Správanie', 'Nastavenia panelov nástrojov',
		'Písmo textu náhľadu', 'Písmo kódu', 'Živý náhľad písma', 'Náhľad textu Markpad', 'Živý náhľad písma editora',
		'Povrch', 'Vizuálny štýl celej aplikácie', 'Plný', 'Priesvitný', 'Krytie povrchu', 'Rozostrenie pozadia', 'Dostupné s priesvitným povrchom', 'Dostupné pri krytí pod 100 %', 'V Linuxe nie je dostupné, pretože Tauri nepodporuje natívne efekty okien', 'Stmavenie pozadia',
		'Jazyk aplikácie', 'Vzhľad rozhrania', 'Svetlý', 'Systém', 'Tmavý',
		'Panel editora', 'Panel aplikácie', 'Vložený kód', 'Blok kódu', 'Citácia', 'Nadpis 1', 'Nadpis 2', 'Nadpis 3', 'Zoznam s odrážkami', 'Číslovaný zoznam', 'Kontrolný zoznam', 'Odkaz', 'Panely nástrojov',
		'Skontrolovať aktualizácie…', 'Späť', 'Dopredu', 'Znova načítať z disku', 'Priehľadnosť nastavení a editora', 'Zjemní obsah za oknom Markpad', 'Obmedzuje rušivé prvky za oknom'
	],
	el: [
		'Προσαρμόστε τη γλώσσα, το θέμα και τις επιφάνειες της εφαρμογής', 'Αναζήτηση ρυθμίσεων...', 'Δεν βρέθηκαν ρυθμίσεις', 'Επαναφορά ενότητας', 'Διεπαφή', 'Παράθυρο Markpad', 'Συμπεριφορά', 'Ρυθμίσεις γραμμών εργαλείων',
		'Γραμματοσειρά κειμένου προεπισκόπησης', 'Γραμματοσειρά κώδικα', 'Ζωντανή προεπισκόπηση γραμματοσειράς', 'Προεπισκόπηση κειμένου Markpad', 'Ζωντανή προεπισκόπηση γραμματοσειράς επεξεργαστή',
		'Επιφάνεια', 'Οπτικό στυλ για ολόκληρη την εφαρμογή', 'Συμπαγής', 'Ημιδιαφανής', 'Αδιαφάνεια επιφάνειας', 'Θόλωση φόντου', 'Διαθέσιμο με την ημιδιαφανή επιφάνεια', 'Διαθέσιμο όταν η αδιαφάνεια είναι κάτω από 100%', 'Δεν διατίθεται στο Linux επειδή το Tauri δεν υποστηρίζει εγγενή εφέ παραθύρου', 'Σκοτείνιασμα φόντου',
		'Γλώσσα εφαρμογής', 'Εμφάνιση διεπαφής', 'Φωτεινό', 'Σύστημα', 'Σκοτεινό',
		'Γραμμή εργαλείων επεξεργαστή', 'Γραμμή εργαλείων εφαρμογής', 'Ενσωματωμένος κώδικας', 'Μπλοκ κώδικα', 'Παράθεση', 'Επικεφαλίδα 1', 'Επικεφαλίδα 2', 'Επικεφαλίδα 3', 'Λίστα με κουκκίδες', 'Αριθμημένη λίστα', 'Λίστα ελέγχου', 'Σύνδεσμος', 'Γραμμές εργαλείων',
		'Έλεγχος για ενημερώσεις…', 'Πίσω', 'Μπροστά', 'Επαναφόρτωση από τον δίσκο', 'Διαφάνεια ρυθμίσεων και επεξεργαστή', 'Απαλύνει το περιεχόμενο πίσω από το παράθυρο Markpad', 'Μειώνει τους περισπασμούς πίσω από το παράθυρο'
	],
	fi: [
		'Mukauta kieltä, teemaa ja sovelluksen pintoja', 'Hae asetuksia...', 'Asetuksia ei löytynyt', 'Palauta osio', 'Käyttöliittymä', 'Markpad-ikkuna', 'Toiminta', 'Työkalupalkkien asetukset',
		'Esikatselutekstin fontti', 'Koodifontti', 'Fontin reaaliaikainen esikatselu', 'Markpad-tekstin esikatselu', 'Editorin fontin reaaliaikainen esikatselu',
		'Pinta', 'Koko sovelluksen visuaalinen tyyli', 'Kiinteä', 'Läpikuultava', 'Pinnan peittävyys', 'Taustan sumennus', 'Käytettävissä läpikuultavalla pinnalla', 'Käytettävissä, kun peittävyys on alle 100 %', 'Ei käytettävissä Linuxissa, koska Tauri ei tue järjestelmän omia ikkunatehosteita', 'Taustan tummennus',
		'Sovelluksen kieli', 'Käyttöliittymän ulkoasu', 'Vaalea', 'Järjestelmä', 'Tumma',
		'Editorin työkalupalkki', 'Sovelluksen työkalupalkki', 'Rivikoodi', 'Koodilohko', 'Lainaus', 'Otsikko 1', 'Otsikko 2', 'Otsikko 3', 'Luettelomerkkiluettelo', 'Numeroitu luettelo', 'Tarkistuslista', 'Linkki', 'Työkalupalkit',
		'Tarkista päivitykset…', 'Takaisin', 'Eteenpäin', 'Lataa uudelleen levyltä', 'Asetusten ja editorin läpinäkyvyys', 'Pehmentää Markpad-ikkunan takana olevaa sisältöä', 'Vähentää häiriötekijöitä ikkunan takana'
	],
	da: [
		'Tilpas sprog, tema og appflader', 'Søg i indstillinger...', 'Ingen indstillinger fundet', 'Nulstil sektion', 'Brugerflade', 'Markpad-vindue', 'Adfærd', 'Indstillinger for værktøjslinjer',
		'Skrifttype til forhåndsvisning', 'Skrifttype til kode', 'Direkte skrifttypevisning', 'Forhåndsvisning af Markpad-tekst', 'Direkte visning af editorens skrifttype',
		'Flade', 'Visuel stil for hele appen', 'Massiv', 'Gennemsigtig', 'Fladens opacitet', 'Sløring af baggrund', 'Tilgængelig med gennemsigtig flade', 'Tilgængelig når opaciteten er under 100 %', 'Ikke tilgængelig på Linux, fordi Tauri ikke understøtter indbyggede vindueseffekter', 'Dæmpning af baggrund',
		'Appens sprog', 'Brugerfladens udseende', 'Lys', 'System', 'Mørk',
		'Editorens værktøjslinje', 'Appens værktøjslinje', 'Indlejret kode', 'Kodeblok', 'Citat', 'Overskrift 1', 'Overskrift 2', 'Overskrift 3', 'Punktopstilling', 'Nummereret liste', 'Tjekliste', 'Link', 'Værktøjslinjer',
		'Søg efter opdateringer…', 'Tilbage', 'Frem', 'Genindlæs fra disk', 'Gennemsigtighed for indstillinger og editor', 'Blødgør indholdet bag Markpad-vinduet', 'Reducerer forstyrrelser bag vinduet'
	],
	no: [
		'Tilpass språk, tema og appflater', 'Søk i innstillinger...', 'Fant ingen innstillinger', 'Tilbakestill del', 'Grensesnitt', 'Markpad-vindu', 'Atferd', 'Innstillinger for verktøylinjer',
		'Skrift for forhåndsvisning', 'Kodeskrift', 'Direkte forhåndsvisning av skrift', 'Forhåndsvisning av Markpad-tekst', 'Direkte forhåndsvisning av redigeringsskrift',
		'Flate', 'Visuell stil for hele appen', 'Heldekkende', 'Gjennomskinnelig', 'Flatens gjennomsiktighet', 'Bakgrunnsuskarphet', 'Tilgjengelig med gjennomskinnelig flate', 'Tilgjengelig når gjennomsiktigheten er under 100 %', 'Ikke tilgjengelig på Linux fordi Tauri ikke støtter innebygde vinduseffekter', 'Bakgrunnsdemping',
		'Appens språk', 'Grensesnittets utseende', 'Lys', 'System', 'Mørk',
		'Redigeringsverktøylinje', 'Appverktøylinje', 'Innebygd kode', 'Kodeblokk', 'Sitat', 'Overskrift 1', 'Overskrift 2', 'Overskrift 3', 'Punktliste', 'Nummerert liste', 'Sjekkliste', 'Lenke', 'Verktøylinjer',
		'Se etter oppdateringer…', 'Tilbake', 'Frem', 'Last inn på nytt fra disk', 'Gjennomsiktighet for innstillinger og redigering', 'Myker opp innholdet bak Markpad-vinduet', 'Reduserer distraksjoner bak vinduet'
	],
	id: [
		'Sesuaikan bahasa, tema, dan permukaan aplikasi', 'Cari pengaturan...', 'Pengaturan tidak ditemukan', 'Atur ulang bagian', 'Antarmuka', 'Jendela Markpad', 'Perilaku', 'Pengaturan bilah alat',
		'Font teks pratinjau', 'Font kode', 'Pratinjau font langsung', 'Pratinjau teks Markpad', 'Pratinjau langsung font editor',
		'Permukaan', 'Gaya visual untuk seluruh aplikasi', 'Padat', 'Tembus cahaya', 'Opasitas permukaan', 'Keburaman latar', 'Tersedia dengan permukaan tembus cahaya', 'Tersedia saat opasitas di bawah 100%', 'Tidak tersedia di Linux karena Tauri tidak mendukung efek jendela asli', 'Peredupan latar',
		'Bahasa aplikasi', 'Tampilan antarmuka', 'Terang', 'Sistem', 'Gelap',
		'Bilah alat editor', 'Bilah alat aplikasi', 'Kode sebaris', 'Blok kode', 'Kutipan', 'Judul 1', 'Judul 2', 'Judul 3', 'Daftar berpoin', 'Daftar bernomor', 'Daftar periksa', 'Tautan', 'Bilah alat',
		'Periksa pembaruan…', 'Kembali', 'Maju', 'Muat ulang dari disk', 'Transparansi pengaturan dan editor', 'Memperhalus konten di belakang jendela Markpad', 'Mengurangi gangguan di belakang jendela'
	],
	tr: [
		'Dili, temayı ve uygulama yüzeylerini özelleştirin', 'Ayarlarda ara...', 'Ayar bulunamadı', 'Bölümü sıfırla', 'Arayüz', 'Markpad penceresi', 'Davranış', 'Araç çubuğu ayarları',
		'Önizleme metni yazı tipi', 'Kod yazı tipi', 'Canlı yazı tipi önizlemesi', 'Markpad metin önizlemesi', 'Canlı düzenleyici yazı tipi önizlemesi',
		'Yüzey', 'Tüm uygulamanın görsel stili', 'Düz', 'Yarı saydam', 'Yüzey opaklığı', 'Arka plan bulanıklığı', 'Yarı saydam yüzeyle kullanılabilir', 'Yüzey opaklığı %100’ün altındayken kullanılabilir', 'Tauri yerel pencere efektlerini desteklemediğinden Linux’ta kullanılamaz', 'Arka plan karartması',
		'Uygulama dili', 'Arayüz görünümü', 'Açık', 'Sistem', 'Koyu',
		'Düzenleyici araç çubuğu', 'Uygulama araç çubuğu', 'Satır içi kod', 'Kod bloğu', 'Alıntı', 'Başlık 1', 'Başlık 2', 'Başlık 3', 'Madde işaretli liste', 'Numaralı liste', 'Kontrol listesi', 'Bağlantı', 'Araç çubukları',
		'Güncellemeleri denetle…', 'Geri', 'İleri', 'Diskten yeniden yükle', 'Ayarların ve düzenleyicinin şeffaflığı', 'Markpad penceresinin arkasındaki içeriği yumuşatır', 'Pencerenin arkasındaki dikkat dağıtıcı öğeleri azaltır'
	]
};
