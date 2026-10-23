import { personLabel } from "../lib/model";
import { useApp } from "../store";

export function PersonFace({
  person,
  showPhoto,
  mini,
}: {
  person?: { name: string; family_name: string; photo?: { path?: string; data?: string } };
  showPhoto?: boolean;
  mini?: boolean;
}) {
  const urls = useApp((s) => s.photoUrls);
  if (!person || !showPhoto) return null;
  const src = person.photo?.data ?? (person.photo?.path ? urls[person.photo.path] : undefined);
  if (!src) return null;
  return <img className={`person-photo${mini ? " mini" : ""}`} src={src} alt={personLabel({ ...person, labels: [] })} />;
}
