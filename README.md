# Arbre généalogique

Application desktop en **Rust** pour dessiner un arbre généalogique : personnes, couples, enfants, placement sur grille, et export PDF.

Les builds officiels ciblent **Windows** et **Linux** (x86_64). macOS n’est pas publié pour le moment.

## Aperçu

<!-- PLACEHOLDER: ajouter ici une capture d’écran de l’application
     (panneau Famille à gauche, arbre sur grille à droite).
     Exemple une fois le fichier prêt :

     ![Aperçu de l’application](docs/apercu.png)
-->

*Capture d’écran à venir.*

## Télécharger

Les binaires sont publiés sur la page [Releases](../../releases) à chaque tag `vX.Y.Z`.

| Plateforme | Archive |
| --- | --- |
| Windows x86_64 | `arbre_genealogique-windows-x86_64.zip` |
| Linux x86_64 | `arbre_genealogique-linux-x86_64.tar.gz` |

Dézippez, puis lancez `arbre_genealogique.exe` (Windows) ou `./arbre_genealogique` (Linux).

## Données

L’arbre est enregistré dans le dossier de données utilisateur, pas à côté de l’exécutable :

| Système | Fichier |
| --- | --- |
| Windows | `%APPDATA%\arbre_genealogique\data.json` |
| Linux | `~/.local/share/arbre_genealogique/data.json` |

Le dossier est créé au premier enregistrement. Un ancien `data.json` présent dans le répertoire de lancement, à côté du binaire, ou dans l’ancien dossier `family-tree`, est copié automatiquement si le fichier d’application n’existe pas encore.

## Utilisation

- Ajoutez des personnes dans le panneau gauche, puis placez-les sur la grille.
- Reliez deux personnes pour former un couple, choisissez le statut, ajoutez des enfants.
- **Sauvegarder** écrit `data.json` dans le dossier ci-dessus.
- **Exporter en PDF** ouvre un sélecteur de fichier.

Ligne de commande (export sans fenêtre) :

```bash
arbre_genealogique --export arbre.pdf
```

## Compiler depuis les sources

Rust stable (édition 2021) est requis.

```bash
git clone <url-du-depot>
cd arbre_genealogique
cargo run --release
```

Sous Linux, installez aussi les dépendances de fenêtre / GTK utilisées par l’UI :

```bash
sudo apt-get install -y pkg-config libgtk-3-dev libxkbcommon-dev \
  libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libegl1-mesa-dev libgl1-mesa-dev
```

## Publier une version

1. Alignez `version` dans `Cargo.toml` (exemple : `0.2.0`).
2. Committez, puis créez un tag **identique** :

```bash
git tag v0.2.0
git push origin v0.2.0
```

Le workflow GitHub Actions compile Windows et Linux, calcule les checksums, et crée la release GitHub avec les archives.
