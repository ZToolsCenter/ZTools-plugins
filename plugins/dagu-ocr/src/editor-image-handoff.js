export function readEditorImage(editorKey, waitForImage) {
  if (!waitForImage) {
    try {
      const image = window.localStorage.getItem(editorKey) || '';
      if (image) window.localStorage.removeItem(editorKey);
      return Promise.resolve(image);
    } catch {
      return Promise.resolve('');
    }
  }

  return new Promise((resolve) => {
    const poll = setInterval(() => {
      try {
        const image = window.localStorage.getItem(editorKey);
        if (image) {
          window.localStorage.removeItem(editorKey);
          clearInterval(poll);
          resolve(image);
        }
      } catch {
        // Keep waiting; the parent decides whether to close this window.
      }
    }, 20);

  });
}
