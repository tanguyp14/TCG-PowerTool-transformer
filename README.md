# CSV Powertool Transformer — Gestion TCG & Traitement CSV

Outil desktop (Electron) pour gérer des bases de données d'extensions de jeux de cartes (Pokémon, Yu-Gi-Oh!, etc.) et traiter des exports CSV Cardmarket.

## Structure du projet

```
csv-tool/
├── package.json            # Config npm + electron-builder
├── README.md
├── src/
│   ├── main.js             # Process principal Electron (filesystem)
│   └── preload.js          # Bridge sécurisé main ↔ renderer
├── app/
│   ├── index.html          # Page HTML
│   ├── app.js              # Logique de l'interface (vanilla JS)
│   └── database/           # ← Bases de données JSON (1 fichier par jeu)
│       ├── games.json      # Manifeste des jeux
│       └── pokemon.json    # Base Pokémon
└── build/                  # Icônes pour le build (optionnel)
```

## Installation

```bash
# Installer les dépendances
npm install

# Lancer l'app en dev
npm start
```

## Build (distribution)

```bash
# Windows (.exe installeur + portable)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux

# Tout d'un coup
npm run build:all
```

Les fichiers générés seront dans le dossier `dist/`.

## Fonctionnalités

### Base de données
- **1 fichier JSON par jeu** dans `app/database/`
- Ajout/suppression de jeux → crée/supprime le fichier automatiquement
- Édition des extensions (setCode, nom, date de sortie) → sauvegarde auto dans le JSON
- Import de fichiers `.json` existants
- Bouton "📁 Dossier DB" pour voir le chemin du dossier

### Traitement CSV
1. Importer un export Cardmarket (.csv)
2. Sélectionner les colonnes (prix, comment, setCode, cn)
3. **Prix** : arrondi au 0.50 le plus proche (seuil à .25/.75)
4. **Comment** : rempli avec `DATE - CODE-CN` depuis la base
5. Télécharger le CSV traité

### Arrondi du prix
| Prix original | Résultat |
|---------------|----------|
| 1.24          | 1.00     |
| 1.25          | 1.50     |
| 1.74          | 1.50     |
| 1.75          | 2.00     |
| 3.50          | 3.50     |

## Ajouter un nouveau jeu manuellement

Créer un fichier dans `app/database/`, par exemple `yugioh.json` :

```json
[
  { "setCode": "LOB", "name": "Legend of Blue Eyes", "releaseDate": "08-03-2002" },
  { "setCode": "MRD", "name": "Metal Raiders", "releaseDate": "26-06-2002" }
]
```

Puis ajouter l'entrée dans `app/database/games.json` :

```json
[
  { "name": "Pokémon", "file": "pokemon.json" },
  { "name": "Yu-Gi-Oh!", "file": "yugioh.json" }
]
```

Ou plus simplement : utiliser le bouton **"+ Nouveau jeu"** dans l'app, tout est fait automatiquement.
# TCG-PowerTool-transformer
