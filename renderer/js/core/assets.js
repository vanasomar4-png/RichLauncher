/** Absolute URL of a file under the project's assets folder (served by the app:// protocol). */
export function assetUrl(relativePath) {
  return new URL(`../../../../assets/${relativePath}`, import.meta.url).href;
}

/** Flat face of the original Steve: the avatar of offline accounts. */
export function steveHeadImage(className) {
  const image = document.createElement('img');
  image.className = className;
  image.src = assetUrl('ui/steve-head.png');
  image.alt = '';
  image.draggable = false;
  return image;
}
