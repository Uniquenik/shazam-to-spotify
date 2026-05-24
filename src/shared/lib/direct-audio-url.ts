const DIRECT_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];

export function isLikelyDirectAudioUrl(value: string) {
  try {
    const url = new URL(value);
    return DIRECT_AUDIO_EXTENSIONS.some((extension) =>
      url.pathname.toLowerCase().endsWith(extension),
    );
  } catch {
    return false;
  }
}
