# Sécurité

## Vérification du 23 octobre 2026

L’audit porte sur les sources, l’historique Git accessible et le projet Supabase utilisé par cette application. Il ne constitue pas une garantie d’absence de toute vulnérabilité.

### Corrections appliquées

- Suppression de la configuration de déploiement Cloudflare et des fichiers Cursor.
- Retrait des identifiants Supabase intégrés aux sources ; configuration par variables publiques de déploiement.
- Refus des clés secrètes et des anciennes clés JWT dans la configuration du navigateur.
- Suppression des autorisations directes INSERT/UPDATE sur les familles et les appartenances : elles permettaient de contourner les contrôles des fonctions métier.
- Suppression des accès anonymes aux tables métier et aux fonctions publiques/privées.
- Attribution explicite des fonctions nécessaires aux comptes authentifiés ; restriction des privilèges par défaut.
- Restriction des écritures de photos aux propriétaires et aux éditeurs autorisés pour la personne concernée. Un éditeur avec des arbres attribués peut téléverser une nouvelle photo avant l’enregistrement de la personne.
- Mise à jour du fichier de dépendances verrouillées : `npm audit` ne signale aucune vulnérabilité connue au moment du contrôle.

### Contrôles effectués

- RLS activée sur les trois tables métier.
- Liste des e-mails autorisés inaccessible aux clients ; le déclencheur d’inscription refuse les e-mails absents de cette liste.
- Bucket `person-photos` privé, JPEG uniquement, taille serveur limitée à 200 000 octets.
- Tests SQL propriétaire/éditeur/non-membre : lecture isolée, sauvegarde avec verrou, refus de modification directe, invitations réservées au propriétaire, protection des personnes hors des arbres attribués, droits sur les photos et refus d’inscription non autorisée. Les données fictives sont annulées à la fin.
- Scan Gitleaks de l’ancien historique : quatre alertes correspondant à la clé publishable et aux anciennes clés JWT de rôle `anon`. Aucun secret administrateur reconnu n’a été détecté. Un scan ne peut pas détecter tous les formats possibles de secret.
- Compilation TypeScript et Vite vérifiée avec le sous-chemin GitHub Pages.

### Points à maintenir

- Supabase signale que la protection contre les mots de passe compromis est désactivée. L’activer dans **Authentication → Settings → Password security** si l’offre du projet le permet : https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Vérifier **Site URL** et la liste des redirections autorisées dans Supabase lors de tout changement de domaine. Les outils SQL ne permettent pas de modifier ces réglages Auth.
- L’information « RLS activée sans politique » sur `allowed_emails` est volontaire : aucun client ne doit lire cette table.
- Les URL signées de photos expirent après sept jours. Une URL déjà délivrée reste utilisable jusqu’à son expiration, même après révocation du partage.
- Les membres lisent l’ensemble du carnet de leur famille ; les droits par arbre concernent l’édition. Les sauvegardes locales persistent sur l’appareil.
- Si un véritable secret a été partagé ailleurs, le révoquer chez son fournisseur. Nettoyer Git ne révoque pas une clé et ne supprime pas les clones existants ni les caches GitHub.

Ne publiez jamais de sauvegarde Git, de rapport brut d’audit ou d’export de données familiales dans ce dépôt.
