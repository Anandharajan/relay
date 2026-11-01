import { randomInt } from "node:crypto";
export const consentVersion = "live-phrase-v2";
export const challengeTtlMinutes = 5;
// Everyday, distinct-sounding words that speech recognition rarely confuses.
const words =
  "amber anchor apple basket bridge candle canyon carpet castle cedar cherry circle cloud copper coral cotton desert dragon eagle engine feather forest garden ginger guitar hammer harbor helmet island jacket jungle kettle ladder lantern lemon letter maple market meadow mirror mountain needle ocean orange orchard paper pencil pepper piano planet pocket rabbit ribbon river rocket saddle silver spider summer sunset tiger tunnel velvet violet walnut window winter yellow".split(
    " ",
  );
export function createPhrase() {
  const pool = [...words];
  const code = Array.from(
    { length: 6 },
    () => pool.splice(randomInt(pool.length), 1)[0]!,
  );
  return `I am recording my own voice for Relay, and I agree to its use for my replies. My code words are ${code.slice(0, 5).join(", ")} and ${code[5]}.`;
}
const tokens = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
function commonInOrder(a: string[], b: string[]) {
  let row = new Array(b.length + 1).fill(0) as number[];
  for (const x of a) {
    const next = [0];
    b.forEach((y, j) =>
      next.push(x === y ? row[j]! + 1 : Math.max(row[j + 1]!, next[j]!)),
    );
    row = next;
  }
  return row[b.length]!;
}
/** The random code words prove freshness, so they must nearly all be heard, in order. */
export function phraseMatches(spoken: string, phrase: string) {
  const heard = tokens(spoken),
    expected = tokens(phrase);
  const code = expected.slice(expected.lastIndexOf("are") + 1).filter((w) => w !== "and");
  return (
    commonInOrder(code, heard) >= code.length - 1 &&
    commonInOrder(expected, heard) >= expected.length * 0.7
  );
}
