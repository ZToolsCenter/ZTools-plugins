export function copyContent(content) {
  navigator.clipboard.writeText(content).catch(() => {
    const input = document.createElement('input');
    input.value = content;
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  });
}
