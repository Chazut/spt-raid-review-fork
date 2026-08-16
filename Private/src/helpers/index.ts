export function msToHMS( ms: number ) : string {
    const n = Number(ms);
    if (ms != null && !isNaN(n) && isFinite(n)) {
      return new Date(n).toISOString().slice(11,19);
    }
    return ''
}

// Strips Unity rich-text tags (color/b/i/size) that item-renaming mods inject
// into display names — the game renders them, the web UI would show raw tags.
// Applied here (and on server ingest) so names from older raids are clean too.
export function stripUnityRichText(value: string): string {
  if (!value || value.indexOf('<') === -1) return value;
  return value.replace(/<\/?(color|b|i|size)(=[^>]*)?>/gi, '');
}

export function intl(string: string, intl_dir: Record<string, string>) {
  const translated = intl_dir[string];
  if (translated) return translated;
  return stripUnityRichText(string);
}

export const bodypart = {
  Head: "Headshot",
  LeftArm: "Left Arm",
  RightArm: "Right Arm",
  LeftLeg: "Left Leg",
  RightLeg: "Right Leg",
  Chest: "Thorax",
};

export const existStatuses = {
  Survived: "Survived",
  Killed: "Killed",
  Left: "Left",
  Runner: "Run Through",
  MissingInAction: "Missing In Action"
}