export function copyContent(content) {
  return new Promise((resolve, reject) => {
    navigator.clipboard
      .writeText(content)
      .then(() => resolve())
      .catch(() => {
        const input = document.createElement('input');
        input.value = content;
        document.body.append(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        resolve();
      });
  });
}
