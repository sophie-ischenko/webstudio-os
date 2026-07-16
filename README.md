# Studio OS

Lokaler Arbeitsraum für Webdesignerinnen — Projektmanagement, Finanzen, Zeiterfassung und Social-Media-Planung in einer Desktop-App.

**Stack:** Electron · React · TypeScript · Vite · Tailwind CSS · SQLite (better-sqlite3)

Single-User, lokal, kein Cloud-Sync. Alle Daten liegen in einer SQLite-Datei im Benutzerordner.

---

## Voraussetzungen

- **Node.js** ≥ 18 — [nodejs.org](https://nodejs.org)
- **Python** (für das Kompilieren von `better-sqlite3` beim ersten `npm install`)
- **Build-Tools** je nach Plattform:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Visual Studio Build Tools (C++ Workload) oder `npm install --global windows-build-tools`
  - **Linux:** `build-essential`, `python3`

---

## Installation & Start

```bash
# 1. Abhängigkeiten installieren (kompiliert better-sqlite3 nativ)
npm install

# 2. App im Browser testen (UI-Modus, ohne echte Datenbank)
npm run dev
#    → öffnet http://localhost:5173
#    → Daten sind In-Memory, werden beim Neuladen zurückgesetzt

# 3. Echte Desktop-App mit SQLite starten
npm run dev:electron
#    → baut React (vite build) + startet Electron
#    → beim ersten Start wird die SQLite-DB im Benutzerordner angelegt
#    → Schema + Standard-Phasen-Vorlage werden automatisch initialisiert
```

Die Datenbankdatei liegt unter:
- **macOS:** `~/Library/Application Support/studio-os/studio-os.db`
- **Windows:** `%APPDATA%/studio-os/studio-os.db`
- **Linux:** `~/.config/studio-os/studio-os.db`

---

## Installierbare App bauen (Export als .app / .exe / AppImage)

Um eine verteilbare, installierbare Desktop-App zu erzeugen:

```bash
npm run build:electron
```

Das verwendet `electron-builder` und erzeugt im Ordner `release/`:

| Plattform | Output | Datei |
|-----------|--------|-------|
| **macOS** | `.dmg` | `release/Studio OS-1.0.0.dmg` |
| **Windows** | NSIS-Installer | `release/Studio OS Setup 1.0.0.exe` |
| **Linux** | AppImage | `release/Studio OS-1.0.0.AppImage` |

Die fertige Datei kann normal installiert und gestartet werden — wie jede andere Desktop-App. Kein Node.js nötig auf dem Zielrechner.

> **Hinweis:** Für plattformübergreifende Builds (z.B. Windows-Installer auf macOS bauen) brauchst du zusätzliche Setup. Am einfachsten: auf der jeweiligen Zielplattform bauen, oder CI (GitHub Actions) nutzen.

---

## Daten exportieren

In der App unter **Einstellungen → Daten exportieren**:

- **CSV-Export** — einzelne Tabellen (Projekte, Buchungen, Rechnungen, Zeiterfassung, Social Posts) als `.csv`-Datei zum Öffnen in Excel/Numbers
- **JSON-Komplett-Export** — alle Tabellen als eine `.json`-Datei (vollständiges Backup der Datenstruktur)
- **SQLite-Backup** — kopiert die rohe Datenbankdatei an einen wählbaren Ort (nur in Electron)

Exporte laufen im Renderer und nutzen den Browser-Download — keine zusätzliche IPC-Schicht nötig.

---

## Module

| Modul | View | Funktionen |
|-------|------|-----------|
| **Dashboard** | DashboardView | KPIs, aktive Projekte, Cashflow, Deadlines, Live-Timer-Banner |
| **Projekte** | ProjectsView | Listen + Detail, Phasen mit Checkliste, Assets, Notizen, Phasen-Vorlagen |
| **Zeiterfassung** | TimeView | Live-Timer, Wochenübersicht mit Balkendiagramm, manuelle Buchungen |
| **Finanzen** | FinancesView | Cashflow (kurz), Pipeline/Angebote (mittel), Jahresziele (lang) |
| **Kalkulation** | CalculatorView | Stundensatz-Wizard mit Live-Berechnung + Historie |
| **Rechnungen** | InvoicesView | Offene Forderungen, Überfälligkeits-Erkennung, Status-Wechsel |
| **Social Planer** | SocialView | Wochen-, Monats- und Listenansicht, Post-Detail mit Assets + Zeiterfassung |
| **Vorlagen** | TemplatesView | Phasen-Vorlagen anlegen/bearbeiten, Phasen + Checklist-Items verwalten |
| **Einstellungen** | SettingsView | Währung, Geschäftsjahr, Plattformen/Formate, Export, Backup |

---

## Phasen-Vorlagen einrichten

Unter **Vorlagen** in der Sidebar:

1. **Neue Vorlage** anlegen (Name + Beschreibung)
2. Vorlage öffnen → **Phasen hinzufügen** (z.B. "Konzept", "Design", "Entwicklung")
3. Pro Phase **Checklist-Items** definieren (z.B. "Moodboard", "Wireframes", "Freigabe")
4. Beim **Anlegen eines neuen Projekts** kann die Vorlage ausgewählt werden — die Phasen werden als Startpunkt ins Projekt kopiert

Die mitgelieferte "Standard Website-Projekt"-Vorlage ist eine System-Vorlage (nicht löschbar). Eigene Vorlagen können bearbeitet und gelöscht werden.

---

## Eigene Plattformen & Formate

Unter **Einstellungen**:

- **Social-Media-Plattformen** — eigene Plattformen hinzufügen (z.B. "threads", "mastodon")
- **Post-Formate** — eigene Formate ergänzen (z.B. "live_stream", "podcast")

Diese stehen dann in den Dropdowns des Social Planers zur Auswahl. Standardmäßig sind instagram, linkedin, tiktok, twitter, youtube, pinterest, facebook sowie carousel, reel, story, single_image, text, video, short vorausgefüllt.

---

## Architektur

```
project/
├── electron/
│   ├── main.cjs        # Electron main process: Fenster, SQLite, IPC
│   ├── preload.cjs     # Sichere Bridge: window.studio API
│   └── schema.sql      # SQLite-Schema (wird beim ersten Start ausgeführt)
├── src/
│   ├── App.tsx          # Root: Sidebar + View-Routing
│   ├── types.ts         # TypeScript-Typen für alle Tabellen
│   ├── lib/
│   │   ├── db.ts        # DB-Service-Layer (IPC-Wrapper + Mock + Export)
│   │   ├── format.ts    # Geld/Datum/Zeit-Formatierung
│   │   └── timer.ts     # Live-Timer (Singleton, modulübergreifend)
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   └── ui.tsx       # Modal, Badge, EmptyState, Field, etc.
│   └── views/
│       ├── DashboardView.tsx
│       ├── ProjectsView.tsx
│       ├── TimeView.tsx
│       ├── FinancesView.tsx
│       ├── CalculatorView.tsx
│       ├── InvoicesView.tsx
│       ├── SocialView.tsx
│       ├── TemplatesView.tsx
│       └── SettingsView.tsx
└── vite.config.ts       # Baut React + kopiert Electron-Dateien nach dist-electron/
```

### Datenfluss

```
React (Renderer)  →  window.studio.db.*  →  IPC  →  Electron Main  →  better-sqlite3
```

Im Browser-Modus (ohne Electron) greift ein In-Memory-Mock in `src/lib/db.ts`.

---

## Datenbank

- **Format:** SQLite, eine Datei im Benutzerordner
- **Schema:** siehe `electron/schema.sql`
- **IDs:** UUID v4 (TEXT)
- **Geld:** INTEGER in Cent
- **Zeit:** TEXT im ISO-8601-Format
- **Initialisierung:** Beim ersten Start wird `schema.sql` ausgeführt + eine Standard-Phasen-Vorlage angelegt
- **Backup:** Über Einstellungen → "Backup erstellen"

---

## Hinweise

- Die App ist **Single-User** — keine Authentifizierung, keine Mandantentrennung.
- Kein Cloud-Sync. Daten bleiben lokal auf diesem Gerät.
- Phasen-Vorlagen sind live verlinkt: Änderungen an einer Vorlage wirken auf alle verknüpften Projekte, der Projekt-Fortschritt bleibt aber erhalten.
- Plattformen und Formate sind konfigurierbar — eigene Einträge werden in `app_settings` als JSON gespeichert.
# webstudio-os
