/** Text for a voice to read: keeps the words, drops citation markers and formatting meant for the screen. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "")
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
