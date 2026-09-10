import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('assets', { recursive: true });
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAfElEQVR4nO3QQQ0AIBDAMMC/5+ONAvZoFSzZnR1JkpyeA7g1wABggAHAAAOAAQYAAwwABhgADDAAGGAAAHAAMMAAYIABwAADgAEGAAcAAAwwABhgADDAAGGAAAHAAMMAAYIABwAADgAEGAAcAAAwwABhgADDAAGGAAcJ+UAQAA//YCrvCk7QAAAABJRU5ErkJggg==';
writeFileSync('assets/logo.png', Buffer.from(pngBase64, 'base64'));
