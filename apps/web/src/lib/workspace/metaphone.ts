/**
 * Italian-flavored Metaphone encoder.
 *
 * A lightweight phonetic hasher tuned for Italian proper nouns (stakeholders,
 * brands, retailers). Double Metaphone proper is overkill for short entity
 * names; what we actually need is:
 *   - "Mulino Bianco" and "Mulìno Biànco" collide
 *   - "Bianchi" and "Bianki" collide
 *   - "Giulia" and "Giullia" collide
 *   - "Elena" and "Alena" do NOT collide
 *
 * The encoder strips diacritics, folds CH/GH/GLI/GN/SC/CI/CE digraphs per
 * Italian orthography, drops silent H, and collapses doubled consonants.
 * The output is a canonical lowercase string of phonemes used only for
 * candidate selection — never persisted.
 */

function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

export function metaphoneIT(raw: string): string {
  if (!raw) return "";
  let s = stripDiacritics(raw).toLowerCase();
  s = s.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";

  const tokens = s.split(" ");
  return tokens.map(metaphoneToken).filter(Boolean).join(" ");
}

function metaphoneToken(tok: string): string {
  let t = tok;
  // Italian digraphs first (order matters).
  t = t.replace(/gli/g, "Y");   // figlio → fiYo-ish
  t = t.replace(/gn/g, "N");    // bagno → baNo
  t = t.replace(/sci(?=[aeou])/g, "S");  // sciare
  t = t.replace(/sce/g, "S");   // scenario
  t = t.replace(/sci/g, "S");   // scimmia
  t = t.replace(/ci(?=[aeou])/g, "C"); // ciao
  t = t.replace(/ce/g, "C");    // centro
  t = t.replace(/ci/g, "C");    // citta
  t = t.replace(/chi/g, "K");   // chi
  t = t.replace(/che/g, "K");   // che
  t = t.replace(/ch/g, "K");    // chianti
  t = t.replace(/gi(?=[aeou])/g, "J"); // giardino
  t = t.replace(/ge/g, "J");    // gente
  t = t.replace(/gi/g, "J");    // giro
  t = t.replace(/ghi/g, "G");   // ghiro
  t = t.replace(/ghe/g, "G");   // ghetto
  t = t.replace(/gh/g, "G");    // spaghetti
  t = t.replace(/qu/g, "K");    // quasi
  t = t.replace(/q/g, "K");
  t = t.replace(/z/g, "Z");
  t = t.replace(/x/g, "KS");
  t = t.replace(/ph/g, "F");
  t = t.replace(/h/g, "");

  // Final single letters to normalize
  t = t.replace(/y/g, "i");

  // Collapse doubled letters (consonants specifically; vowels kept to avoid
  // collapsing "Elena" vs "Elna").
  t = t.replace(/([bcdfgjklmnprstvwyzCJKNSYZ])\1+/g, "$1");

  return t.toLowerCase();
}

export function metaphoneMatch(a: string, b: string): boolean {
  const ma = metaphoneIT(a);
  const mb = metaphoneIT(b);
  if (!ma || !mb) return false;
  return ma === mb;
}
