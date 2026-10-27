import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let dates, model;
try {
  dates = await server.ssrLoadModule("/src/lib/lifeDates.ts");
  model = await server.ssrLoadModule("/src/lib/model.ts");
} finally {
  await server.close();
}

test("calendar dates reject invalid days and support leap years and early years", () => {
  assert.equal(dates.normalizeLifeDate("2000-02-29"), "2000-02-29");
  assert.equal(dates.normalizeLifeDate("1900-02-29"), undefined);
  assert.equal(dates.normalizeLifeDate("2024-04-31"), undefined);
  assert.equal(dates.normalizeLifeDate("0001-01-01"), "0001-01-01");
  for (const value of ["0000-01-01", "2024-13-01", "2024-2-1", "", null, {}]) {
    assert.equal(dates.normalizeLifeDate(value), undefined);
  }
});

test("optional dates and chronology", () => {
  assert.equal(dates.lifeDateError("", ""), undefined);
  assert.equal(dates.lifeDateError("", "1980-01-01"), undefined);
  assert.equal(dates.lifeDateError("1980-01-01", "1980-01-01"), undefined);
  assert.equal(dates.lifeDateError("1980-01-02", "1980-01-01"), "deathBeforeBirth");
  assert.equal(dates.lifeDateError("1980-02-30", ""), "invalidLifeDate");
  assert.deepEqual(dates.personLifeDates({ birth_date: "1940-02-29", death_date: "2005-08-03" }),
    ["° 29.02.1940", "† 03.08.2005"]);
  assert.deepEqual(dates.personLifeDates({}), []);
});

test("dates survive local persistence, cloud payloads and exported/imported workspaces", () => {
  const family = model.createFamily("Test");
  family.persons.person = { name: "Test", family_name: "Person", labels: [], birth_date: "1940-02-29", death_date: "2005-08-03" };
  const payload = model.familyToPayload(family);
  assert.equal(payload.persons.person.birth_date, "1940-02-29");
  const cloud = model.familyFromRow(family.id, family.name, payload);
  assert.equal(cloud.persons.person.death_date, "2005-08-03");
  assert.equal(model.familyForLocalStore(cloud).persons.person.birth_date, "1940-02-29");
  const imported = model.workspaceFromFile(model.workspaceToFile([family], family.id));
  assert.ok(imported.families.some(f => Object.values(f.persons).some(p => p.death_date === "2005-08-03")));
  const old = model.familyFromRow("old", "Old", { persons: { person: { name: "Old", family_name: "", labels: [] } } });
  assert.equal(old.persons.person.birth_date, undefined);
});
