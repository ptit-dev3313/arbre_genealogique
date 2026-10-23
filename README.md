# Arbre généalogique

Éditeur React + TypeScript : plusieurs familles et arbres, photos, import/export ZIP et PDF. La sauvegarde locale fonctionne sans compte ; Supabase permet la synchronisation et le partage entre comptes autorisés.

## Développement

Node.js 24 et npm sont recommandés.

```sh
npm ci
npm run dev
```

Pour activer la synchronisation, copiez `.env.example` en `.env.local` et renseignez l’URL du projet et sa clé **publishable**. Sans configuration valide, l’éditeur reste local. Aucun identifiant de production n’est fourni dans les sources.

```sh
npm run check:config
npm run build
npm run preview
npm audit --audit-level=high
```

## GitHub Pages

Le workflow `.github/workflows/deploy.yml` construit `dist/` et le déploie avec les actions officielles GitHub Pages. Le chemin des ressources vient de la configuration Pages ; il fonctionne aussi avec le sous-dossier du dépôt. Le déploiement est réservé au dépôt public, car l’offre GitHub actuelle de ce projet ne permet pas Pages sur un dépôt privé. Les contrôles CI fonctionnent aussi sur le dépôt privé.

Dans **Settings → Pages**, sélectionnez **GitHub Actions**. Dans **Settings → Secrets and variables → Actions → Variables**, renseignez :

| Variable | Valeur |
| --- | --- |
| `VITE_SUPABASE_URL` | URL HTTPS du projet Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé `sb_publishable_…` |

Ces deux valeurs sont publiques dans le JavaScript téléchargé par le navigateur. Ne fournissez jamais une clé `service_role`, `sb_secret_…`, un mot de passe ou un jeton administrateur à Vite. Le déploiement refuse les autres formats de clé. Les dépendances et TypeScript sont vérifiés avant déploiement ; les actions sont fixées à un commit précis.

Adresse prévue : https://ptit-dev3313.github.io/arbre_genealogique_privee/

Dans **Supabase → Authentication → URL Configuration**, définissez cette adresse complète comme **Site URL** et comme URL de redirection autorisée. Ajoutez `http://localhost:5173/` pour le développement. Les liens d’inscription et de réinitialisation conservent le sous-dossier du site.

Le changement de domaine crée un nouveau stockage navigateur. **Exportez les arbres uniquement locaux en ZIP depuis l’ancien site avant de migrer**, puis importez-les sur la nouvelle adresse. Les familles synchronisées restent dans Supabase.

## Données et accès

- Sans compte : arbres conservés dans le `localStorage` de cet appareil.
- Avec compte : **Partager → Enregistrer en ligne** enregistre une famille dans Supabase.
- Le propriétaire invite des comptes existants et attribue les arbres éditables.
- Les membres voient la famille partagée ; les droits par arbre limitent les modifications, pas la lecture des personnes du carnet commun.
- Seuls les e-mails ajoutés par un administrateur à `allowed_emails` peuvent créer un compte. La restriction est imposée par un déclencheur sur `auth.users`.
- Les sauvegardes passent par les fonctions SQL, qui vérifient l’utilisateur, l’appartenance, les droits et le verrou d’édition.
- Les photos sont des JPEG dans un bucket privé ; les accès en écriture dépendent des droits de la personne et de l’arbre.
- Les données locales et les exports restent lisibles par les personnes ayant accès à l’appareil ou au fichier. Se déconnecter ne supprime pas les arbres locaux.

## Administration Supabase

`supabase/migrations/` contient les corrections incrémentales appliquées au projet existant, **pas une installation complète de son schéma**. Ne les utilisez pas seules pour initialiser une nouvelle base.

- `supabase/audit/security.sql` : inspection en lecture seule des règles et privilèges.
- `supabase/tests/access.sql` : tests avec comptes et familles fictifs, entièrement annulés par `ROLLBACK`.
- `SECURITY.md` : bilan des vérifications et limites restantes.

Les résultats d’audit, sauvegardes, fichiers `.env.local` et exports familiaux doivent rester hors du dépôt public.
