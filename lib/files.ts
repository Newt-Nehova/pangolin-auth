/**
 * Getting a file off the phone. The share sheet is the useful path on phones
 * (save to Files or Drive, or send to yourself); desktop falls back to an
 * ordinary download.
 *
 * Returns false only when the user backed out of the share sheet, so callers
 * can avoid recording a backup or export that never happened.
 */
export async function saveOrShare(text: string, name: string, type: string): Promise<boolean> {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return false;
      // Share failed for another reason: fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
